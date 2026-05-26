import asyncio
import logging
import os
from datetime import timezone
from urllib.parse import urlparse, parse_qs

try:
    import aiohttp
    _AIOHTTP_OK = True
except ImportError:
    _AIOHTTP_OK = False
    logging.getLogger("captcha_solver").error(
        "aiohttp not installed — captcha solving disabled. Run: pip install aiohttp"
    )

log = logging.getLogger("captcha_solver")

CAPTCHA_BASE_URL = os.environ.get("CAPTCHA_BASE_URL", "https://fish.monkeysdynasty.website")
DEFAULT_CAPTCHA_BOT = "@MDfish_bot"

KNOWN_ANSWERS: dict[str, str] = {
    # Capitals
    "столица италии": "Рим",
    "столица франции": "Париж",
    "столица германии": "Берлин",
    "столица испании": "Мадрид",
    "столица польши": "Варшава",
    "столица великобритании": "Лондон",
    "столица украины": "Киев",
    "столица беларуси": "Минск",
    "столица австрии": "Вена",
    "столица нидерландов": "Амстердам",
    "столица сша": "Вашингтон",
    "столица китая": "Пекин",
    "столица японии": "Токио",
    # Days of week — оба варианта ё/е
    "какой день идет после понедельника": "Вторник",
    "какой день идёт после понедельника": "Вторник",
    "какой день идет после вторника": "Среда",
    "какой день идёт после вторника": "Среда",
    "какой день идет после среды": "Четверг",
    "какой день идёт после среды": "Четверг",
    "какой день идет после четверга": "Пятница",
    "какой день идёт после четверга": "Пятница",
    "какой день идет после пятницы": "Суббота",
    "какой день идёт после пятницы": "Суббота",
    "какой день идет после субботы": "Воскресенье",
    "какой день идёт после субботы": "Воскресенье",
    "какой день идет после воскресенья": "Понедельник",
    "какой день идёт после воскресенья": "Понедельник",
    # Time/calendar
    "сколько дней в неделе": "7",
    "сколько месяцев в году": "12",
    "сколько часов в сутках": "24",
    "сколько минут в часе": "60",
    "сколько секунд в минуте": "60",
    "сколько дней в году": "365",
    "сколько недель в году": "52",
    # Colors
    "какой цвет у неба": "синий",
    "какого цвета небо": "синий",
    "какой цвет у снега": "белый",
    "какого цвета снег": "белый",
    "какой цвет у травы": "зелёный",
    "какого цвета трава": "зелёный",
    "какой цвет у солнца": "жёлтый",
    "какого цвета солнце": "жёлтый",
}

# Русские слова для чисел 0-20 (оба регистра генерируются в _both)
RU_WORDS: list[str] = [
    "ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь",
    "восемь", "девять", "десять", "одиннадцать", "двенадцать", "тринадцать",
    "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать",
    "девятнадцать", "двадцать",
]


def _both(s: str) -> list[str]:
    """Return [lowercase, Capitalized] deduplicated."""
    return list(dict.fromkeys([s.lower(), s.capitalize()]))


def _normalize(s: str) -> str:
    return s.lower().strip().rstrip("?!.").strip()


def _make_candidates(question: str) -> list[str]:
    q = _normalize(question)
    candidates: list[str] = []

    # 1. Static dictionary match → put it first
    if q in KNOWN_ANSWERS:
        ans = KNOWN_ANSWERS[q]
        candidates += _both(ans)

    # 2. Numbers -100..100 as strings (covers all math questions)
    candidates += [str(i) for i in range(-100, 101)]

    # 3. Russian number words both cases
    for w in RU_WORDS:
        candidates += _both(w)

    # 4. All known dict values both cases (capitals, days, colors…)
    for v in KNOWN_ANSWERS.values():
        candidates += _both(v)

    return list(dict.fromkeys(candidates))  # deduplicate, preserve order


async def _fetch_challenge(session, token: str, init_data: str) -> dict:
    url = f"{CAPTCHA_BASE_URL}/api/captcha/challenge?token={token}"
    async with session.get(url, headers={"X-Telegram-Init-Data": init_data}) as r:
        if r.status != 200:
            text = await r.text()
            log.warning("_fetch_challenge failed: HTTP %d: %s", r.status, text[:200])
            raise RuntimeError(f"HTTP {r.status}: {text[:120]}")
        data = await r.json()
        log.debug("_fetch_challenge success: %s", str(data)[:200])
        return data


async def _submit_answer(
    session,
    token: str,
    answer: str,
    init_data: str,
) -> tuple[int, dict]:
    url = f"{CAPTCHA_BASE_URL}/api/captcha/solve"
    headers = {"X-Telegram-Init-Data": init_data, "Content-Type": "application/json"}
    async with session.post(url, headers=headers, json={"token": token, "answer": answer}) as r:
        body = await r.json()
        if r.status != 200:
            log.debug("_submit_answer: HTTP %d body=%s", r.status, body)
        return r.status, body


async def solve_captcha(token: str, init_data: str) -> dict:
    """
    Fetch the captcha challenge, brute-force through candidates in parallel batches.
    Returns {"ok": True, "answer": str, "question": str}
         or {"ok": False, "error": str}.
    """
    if not _AIOHTTP_OK:
        return {"ok": False, "error": "aiohttp_not_installed"}
    if not init_data:
        return {"ok": False, "error": "init_data_missing"}

    async with aiohttp.ClientSession() as session:
        try:
            data = await _fetch_challenge(session, token, init_data)
        except Exception as e:
            err_str = str(e)
            for known_error in ("auth_invalid", "auth_failed", "challenge_expired", "challenge_not_found", "penalty_active"):
                if known_error in err_str:
                    return {"ok": False, "error": known_error}
            return {"ok": False, "error": f"challenge_failed: {e}"}

        challenge = data.get("challenge", {})
        payload   = challenge.get("payload", {})
        question  = payload.get("prompt", "")
        log.info("captcha question: %s", question)

        candidates = _make_candidates(question)
        log.info("trying %d candidates for: %s (will send in parallel batches)", len(candidates), question)

        # Send candidates in parallel batches to maximize chance within ONE session
        batch_size = 10
        for batch_start in range(0, len(candidates), batch_size):
            batch = candidates[batch_start : batch_start + batch_size]
            log.debug("batch %d: sending %d candidates", batch_start // batch_size + 1, len(batch))
            
            # Create tasks for this batch
            tasks = [_submit_answer(session, token, ans, init_data) for ans in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Check results
            for i, (ans, result) in enumerate(zip(batch, results)):
                if isinstance(result, Exception):
                    log.warning("batch error for answer '%s': %s", ans, result)
                    continue
                
                status, body = result
                error = body.get("error", "")

                if status == 200:
                    log.info("captcha solved: '%s' → '%s'", question, ans)
                    return {"ok": True, "answer": ans, "question": question}

                if status == 401 or error in ("auth_invalid", "auth_failed"):
                    log.warning("auth error at answer %d/%d: %s (status=%d)", 
                               batch_start + i + 1, len(candidates), error or "401", status)
                    return {"ok": False, "error": error or "auth_invalid", "question": question}

                if error in ("challenge_expired", "challenge_not_found", "penalty_active"):
                    log.warning("challenge error: %s", error)
                    return {"ok": False, "error": error, "question": question}
                
                if status == 429:
                    log.warning("rate limited (429), pausing batch processing")
                    await asyncio.sleep(1.0)
                    break  # retry this batch or next
                # wrong_answer → continue to next in batch

            # Small delay between batches to avoid overwhelming server
            if batch_start + batch_size < len(candidates):
                await asyncio.sleep(0.1)

        return {"ok": False, "error": "no_answer_found", "question": question}


async def extract_captcha_link_from_dm(client, bot_entity, sent_after=None) -> dict | None:
    """
    Read recent DM messages from bot, return captcha token and the exact WebApp URL.
    If sent_after (UTC-aware datetime) is provided, skip messages older than that timestamp
    to avoid reusing stale captcha links.
    """
    try:
        messages = await client.get_messages(bot_entity, limit=10)
        log.info("extract_captcha_link_from_dm: got %d messages from bot DM", len(messages))
        sent_after_utc = sent_after.astimezone(timezone.utc) if sent_after is not None else None
        for i, msg in enumerate(messages):
            if sent_after_utc is not None and msg.date is not None:
                msg_date = msg.date
                if msg_date.tzinfo is None:
                    msg_date = msg_date.replace(tzinfo=timezone.utc)
                if msg_date < sent_after_utc:
                    log.info("  msg[%d] id=%s: skipped (too old: %s < %s)",
                             i, msg.id, msg_date, sent_after_utc)
                    continue
            if not msg.buttons:
                log.info("  msg[%d] id=%s: no buttons", i, msg.id)
                continue
            log.info("  msg[%d] id=%s: has buttons, scanning rows=%d",
                     i, msg.id, len(msg.buttons))
            for ri, row in enumerate(msg.buttons):
                btns = row if isinstance(row, (list, tuple)) else [row]
                for bi, btn in enumerate(btns):
                    # Telethon wraps raw button in MessageButton; raw button is btn.button
                    url = getattr(btn, 'url', None)
                    if url is None:
                        raw = getattr(btn, 'button', None)
                        url = getattr(raw, 'url', None)
                    log.info("    row[%d] btn[%d] type=%s url=%s",
                             ri, bi, type(btn).__name__,
                             url[:80] if url else None)
                    if url and 'captcha_token=' in url:
                        params = parse_qs(urlparse(url).query)
                        tokens = params.get('captcha_token', [])
                        if tokens:
                            log.info("    → token found: %s...", tokens[0][:16])
                            return {
                                "token": tokens[0],
                                "url": url,
                                "message_id": msg.id,
                                "date": msg.date.isoformat() if msg.date else "",
                            }
    except Exception as e:
        log.warning("extract_captcha_link_from_dm error: %s", e)
    log.info("extract_captcha_link_from_dm: no captcha_token found")
    return None


async def extract_token_from_dm(client, bot_entity, sent_after=None) -> str | None:
    link = await extract_captcha_link_from_dm(client, bot_entity, sent_after=sent_after)
    return link["token"] if link else None
