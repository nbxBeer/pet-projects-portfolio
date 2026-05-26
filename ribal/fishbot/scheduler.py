import asyncio
import logging
import os
import random
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse, parse_qs, unquote

import pytz
from telethon import TelegramClient, events, functions, types
from telethon.sessions import StringSession
from telethon.errors import FloodWaitError, SlowModeWaitError, PeerIdInvalidError, SessionPasswordNeededError, UserAlreadyParticipantError, AuthKeyDuplicatedError, ChannelPrivateError, UserBannedInChannelError, ChatForbiddenError, UserRestrictedError, ChatGuestSendForbiddenError
from telethon.tl.types import KeyboardButtonWebView, KeyboardButtonSimpleWebView

from database import db
from captcha_solver import solve_captcha, extract_captcha_link_from_dm, extract_token_from_dm

log = logging.getLogger("scheduler")

API_ID = int(os.environ.get("TG_API_ID", 0))
API_HASH = os.environ.get("TG_API_HASH", "")
TWO_FA_PASSWORD = os.environ.get("TG_2FA_PASSWORD", "")

LOCATIONS = ["Городской пруд", "Река", "Озеро", "Море"]
DYNAMITE_INTERVAL = (8 * 60 + 2) * 60   # 8h 2min in seconds
NET_FAST_INTERVAL  = 12 * 60 * 60        # 12h
NET_BASIC_INTERVAL = 24 * 60 * 60        # 24h
NET_FAST_MAX_USES  = 14
AUTO_ROTATE_CASTS  = 30
NFT_WATCH_USER_ID = 793216884
NFT_ALERT_USER_ID = 777679631
NFT_ALERT_USERNAME = "@beerO4KA"
NFT_WATCH_INTERVAL = 12 * 60 * 60
NFT_ALERT_MESSAGE = "\u043f\u0440\u0438\u0441\u043b\u0430\u043b\u0438 NFT"
FISH_SKIP_SINGLE_CHANCE = 0.12
FISH_SKIP_CHAIN_CHANCE = 0.05
FISH_SKIP_CHAIN_RANGE = (2, 4)
CHAT_JOIN_WARMUP_SECONDS = 30 * 60
SECONDARY_CHAT_WARMUP_SECONDS = 30 * 60
CHAT_TOOL_COOLDOWN_SECONDS = 5 * 60
BOT_REPLY_REACTION_CHANCE = 0.005
BOT_REPLY_EXCLAMATION_CHANCE = 0.01
FOREST_CHAT_LINK = "https://t.me/TheForrestLake"
FOREST_CHAT_LABEL = "TheForrestLake"
FOREST_BOT_USERNAME = "EndlessFishingBot"
FOREST_FISH_INTERVAL_SECONDS = 10 * 60
FOREST_FISH_JITTER_SECONDS = 2 * 60
FOREST_NET_INTERVAL_SECONDS = 24 * 60 * 60
FOREST_NET_JITTER_SECONDS = 2 * 60
FOREST_JOIN_INTERVAL_SECONDS = 66 * 60
FOREST_WARMUP_SECONDS = 30 * 60


class ChatJoinWarmupRequired(Exception):
    def __init__(self, chat: str, seconds: int = CHAT_JOIN_WARMUP_SECONDS):
        self.chat = str(chat)
        self.seconds = seconds
        super().__init__(f"joined {self.chat}; warming up for {seconds}s")


# Hardcoded bot/owner identifiers for external-reply checks
TELEGRAM_SERVICE_ID = 777000
FIXED_BOT_ID = 7371447792
EXCLUDED_BOT_IDS = {7371447792, 6444735563, TELEGRAM_SERVICE_ID}  # MDfish_bot, sglypa_tg_bot, Telegram service
EXCLUDED_BOT_USERNAMES = {FOREST_BOT_USERNAME.lower()}
OWNER_NOTIFY = NFT_ALERT_USERNAME
DIRECT_CLIENT_KWARGS = {
    "connection_retries": int(os.environ.get("TELETHON_CONNECTION_RETRIES", "2")),
    "request_retries": int(os.environ.get("TELETHON_REQUEST_RETRIES", "1")),
    "retry_delay": int(os.environ.get("TELETHON_RETRY_DELAY", "15")),
    "sequential_updates": True,
}
PROXY_CLIENT_KWARGS = {
    **DIRECT_CLIENT_KWARGS,
    "connection_retries": int(os.environ.get("TELETHON_PROXY_CONNECTION_RETRIES", "1")),
    "auto_reconnect": False,
}

# Fish commands — chosen randomly each cast
FISH_COMMANDS = ["фиш", "fish"]  # /fish@Bot added dynamically using captcha_bot field

BOT_REPLY_EXCLAMATIONS = ["да уж", "пупупу", "окак", "что ж", "damn", "нет слов", "эээ", "о", "в", "ладно", "повезло ага"]
BOT_REPLY_REACTIONS = ["😡", "😭", "👍", "🤯", "🤡", "😱", "😐", "💀", "💔"]

# Words for casual chat chatter
CASUAL_WORDS = [
    "ок", "да", "ага", "угу", "ладно", "хм", "эм", "ну",
    "вот", "так", "а", "о", "ой", "хах", "лол", "ха",
    "понял", "ясно", "норм", "нормально", "хорошо", "классно",
    "точно", "верно", "странно", "плохо",
    "клёв", "улов", "берег", "удочка",
    "жди", "скоро", "сейчас", "потом",
    "не знаю", "ладно ладно", "вот так",
]


def _random_casual_msg() -> str:
    length = random.choices([1, 2, 3, 4], weights=[25, 40, 25, 10])[0]
    return " ".join(random.choices(CASUAL_WORDS, k=length))


def _problem_notifications_muted(acc: dict) -> bool:
    return bool(acc.get("suppress_problem_notifications"))


def parse_hhmm(s: str):
    if not s or s == "00:00":
        return None
    h, m = s.split(":")
    return int(h), int(m)


def is_sleeping(now: datetime, sleep_start_str: str, sleep_end_str: str) -> tuple[bool, Optional[float]]:
    start_parsed = parse_hhmm(sleep_start_str)
    end_parsed = parse_hhmm(sleep_end_str)
    if not start_parsed or not end_parsed:
        return False, None
    sh, sm = start_parsed
    eh, em = end_parsed
    sleep_start_t = now.replace(hour=sh, minute=sm, second=0, microsecond=0)
    sleep_end_t = now.replace(hour=eh, minute=em, second=0, microsecond=0)
    if sleep_start_t >= sleep_end_t:
        sleeping = now >= sleep_start_t or now < sleep_end_t
    else:
        sleeping = sleep_start_t <= now < sleep_end_t
    if not sleeping:
        return False, None
    if sleep_start_t >= sleep_end_t:
        wake = sleep_end_t + timedelta(days=1) if now >= sleep_start_t else sleep_end_t
    else:
        wake = sleep_end_t
    return True, max(0, (wake - now).total_seconds())


class AccountWorker:
    # Per-chat locks — accounts in different chats run fully in parallel
    _chat_locks: dict[str, asyncio.Lock] = {}
    _chat_tool_last_used: dict[tuple[str, str], datetime] = {}
    _chat_tool_locks: dict[tuple[str, str], asyncio.Lock] = {}

    @classmethod
    def _get_lock(cls, chat: str) -> asyncio.Lock:
        if chat not in cls._chat_locks:
            cls._chat_locks[chat] = asyncio.Lock()
        return cls._chat_locks[chat]

    def __init__(self, acc_id: int):
        self.acc_id = acc_id
        self.task: Optional[asyncio.Task] = None
        self.client: Optional[TelegramClient] = None
        self._stop_event = asyncio.Event()
        self._fish_skips_remaining = 0
        # Recent sent messages for reply-detection: list of dict {chat,msg_id,ts}
        self._recent_sent: list[dict] = []
        self._last_reply_check: datetime = datetime.fromtimestamp(0, timezone.utc)
        self._private_dm_tasks: dict[int, asyncio.Task] = {}
        self._background_tasks: set[asyncio.Task] = set()
        self._private_dm_handler_client_id: Optional[int] = None
        self._private_dm_sender_aliases: dict[str, int] = {}

    def is_running(self):
        return self.task is not None and not self.task.done()

    async def start(self):
        self._stop_event.clear()
        self.task = asyncio.create_task(self._run(), name=f"worker-{self.acc_id}")

    async def stop(self):
        self._stop_event.set()
        for task in list(self._private_dm_tasks.values()):
            task.cancel()
        for task in list(self._background_tasks):
            task.cancel()
        await asyncio.gather(*self._private_dm_tasks.values(), return_exceptions=True)
        await asyncio.gather(*self._background_tasks, return_exceptions=True)
        self._private_dm_tasks.clear()
        self._background_tasks.clear()
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        if self.client:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

    def _spawn_background(self, coro, *, limit: int = 3) -> bool:
        self._background_tasks = {task for task in self._background_tasks if not task.done()}
        if len(self._background_tasks) >= limit:
            coro.close()
            return False
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)

        def _cleanup(done: asyncio.Task):
            self._background_tasks.discard(done)
            try:
                done.result()
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.warning("[%s] background task error: %s", self.acc_id, e)

        task.add_done_callback(_cleanup)
        return True

    async def _disconnect_client(self, client: Optional[TelegramClient]):
        if not client:
            return
        try:
            await client.disconnect()
        except Exception:
            pass
        sender = getattr(client, "_sender", None)
        disconnected = getattr(sender, "_disconnected", None)
        if disconnected and disconnected.done() and not disconnected.cancelled():
            try:
                disconnected.exception()
            except Exception:
                pass

    async def _wait_for_direct_reply(self, peer, sent_at: datetime, sent_msg_id: int, timeout: int = 12):
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(2)
            try:
                msgs = await self.client.get_messages(peer, limit=20)
                for msg in msgs:
                    if getattr(msg, "out", False):
                        continue
                    msg_date = msg.date
                    if msg_date.tzinfo is None:
                        msg_date = msg_date.replace(tzinfo=timezone.utc)
                    if msg_date.astimezone(timezone.utc) < sent_at.astimezone(timezone.utc):
                        continue
                    reply_to = getattr(getattr(msg, "reply_to", None), "reply_to_msg_id", None)
                    if reply_to == sent_msg_id:
                        return msg
            except Exception as e:
                log.warning("_wait_for_direct_reply error: %s", e)
        return None

    async def _maybe_react_to_bot_reply(self, acc: dict, sent_at: datetime, sent_msg_id: Optional[int], chat: Optional[str] = None):
        if not sent_msg_id:
            return
        peer = self._get_peer(chat or acc["chat"])
        try:
            # Always try to fetch a direct reply to inspect content (short timeout inside)
            reply = await self._wait_for_direct_reply(peer, sent_at, sent_msg_id)
        except Exception as e:
            log.warning("[%s] wait_for_direct_reply error: %s", acc.get("name"), e)
            reply = None

        if not reply:
            # Keep occasional reactions even when no direct reply was detected
            if random.random() < BOT_REPLY_REACTION_CHANCE:
                try:
                    reactions = BOT_REPLY_REACTIONS[:]
                    random.shuffle(reactions)
                    for emoji in reactions:
                        try:
                            await self.client(functions.messages.SendReactionRequest(
                                peer=peer,
                                msg_id=sent_msg_id,
                                reaction=[types.ReactionEmoji(emoticon=emoji)],
                            ))
                            await db.add_log(acc["id"], acc["name"], "bot_reply_reaction", emoji)
                            break
                        except Exception:
                            continue
                except Exception as e:
                    log.debug("[%s] reaction fallback error: %s", acc.get("name"), e)
            return

        # We have a reply message from bot — inspect its text for keywords/actions
        try:
            text = (getattr(reply, 'text', '') or getattr(reply, 'message', '') or '')
            ltext = text.lower()

            # NFT handling: if bot mentions NFT, pause account and notify owner
            if 'nft' in ltext:
                try:
                    await db.update_account(acc["id"], {"enabled": False})
                except Exception:
                    pass
                try:
                    await db.add_log(acc["id"], acc["name"], "nft_pause", text[:200])
                except Exception:
                    pass
                try:
                    await self.client.send_message(NFT_ALERT_USERNAME, f"У меня проблемы — аккаунт {acc.get('name')} ({acc.get('id')}) обнаружил NFT-ответ: {text[:200]}")
                except Exception:
                    pass
                return

            # Captcha keywords — kick off captcha solver (existing flow)
            for kw in ('капч', 'captcha', 'проверк', 'verify'):
                if kw in ltext:
                    try:
                        await db.add_log(acc["id"], acc["name"], "captcha_trigger", f"kw={kw}")
                    except Exception:
                        pass
                    try:
                        # Run captcha solver flow (use account client)
                        await self._captcha_loop(acc, self.client, sent_at=sent_at, sent_msg_id=sent_msg_id, chat=chat or acc.get('chat'))
                    except ChatJoinWarmupRequired:
                        raise
                    except Exception as e:
                        log.warning("[%s] captcha trigger error: %s", acc.get('name'), e)
                    return

            # Fight / mini-game pattern detection
            if 'началась борьба' in ltext or 'fight_' in ltext:
                try:
                    await db.add_log(acc["id"], acc["name"], "fight_detected", text[:200])
                except Exception:
                    pass
                try:
                    await self._handle_fight_minigame(acc, reply, peer)
                except Exception as e:
                    log.warning("[%s] fight handler error: %s", acc.get('name'), e)
                return

            # Occasional exclamation reaction as before
            if random.random() < BOT_REPLY_EXCLAMATION_CHANCE:
                ex = random.choice(BOT_REPLY_EXCLAMATIONS)
                try:
                    await self._send(self.client, acc["chat"], ex)
                    await db.add_log(acc["id"], acc["name"], "bot_reply_exclamation", ex)
                except ChatJoinWarmupRequired:
                    raise
                except Exception:
                    pass
                return
        except ChatJoinWarmupRequired:
            raise
        except Exception as e:
            log.warning("[%s] bot reply handling error: %s", acc.get('name'), e)

    # ------------------------------------------------------------------
    # Static / pure helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _get_peer(chat: str):
        return int(chat) if chat.lstrip("-").isdigit() else chat

    @staticmethod
    def _is_timer_ready(last_used_iso: Optional[str], interval_seconds: float) -> bool:
        if not last_used_iso:
            return True
        try:
            last = datetime.fromisoformat(last_used_iso)
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            return (datetime.now(timezone.utc) - last).total_seconds() >= interval_seconds
        except Exception:
            return True

    @staticmethod
    def _parse_utc_dt(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None

    def _should_skip_fish(self) -> tuple[bool, int]:
        if self._fish_skips_remaining > 0:
            self._fish_skips_remaining -= 1
            return True, self._fish_skips_remaining
        roll = random.random()
        if roll < FISH_SKIP_CHAIN_CHANCE:
            total = random.randint(*FISH_SKIP_CHAIN_RANGE)
            self._fish_skips_remaining = total - 1
            return True, self._fish_skips_remaining
        if roll < FISH_SKIP_CHAIN_CHANCE + FISH_SKIP_SINGLE_CHANCE:
            return True, 0
        return False, 0

    def _secondary_chat_ready(self, acc: dict, now: Optional[datetime] = None) -> bool:
        if (acc.get("secondary_chat_status") or "") != "joined":
            return False
        secondary = (acc.get("secondary_chat") or "").strip()
        if not secondary or secondary == acc.get("chat"):
            return False
        available_at = self._parse_utc_dt(acc.get("secondary_chat_available_at"))
        if not available_at:
            return True
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc) >= available_at

    def _available_work_chats(self, acc: dict) -> list[str]:
        chats = [acc["chat"]]
        if self._secondary_chat_ready(acc):
            chats.append(acc["secondary_chat"])
        random.shuffle(chats)
        return chats

    def _pick_work_chat(self, acc: dict) -> str:
        chats = self._available_work_chats(acc)
        return random.choice(chats) if chats else acc["chat"]

    async def _wait_chat_tool_cooldown(self, chat: str, tool: str):
        key = (chat, "special_tool")
        if key not in AccountWorker._chat_tool_locks:
            AccountWorker._chat_tool_locks[key] = asyncio.Lock()
        async with AccountWorker._chat_tool_locks[key]:
            last = AccountWorker._chat_tool_last_used.get(key)
            if last:
                wait_seconds = CHAT_TOOL_COOLDOWN_SECONDS - (
                    datetime.now(timezone.utc) - last
                ).total_seconds()
                if wait_seconds > 0:
                    await asyncio.sleep(wait_seconds)
            AccountWorker._chat_tool_last_used[key] = datetime.now(timezone.utc)

    async def _check_nft_watch(self, acc: dict) -> bool:
        if not self.client or not self.client.is_connected():
            return False

        acc_id = acc["id"]
        name = acc["name"]
        now_utc = datetime.now(timezone.utc)
        last_check = self._parse_utc_dt(acc.get("nft_watch_last_check"))
        if last_check and (now_utc - last_check).total_seconds() < NFT_WATCH_INTERVAL:
            return False

        cutoff = last_check or (now_utc - timedelta(seconds=NFT_WATCH_INTERVAL))
        found = False
        try:
            msgs = await self.client.get_messages(NFT_WATCH_USER_ID, limit=20)
            for msg in msgs:
                msg_date = msg.date
                if msg_date is None:
                    continue
                if msg_date.tzinfo is None:
                    msg_date = msg_date.replace(tzinfo=timezone.utc)
                if msg_date.astimezone(timezone.utc) <= cutoff:
                    break
                if msg.out:
                    continue
                from_id = getattr(getattr(msg, "from_id", None), "user_id", None)
                if from_id in (None, NFT_WATCH_USER_ID):
                    found = True
                    break
        except Exception as e:
            log.warning("[%s] nft watch check error: %s", name, e)
            await db.update_account(acc_id, {"nft_watch_last_check": now_utc.isoformat()})
            return False

        if not found:
            await db.update_account(acc_id, {"nft_watch_last_check": now_utc.isoformat()})
            return False

        notify_error = ""
        try:
            await self.client.send_message(NFT_ALERT_USER_ID, NFT_ALERT_MESSAGE)
        except Exception as e:
            notify_error = str(e)
            try:
                await self.client.send_message(NFT_ALERT_USERNAME, NFT_ALERT_MESSAGE)
                notify_error = ""
            except Exception as e2:
                notify_error = f"{e}; fallback: {e2}"

        updates = {
            "enabled": 0,
            "next_send_at": None,
            "nft_watch_last_check": now_utc.isoformat(),
        }
        await db.update_account(acc_id, updates)
        detail = "paused after NFT watcher trigger"
        if notify_error:
            detail += f"; notify error: {notify_error}"
        await db.add_log(acc_id, name, "nft_watch_pause", detail)
        log.warning("[%s] nft watch triggered, account paused", name)
        return True

    @staticmethod
    def _init_data_age_seconds(init_data: str) -> Optional[float]:
        """Return how many seconds ago auth_date was set, or None if unparseable."""
        try:
            for part in init_data.split('&'):
                if part.startswith('auth_date='):
                    auth_ts = int(part.split('=', 1)[1])
                    age = datetime.now(timezone.utc).timestamp() - auth_ts
                    return age
        except Exception:
            pass
        return None

    @staticmethod
    def _is_init_data_stale(init_data: str, max_age_seconds: float = 82800.0) -> bool:
        """True if init_data is older than max_age_seconds (default 23 h)."""
        age = AccountWorker._init_data_age_seconds(init_data)
        if age is None:
            return False
        return age >= max_age_seconds

    async def _refresh_init_data(
        self,
        acc: dict,
        client: TelegramClient,
        webapp_url: Optional[str] = None,
        bot_entity=None,
    ) -> Optional[str]:
        """
        Call messages.RequestWebView for the captcha bot to obtain a fresh InitData.
        When solving captcha, pass the exact captcha button URL; it contains the token
        and can produce auth data tied to that WebApp launch.
        Extracts tgWebAppData from the returned URL fragment, saves it to DB, returns it.
        """
        bot_name = (acc.get("captcha_bot") or "@MDfish_bot").strip().lstrip("@")
        if not bot_name:
            return None
        name = acc["name"]
        try:
            if bot_entity is None:
                bot_entity = await client.get_entity(f"@{bot_name}")

            if webapp_url is None:
                msgs = await client.get_messages(bot_entity, limit=20)
                for msg in msgs:
                    if not msg.buttons:
                        continue
                    for row in msg.buttons:
                        btns = row if isinstance(row, (list, tuple)) else [row]
                        for btn in btns:
                            raw = getattr(btn, 'button', btn)
                            url = getattr(raw, 'url', None)
                            if url and isinstance(raw, (KeyboardButtonWebView, KeyboardButtonSimpleWebView)):
                                webapp_url = url
                                break
                        if webapp_url:
                            break
                    if webapp_url:
                        break

            if not webapp_url:
                log.warning("[%s] _refresh_init_data: no WebApp button found in bot DM", name)
                return None

            log.info("[%s] RequestWebView with URL: %s...", name, webapp_url[:100])
            
            # Try different platforms to maximize compatibility
            result = None
            for platform in ['web', 'ios', 'android', 'macos']:
                try:
                    log.debug("[%s] trying RequestWebView platform=%s", name, platform)
                    result = await client(functions.messages.RequestWebViewRequest(
                        peer=bot_entity,
                        bot=bot_entity,
                        platform=platform,
                        url=webapp_url,
                    ))
                    log.info("[%s] RequestWebView success with platform=%s", name, platform)
                    break
                except Exception as e:
                    log.debug("[%s] RequestWebView platform=%s failed: %s", name, platform, e)
                    if platform == 'android':  # last attempt
                        raise

            result_url = result.url if hasattr(result, 'url') else str(result)
            log.info("[%s] RequestWebView returned: %s", name, result_url[:200])
            
            fragment = urlparse(result_url).fragment
            params = parse_qs(fragment)
            raw_idata = params.get('tgWebAppData', [None])[0]
            if not raw_idata:
                log.warning("[%s] _refresh_init_data: tgWebAppData not in fragment. fragment=%s", 
                           name, fragment[:200])
                # Try fallback: maybe we need to strip query params from the URL
                if '?' in webapp_url:
                    base_url = webapp_url.split('?')[0]
                    log.info("[%s] retrying RequestWebView with base URL only: %s", name, base_url[:100])
                    try:
                        result = await client(functions.messages.RequestWebViewRequest(
                            peer=bot_entity,
                            bot=bot_entity,
                            platform='web',
                            url=base_url,
                        ))
                        result_url = result.url if hasattr(result, 'url') else str(result)
                        fragment = urlparse(result_url).fragment
                        params = parse_qs(fragment)
                        raw_idata = params.get('tgWebAppData', [None])[0]
                        if raw_idata:
                            log.info("[%s] tgWebAppData found in fallback attempt", name)
                    except Exception as e:
                        log.warning("[%s] fallback RequestWebView failed: %s", name, e)
                
                if not raw_idata:
                    return None

            fresh_idata = unquote(raw_idata)
            log.info("[%s] extracted init_data (len=%d, auth_date age=%.0fs)", 
                     name, len(fresh_idata), AccountWorker._init_data_age_seconds(fresh_idata) or 0)
            await db.update_account(acc["id"], {"init_data": fresh_idata})
            await db.add_log(acc["id"], name, "init_data_refreshed", "auto")
            return fresh_idata

        except Exception as e:
            log.warning("[%s] _refresh_init_data error: %s", name, e)
            import traceback
            log.debug("[%s] traceback: %s", name, traceback.format_exc())
            return None

    @staticmethod
    async def _send(client: TelegramClient, chat: str, message: str):
        chat_text = str(chat)
        peer = int(chat_text) if chat_text.lstrip("-").isdigit() else chat_text
        try:
            return await client.send_message(peer, message)
        except ChatGuestSendForbiddenError:
            entity = None
            try:
                entity = await client.get_entity(peer)
            except Exception:
                pass
            if await AccountWorker._join_send_target(client, chat_text, entity=entity):
                raise ChatJoinWarmupRequired(chat_text)
            raise
        except (ValueError, PeerIdInvalidError):
            pass
        target_id = abs(peer) if isinstance(peer, int) else None
        entity = None
        try:
            async for dialog in client.iter_dialogs():
                eid = getattr(dialog.entity, 'id', None)
                if target_id and eid == target_id:
                    entity = dialog.entity
                    break
        except Exception as e:
            log.warning("iter_dialogs error: %s", e)
        if entity is not None:
            try:
                return await client.send_message(entity, message)
            except ChatGuestSendForbiddenError:
                if await AccountWorker._join_send_target(client, chat_text, entity=entity):
                    raise ChatJoinWarmupRequired(chat_text)
                raise
        raise ValueError(
            f"Чат '{chat}' не найден в диалогах. "
            f"Убедись что аккаунт в группе или используй @username."
        )

    @staticmethod
    async def _join_send_target(client: TelegramClient, chat: str, entity=None) -> bool:
        raw = (chat or "").strip()
        target = raw
        if "t.me/" in raw or "telegram.me/" in raw:
            parsed = urlparse(raw if "://" in raw else "https://" + raw)
            target = parsed.path.strip("/")

        candidates = []
        if target:
            if target.startswith("+"):
                candidates.append(("invite", target[1:]))
            elif target.startswith("joinchat/"):
                candidates.append(("invite", target.split("/", 1)[1]))
            elif not target.lstrip("-").isdigit():
                candidates.append(("channel", target[1:] if target.startswith("@") else target))
        if entity is not None:
            candidates.append(("channel", entity))

        for kind, value in candidates:
            try:
                if kind == "invite":
                    await client(functions.messages.ImportChatInviteRequest(value))
                else:
                    await client(functions.channels.JoinChannelRequest(value))
                return True
            except UserAlreadyParticipantError:
                return True
            except Exception as e:
                log.warning("auto join before send failed for %s: %s", chat, e)
        return False

    async def _join_chat_link_with_current_client(self, link: str):
        raw = (link or "").strip()
        if not raw:
            raise RuntimeError("chat link is empty")
        target = raw
        if "t.me/" in raw or "telegram.me/" in raw:
            parsed = urlparse(raw if "://" in raw else "https://" + raw)
            target = parsed.path.strip("/")
        try:
            if target.startswith("+"):
                await self.client(functions.messages.ImportChatInviteRequest(target[1:]))
            elif target.startswith("joinchat/"):
                await self.client(functions.messages.ImportChatInviteRequest(target.split("/", 1)[1]))
            else:
                if target.startswith("@"):
                    target = target[1:]
                await self.client(functions.channels.JoinChannelRequest(target))
        except UserAlreadyParticipantError:
            pass

    async def _ensure_secondary_chat_joined(self, acc: dict):
        if not acc.get("secondary_chat") or not acc.get("secondary_chat_id"):
            return
        if acc.get("secondary_chat_id") == acc.get("chat_id") or acc.get("secondary_chat") == acc.get("chat"):
            await db.assign_account_secondary_chat(acc["id"], None)
            return
        if (acc.get("secondary_chat_status") or "") == "joined":
            return
        try:
            await db.update_account(acc["id"], {
                "secondary_chat_status": "joining",
                "secondary_chat_error": "",
            })
            await self._join_chat_link_with_current_client(acc["secondary_chat"])
            available_at = datetime.now(timezone.utc) + timedelta(seconds=SECONDARY_CHAT_WARMUP_SECONDS)
            await db.update_account(acc["id"], {
                "secondary_chat_status": "joined",
                "secondary_chat_error": "",
                "secondary_chat_available_at": available_at.isoformat(),
            })
            await db.add_log(acc["id"], acc["name"], "secondary_chat_joined", acc["secondary_chat"])
        except Exception as e:
            await db.update_account(acc["id"], {
                "secondary_chat_status": "error",
                "secondary_chat_error": str(e),
            })
            await db.add_log(acc["id"], acc["name"], "secondary_chat_join_error", str(e))

    # ------------------------------------------------------------------
    # Button / menu helpers
    # ------------------------------------------------------------------

    async def _wait_for_buttons(
        self,
        peer,
        sent_at: datetime,
        timeout: int = 15,
        reply_to_id: Optional[int] = None,
    ):
        """
        Wait for a bot message with inline buttons.

        When reply_to_id is given, ONLY accepts the message that is a direct
        reply to that message ID — guarantees each account gets its own menu
        even when multiple accounts send "Меню" simultaneously.
        """
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        deadline = asyncio.get_event_loop().time() + timeout

        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(2)
            try:
                msgs = await self.client.get_messages(peer, limit=20)
                for msg in msgs:
                    if not msg.buttons:
                        continue
                    if reply_to_id is not None:
                        reply_hdr = getattr(msg, 'reply_to', None)
                        if reply_hdr and getattr(reply_hdr, 'reply_to_msg_id', None) == reply_to_id:
                            return msg
                        # Don't pick up another account's menu
                        continue
                    # Timestamp fallback (no reply_to_id)
                    msg_date = msg.date
                    if msg_date.tzinfo is None:
                        msg_date = msg_date.replace(tzinfo=timezone.utc)
                    if msg_date >= sent_at:
                        return msg
            except Exception as e:
                log.warning("_wait_for_buttons error: %s", e)
        return None

    async def _check_external_replies(self, acc: dict):
        """
        Scan recent messages that this account sent and look for incoming replies
        from users that are NOT the hardcoded bot and NOT other accounts in system.
        If such a reply is found, send "Что?" to the chat and notify OWNER_NOTIFY.
        """
        if not self.client or not self.client.is_connected():
            return
        try:
            accounts = await db.get_accounts()
            internal_ids = {int(a.get('tg_id')) for a in accounts if a.get('tg_id')}
        except Exception:
            internal_ids = set()

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=5)
        # iterate over a copy to allow removals
        for entry in list(self._recent_sent):
            try:
                if entry.get('ts') < cutoff:
                    # drop old entries
                    self._recent_sent.remove(entry)
                    continue
                chat = entry.get('chat')
                msg_id = entry.get('msg_id')
                if not chat or not msg_id:
                    self._recent_sent.remove(entry)
                    continue
                msgs = await self.client.get_messages(chat, limit=50)
                for m in msgs:
                    # incoming reply to our message
                    if getattr(m, 'out', False):
                        continue
                    reply_to = getattr(m, 'reply_to_msg_id', None) or getattr(getattr(m, 'reply_to', None), 'reply_to_msg_id', None)
                    if reply_to != msg_id:
                        continue
                    # identify sender id
                    from_id = getattr(getattr(m, 'from_id', None), 'user_id', None) or getattr(m, 'sender_id', None)
                    try:
                        from_id = int(from_id) if from_id is not None else None
                    except Exception:
                        from_id = None
                    # exclude bot and internal accounts
                    if from_id is None:
                        continue
                    if from_id in EXCLUDED_BOT_IDS or from_id in internal_ids:
                        continue
                    try:
                        sender = await m.get_sender()
                        sender_username = (getattr(sender, "username", None) or "").lower()
                    except Exception:
                        sender_username = ""
                    if sender_username in EXCLUDED_BOT_USERNAMES:
                        continue
                    # external reply detected — react and notify
                    try:
                        await self.client.send_message(chat, 'Что?')
                    except Exception:
                        pass
                    try:
                        await self.client.send_message(OWNER_NOTIFY, f"У меня проблемы — аккаунт {acc.get('name')} ({acc.get('id')}) в чате {chat}")
                    except Exception as e:
                        log.warning("[%s] failed to notify OWNER_NOTIFY: %s", acc.get('name'), e)
                        try:
                            await self.client.send_message(NFT_ALERT_USER_ID, f"У меня проблемы — аккаунт {acc.get('name')} ({acc.get('id')}) в чате {chat}")
                        except Exception as e2:
                            log.warning("[%s] failed to notify NFT_ALERT_USER_ID: %s", acc.get('name'), e2)
                    try:
                        await db.add_log(acc.get('id'), acc.get('name'), 'external_reply', f'from {from_id} in {chat}')
                    except Exception:
                        pass
                    # remove processed entry and stop scanning this entry
                    try:
                        self._recent_sent.remove(entry)
                    except Exception:
                        pass
                    break
            except Exception:
                try:
                    self._recent_sent.remove(entry)
                except Exception:
                    pass

    async def _handle_external_private_message(self, acc: dict, event) -> None:
        sender_id = getattr(event, "sender_id", None)
        if sender_id is None:
            return

        try:
            sender = await event.get_sender()
        except Exception:
            sender = None

        sender_username = (getattr(sender, "username", None) or "").lower()
        owner_username = (OWNER_NOTIFY or "").lstrip("@").lower()
        is_owner = sender_id == NFT_ALERT_USER_ID or (
            owner_username and sender_username == owner_username
        )
        if is_owner:
            await self._handle_private_dm_owner_command(acc, event)
            return

        existing = self._private_dm_tasks.get(sender_id)
        if existing and not existing.done():
            return

        async def _runner():
            try:
                accounts = await db.get_accounts()
                internal_ids = {int(a.get("tg_id")) for a in accounts if a.get("tg_id")}
            except Exception:
                internal_ids = set()

            blocked_ids = {FIXED_BOT_ID, NFT_WATCH_USER_ID, NFT_ALERT_USER_ID, *EXCLUDED_BOT_IDS}

            if (
                sender_id in internal_ids
                or sender_id in blocked_ids
                or sender_username in EXCLUDED_BOT_USERNAMES
            ):
                return

            if sender_username:
                self._private_dm_sender_aliases[sender_username] = int(sender_id)
            self._private_dm_sender_aliases[str(sender_id)] = int(sender_id)

            try:
                claimed = await db.claim_external_dm_for_sender(acc.get("id"), int(sender_id))
                if not claimed:
                    return
            except Exception as e:
                log.warning("[%s] failed to claim one-time DM reply: %s", acc.get("name"), e)
                return

            try:
                preview = (event.raw_text or event.message.message or "").strip()[:200]
            except Exception:
                preview = ""

            log.warning(
                "[%s] external private DM detected from %s (%s)",
                acc.get("name"),
                sender_username or sender_id,
                sender_id,
            )

            # 1. IMMEDIATELY notify owner
            notify_text = (
                f"У меня проблемы — аккаунт {acc.get('name')} ({acc.get('id')}) получил ЛС от "
                f"{sender_username or sender_id}{f' | {preview}' if preview else ''}"
            )
            if not _problem_notifications_muted(acc):
                try:
                    await self.client.send_message(OWNER_NOTIFY, notify_text)
                except Exception as e:
                    log.warning("[%s] failed to notify OWNER_NOTIFY: %s", acc.get("name"), e)

            try:
                await db.add_log(acc.get("id"), acc.get("name"), "external_private_dm", notify_text)
            except Exception:
                pass

            # 2. Wait 30 seconds before replying
            await asyncio.sleep(30)

            if self._stop_event.is_set() or not self.client or not self.client.is_connected():
                return

            # 3. Reply with "Ща"
            try:
                await self.client.send_message(event.chat_id, "Ща", reply_to=getattr(event.message, "id", None))
            except Exception:
                try:
                    await self.client.send_message(event.chat_id, "Ща")
                except Exception as e:
                    log.warning("[%s] failed to reply to external DM: %s", acc.get("name"), e)

            try:
                await db.claim_external_dm_for_sender(acc.get("id"), int(sender_id))
            except Exception:
                pass

        task = asyncio.create_task(_runner())
        self._private_dm_tasks[sender_id] = task

        def _cleanup(_task: asyncio.Task):
            self._private_dm_tasks.pop(sender_id, None)

        task.add_done_callback(_cleanup)

    async def _handle_private_dm_owner_command(self, acc: dict, event) -> None:
        try:
            text = (event.raw_text or event.message.message or "").strip()
        except Exception:
            return

        parts = text.split()
        if len(parts) != 2 or parts[1].lower() != "ща":
            return

        target = parts[0].strip().lstrip("@").lower()
        if not target:
            return

        if target.isdigit():
            sender_id = int(target)
        else:
            sender_id = self._private_dm_sender_aliases.get(target)
            if sender_id is None and self.client:
                try:
                    entity = await self.client.get_entity(target)
                    sender_id = int(getattr(entity, "id", 0) or 0) or None
                    if sender_id:
                        self._private_dm_sender_aliases[target] = sender_id
                except Exception:
                    sender_id = None

        if sender_id is None:
            log.info("[%s] owner allowed DM reply for unknown target: %s", acc.get("name"), target)
            return

        try:
            await db.allow_external_dm_for_sender(acc.get("id"), int(sender_id))
            log.info("[%s] owner allowed next DM reply for %s (%s)", acc.get("name"), target, sender_id)
        except Exception as e:
            log.warning("[%s] failed to allow next DM reply for %s: %s", acc.get("name"), target, e)

    async def _ensure_private_dm_handler(self, acc: dict):
        if not self.client:
            return
        client_id = id(self.client)
        if self._private_dm_handler_client_id == client_id:
            return

        async def _on_new_message(event):
            try:
                if not event.is_private or event.out:
                    return
                await self._handle_external_private_message(acc, event)
            except Exception as e:
                log.warning("[%s] private DM handler error: %s", acc.get("name"), e)

        self.client.add_event_handler(_on_new_message, events.NewMessage(incoming=True))
        self._private_dm_handler_client_id = client_id

    async def _handle_fight_minigame(self, acc: dict, reply_msg, peer):
        """Handle a fight mini-game message by clicking one of the inline buttons.
        Strategy: look for callback data containing 'fight_' and choose a likely action.
        """
        # If message already has buttons, use them
        buttons = getattr(reply_msg, 'buttons', None)
        msg_id = getattr(reply_msg, 'id', None)
        if not msg_id:
            return False

        # Helper to try click by substring
        async def try_click(substrs):
            for s in substrs:
                ok = await self._click_button_containing(peer, msg_id, s)
                if ok:
                    return True
            return False

        # Prefer action order: hold, slack, jerk (heuristic)
        preferred = ['hold', 'slack', 'jerk']
        # Try to click button by callback data containing these substrings
        try:
            if await try_click([f'_{p}_' for p in preferred]):
                await db.add_log(acc.get('id'), acc.get('name'), 'fight_action', preferred[0])
                return True
            # Fallback: click any fight_ button
            if await try_click(['fight_']):
                await db.add_log(acc.get('id'), acc.get('name'), 'fight_action', 'random_fight')
                return True
        except Exception as e:
            log.warning("[%s] fight click error: %s", acc.get('name'), e)
        # As last resort, try clicking first inline button if present
        try:
            if buttons:
                for row in buttons:
                    for btn in row:
                        data = getattr(btn, 'data', None)
                        if data:
                            try:
                                cb = data.decode('utf-8', errors='ignore') if isinstance(data, (bytes, bytearray)) else str(data)
                                ok = await self._click_button_by_data(peer, msg_id, cb)
                                if ok:
                                    await db.add_log(acc.get('id'), acc.get('name'), 'fight_action', 'button_by_data')
                                    return True
                            except Exception:
                                continue
        except Exception:
            pass
        return False

    async def _click_button_by_data(self, peer, msg_id: int, callback_data: str) -> bool:
        try:
            await self.client(functions.messages.GetBotCallbackAnswerRequest(
                peer=peer,
                msg_id=msg_id,
                data=callback_data.encode("utf-8"),
            ))
            return True
        except Exception as e:
            log.warning("_click_button_by_data %r: %s", callback_data, e)
            return False

    async def _click_button_containing(self, peer, msg_id: int, data_substr: str) -> bool:
        """Click the first button whose utf-8 callback data contains data_substr.
        More robust than _click_button_by_data when the exact ID suffix is unknown."""
        try:
            msg = await self.client.get_messages(peer, ids=msg_id)
            if not msg or not msg.buttons:
                return False
            needle = data_substr.encode("utf-8")
            for row in msg.buttons:
                btns = row if isinstance(row, (list, tuple)) else [row]
                for btn in btns:
                    raw = getattr(btn, 'button', btn)
                    data = getattr(raw, 'data', None)
                    if data and needle in data:
                        await self.client(functions.messages.GetBotCallbackAnswerRequest(
                            peer=peer, msg_id=msg_id, data=data
                        ))
                        return True
            log.debug("_click_button_containing: %r not found in msg %d", data_substr, msg_id)
            return False
        except Exception as e:
            log.warning("_click_button_containing %r: %s", data_substr, e)
            return False

    async def _get_msg_by_id(self, peer, msg_id: int):
        try:
            return await self.client.get_messages(peer, ids=msg_id)
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Location sequence
    # ------------------------------------------------------------------

    async def _change_location_sequence(self, acc: dict, target_location: str, chat: Optional[str] = None) -> bool:
        chat = chat or acc["chat"]
        tg_id = acc.get("tg_id")
        name = acc["name"]
        peer = self._get_peer(chat)

        if not tg_id:
            log.warning("[%s] no tg_id, cannot change location", name)
            return False

        try:
            sent_at = datetime.now(timezone.utc)
            sent_msg = await AccountWorker._send(self.client, chat, "Меню")
            reply_id = getattr(sent_msg, 'id', None)

            menu_msg = await self._wait_for_buttons(peer, sent_at, timeout=15, reply_to_id=reply_id)
            if not menu_msg:
                log.warning("[%s] _change_location: no menu received", name)
                return False

            await self._click_button_by_data(peer, menu_msg.id, f"change_location_{tg_id}")
            await asyncio.sleep(2)

            # Bot edits the menu message with location buttons
            loc_msg = await self._get_msg_by_id(peer, menu_msg.id)
            if not loc_msg or not loc_msg.buttons:
                loc_msg = await self._wait_for_buttons(peer, sent_at, timeout=8)

            if not loc_msg:
                log.warning("[%s] _change_location: no location buttons", name)
                return False

            ok = await self._click_button_by_data(
                peer, loc_msg.id, f"select_location_{target_location}_{tg_id}"
            )
            if ok:
                await asyncio.sleep(1)
                log.info("[%s] location -> %s", name, target_location)
                await db.add_log(acc["id"], name, "location_changed", target_location)
            return ok

        except ChatJoinWarmupRequired:
            raise
        except Exception as e:
            log.warning("[%s] _change_location_sequence error: %s", name, e)
            return False

    # ------------------------------------------------------------------
    # Externally triggered location change (from settings update)
    # ------------------------------------------------------------------

    async def change_location_now(self, target_location: str):
        """Queue a forced location change. Acquires the per-chat game lock."""
        acc = await db.get_account(self.acc_id)
        if not acc or not acc["enabled"]:
            return
        name = acc["name"]

        async with AccountWorker._get_lock(acc["chat"]):
            try:
                if not self.client or not self.client.is_connected():
                    self.client = TelegramClient(
                        StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS
                    )
                    await self.client.connect()
                ok = await self._change_location_sequence(acc, target_location)
                if ok:
                    await db.update_account(acc["id"], {"current_location": target_location})
            except ChatJoinWarmupRequired as e:
                await self._apply_chat_join_warmup(acc, e.chat)
            except Exception as e:
                log.warning("[%s] change_location_now error: %s", name, e)

    # ------------------------------------------------------------------
    # Dynamite sequence
    # ------------------------------------------------------------------

    async def _do_dynamite_sequence(self, acc: dict, fishing_loc: str, chat: Optional[str] = None):
        name = acc["name"]
        acc_id = acc["id"]
        chat = chat or acc["chat"]

        await self._wait_chat_tool_cooldown(chat, "dynamite")
        try:
            await AccountWorker._send(self.client, chat, "динамит")
            await db.add_log(acc_id, name, "dynamite", f"chat={chat}")
            log.info("[%s] dynamite sent", name)
        except ChatJoinWarmupRequired:
            raise
        except Exception as e:
            log.warning("[%s] dynamite send error: %s", name, e)

        await db.update_account(acc_id, {
            "dynamite_last_used": datetime.now(timezone.utc).isoformat()
        })

    # ------------------------------------------------------------------
    # Net: buy helper
    # ------------------------------------------------------------------

    async def _buy_fast_net(self, acc: dict) -> bool:
        name = acc["name"]
        tg_id = acc.get("tg_id")
        acc_id = acc["id"]
        chat = acc["chat"]
        peer = self._get_peer(chat)
        bot_name = (acc.get("captcha_bot") or "@MDfish_bot").lstrip("@")

        if not tg_id:
            return False

        try:
            skip_sell = await db.get_setting("skip_sell_fish", "false")

            # --- Step 1: sell fish (Меню → sell_fish → sell_all → confirm) ---
            if skip_sell != "true":
                sent_at = datetime.now(timezone.utc)
                sent_msg = await AccountWorker._send(self.client, chat, "Меню")
                menu_msg = await self._wait_for_buttons(
                    peer, sent_at, timeout=15, reply_to_id=getattr(sent_msg, 'id', None)
                )
                if not menu_msg:
                    log.warning("[%s] _buy_fast_net: no menu", name)
                    return False

                await self._click_button_by_data(peer, menu_msg.id, f"sell_fish_{tg_id}")
                await asyncio.sleep(2)

                sell_msg = await self._get_msg_by_id(peer, menu_msg.id)
                if sell_msg and sell_msg.buttons:
                    clicked = await self._click_button_by_data(
                        peer, sell_msg.id, f"sell_all_{tg_id}"
                    )
                    if clicked:
                        await asyncio.sleep(2)
                        confirm_msg = await self._get_msg_by_id(peer, sell_msg.id)
                        if confirm_msg and confirm_msg.buttons:
                            await self._click_button_by_data(
                                peer, confirm_msg.id, f"confirm_sell_all_{tg_id}"
                            )
                            await asyncio.sleep(2)
            else:
                log.info("[%s] _buy_fast_net: sell step skipped (skip_sell_fish=true)", name)

            # --- Step 2: open shop via Меню (bot edits the reply message in-place) ---
            sent_at2 = datetime.now(timezone.utc)
            sent_msg2 = await AccountWorker._send(self.client, chat, "Меню")
            menu_msg2 = await self._wait_for_buttons(
                peer, sent_at2, timeout=15, reply_to_id=getattr(sent_msg2, 'id', None)
            )
            if not menu_msg2:
                log.warning("[%s] _buy_fast_net: no menu2 for shop", name)
                return False

            ok = await self._click_button_containing(peer, menu_msg2.id, "shop")
            if not ok:
                log.warning("[%s] _buy_fast_net: shop button not found in menu", name)
                return False
            await asyncio.sleep(2)

            # Bot edits menu_msg2 with shop contents
            shop_msg = await self._get_msg_by_id(peer, menu_msg2.id)
            if not shop_msg or not shop_msg.buttons:
                log.warning("[%s] _buy_fast_net: no shop message after menu click", name)
                return False

            # Navigate to nets section
            ok = await self._click_button_containing(peer, shop_msg.id, "shop_nets")
            if not ok:
                log.warning("[%s] _buy_fast_net: shop_nets button not found", name)
                return False
            await asyncio.sleep(2)

            # Bot edits shop message with nets submenu
            nets_msg = await self._get_msg_by_id(peer, shop_msg.id)
            if not nets_msg or not nets_msg.buttons:
                log.warning("[%s] _buy_fast_net: no nets submenu", name)
                return False

            ok = await self._click_button_containing(peer, nets_msg.id, "buy_net_Быстрая сеть")
            if ok:
                await asyncio.sleep(2)
                log.info("[%s] fast net purchased", name)
                await db.add_log(acc_id, name, "net_purchased", "fast net")
            else:
                log.warning("[%s] _buy_fast_net: buy button not found", name)
            return ok

        except ChatJoinWarmupRequired:
            raise
        except Exception as e:
            log.warning("[%s] _buy_fast_net error: %s", name, e)
            return False

    # ------------------------------------------------------------------
    # Net sequence
    # ------------------------------------------------------------------

    async def _do_net_sequence(self, acc: dict, fishing_loc: str, chat: Optional[str] = None):
        name = acc["name"]
        tg_id = acc.get("tg_id")
        acc_id = acc["id"]
        chat = chat or acc["chat"]
        peer = self._get_peer(chat)

        if not tg_id:
            log.warning("[%s] no tg_id, skipping net", name)
            return

        fast_uses = acc.get("net_fast_uses") or 0

        if fast_uses == 0:
            bought = await self._buy_fast_net(acc)
            if bought:
                fast_uses = NET_FAST_MAX_USES
                await db.update_account(acc_id, {"net_fast_uses": fast_uses})
                acc = await db.get_account(acc_id)
            else:
                # Buy failed → basic net in current location, no location change
                log.info("[%s] fast net buy failed — basic net in place", name)

        await self._wait_chat_tool_cooldown(chat, "net")
        try:
            sent_at = datetime.now(timezone.utc)
            sent_msg = await AccountWorker._send(self.client, chat, "сеть")
            await db.add_log(acc_id, name, "net", f"chat={chat}")
        except ChatJoinWarmupRequired:
            raise
        except Exception as e:
            log.warning("[%s] net send error: %s", name, e)
            return

        net_msg = await self._wait_for_buttons(
            peer, sent_at, timeout=15, reply_to_id=getattr(sent_msg, 'id', None)
        )
        if net_msg:
            clicked = await self._click_button_containing(
                peer, net_msg.id, "use_net_Быстрая сеть"
            )
            if clicked:
                new_uses = max(0, fast_uses - 1)
                await db.update_account(acc_id, {"net_fast_uses": new_uses})
                log.info("[%s] used fast net (remaining: %d)", name, new_uses)
            else:
                await self._click_button_containing(
                    peer, net_msg.id, "use_net_Базовая сеть"
                )
        else:
            log.warning("[%s] net: no selection message received", name)

        await db.update_account(acc_id, {
            "net_last_used": datetime.now(timezone.utc).isoformat()
        })

    async def _get_fishing_location(self, acc: dict) -> str:
        mode = await db.get_setting("fishing_location_mode", "Городской пруд")
        if mode == "auto":
            return acc.get("current_location") or "Городской пруд"
        return mode

    # ------------------------------------------------------------------
    # Captcha helpers (unchanged)
    # ------------------------------------------------------------------

    async def _check_chat_for_captcha(
        self,
        client: TelegramClient,
        chat: str,
        sent_at: datetime,
        name: str = "?",
        reply_to_id: Optional[int] = None,
    ) -> bool:
        sent_at_utc = sent_at.astimezone(timezone.utc)
        peer = int(chat) if chat.lstrip("-").isdigit() else chat
        for tick in range(5):
            await asyncio.sleep(2)
            try:
                messages = await client.get_messages(peer, limit=15)
                for msg in messages:
                    if msg.date is None:
                        continue
                    msg_date = msg.date
                    if msg_date.tzinfo is None:
                        msg_date = msg_date.replace(tzinfo=timezone.utc)
                    if msg_date < sent_at_utc:
                        continue
                    if reply_to_id is not None:
                        msg_reply_to = getattr(getattr(msg, "reply_to", None), "reply_to_msg_id", None)
                        if msg_reply_to != reply_to_id:
                            continue
                    text = getattr(msg, 'text', '') or getattr(msg, 'message', '') or ''
                    for kw in ('капч', 'captcha', 'проверк', 'verify'):
                        if kw in text.lower():
                            log.info("[%s] chat_check tick %d: captcha keyword '%s' found (msg_id=%s)",
                                     name, tick + 1, kw, msg.id)
                            return True
            except Exception as e:
                log.warning("[%s] chat_check error: %s", name, e)
        log.info("[%s] chat_check: no captcha reply after 10s", name)
        return False

    async def _check_dm_for_captcha(
        self, client: TelegramClient, bot_entity, sent_at: datetime, name: str = "?"
    ) -> bool:
        """Fallback: check bot DM for a fresh captcha token (bot may not announce in chat)."""
        for tick in range(3):
            await asyncio.sleep(3)
            try:
                token = await extract_token_from_dm(client, bot_entity, sent_after=sent_at)
                if token:
                    log.info("[%s] DM check tick %d: captcha token found in bot DM", name, tick + 1)
                    return True
            except Exception as e:
                log.warning("[%s] DM captcha check error: %s", name, e)
        log.info("[%s] DM check: no captcha token after 9s", name)
        return False

    async def _wait_for_captcha_link(
        self, client: TelegramClient, bot_entity, sent_after: Optional[datetime], name: str = "?"
    ) -> Optional[dict]:
        """Wait for a fresh captcha WebApp button and return its token + exact URL."""
        for tick in range(6):
            try:
                link = await extract_captcha_link_from_dm(client, bot_entity, sent_after=sent_after)
                if link:
                    log.info(
                        "[%s] captcha link found on DM tick %d (msg_id=%s)",
                        name, tick + 1, link.get("message_id"),
                    )
                    return link
            except Exception as e:
                log.warning("[%s] captcha link lookup error: %s", name, e)
            await asyncio.sleep(3)
        log.info("[%s] no captcha link in DM after 18s", name)
        return None

    async def _captcha_loop(
        self, acc: dict, client: TelegramClient,
        sent_at: Optional[datetime] = None,
        sent_msg_id: Optional[int] = None,
        chat: Optional[str] = None,
    ) -> bool:
        name  = acc["name"]
        bot   = (acc.get("captcha_bot") or "@MDfish_bot").strip()
        idata = (acc.get("init_data") or "").strip()

        # Fetch bot entity first — needed for DM fallback check and token extraction
        try:
            bot_entity = await client.get_entity(bot)
        except Exception as e:
            log.warning("[%s] captcha: cannot get bot entity %s: %s", name, bot, e)
            await db.add_log(acc["id"], name, "captcha_failed", f"get_entity error: {e}")
            return False

        dm_cutoff = sent_at

        # === Open WebApp ONCE at the start ===
        # Get fresh init_data once, reuse for all captcha attempts
        first_link = None
        idata_for_all = idata  # fallback to existing if available
        
        if sent_at is not None:
            captcha_needed = await self._check_chat_for_captcha(
                client, chat or acc["chat"], sent_at, name=name, reply_to_id=sent_msg_id
            )
            if not captcha_needed:
                log.info("[%s] no captcha reply in chat — skipping DM captcha lookup", name)
                return False
            first_link = await self._wait_for_captcha_link(
                client, bot_entity, sent_after=sent_at, name=name
            )
            if not first_link:
                log.info("[%s] captcha reply found, but no fresh DM captcha link", name)
                return False
            
            # Open WebApp ONCE here to get a fresh init_data
            fresh = await self._refresh_init_data(
                acc, client, webapp_url=first_link["url"], bot_entity=bot_entity
            )
            if fresh:
                idata_for_all = fresh
                log.info("[%s] opened WebApp once for fresh init_data (age=%.0fs)", 
                         name, self._init_data_age_seconds(idata_for_all) or 0)
            elif not idata_for_all:
                log.warning("[%s] no init_data and refresh failed", name)
                await db.add_log(acc["id"], name, "captcha_failed", "no initData, first refresh failed")
                return False

        for attempt in range(1, 6):
            log.info("[%s] captcha attempt %d/5...", name, attempt)
            link = first_link
            first_link = None
            if not link:
                link = await self._wait_for_captcha_link(
                    client, bot_entity, sent_after=dm_cutoff, name=name
                )

            if not link:
                log.info("[%s] captcha attempt %d: no fresh token", name, attempt)
                break

            token = link["token"]
            await db.add_log(acc["id"], name, "captcha_detected",
                             f"attempt {attempt}, token {token[:12]}..., msg_id={link.get('message_id')}")

            # REUSE the same init_data for all attempts (no refresh here)
            log.info("[%s] solving captcha with token=%s..., init_data len=%d age=%.0fs (attempt %d)",
                     name, token[:12], len(idata_for_all), self._init_data_age_seconds(idata_for_all) or 0, attempt)
            
            # Brief delay to ensure server has processed the WebApp request
            await asyncio.sleep(0.2)
            
            result = await solve_captcha(token, idata_for_all)

            event  = "captcha_solved" if result["ok"] else "captcha_failed"
            detail = (f"{result.get('question', '')} -> "
                      f"{result.get('answer', result.get('error', ''))}")
            log.info("[%s] %s: %s", name, event, detail)
            await db.add_log(acc["id"], name, event, detail)

            if result["ok"]:
                await asyncio.sleep(1)
                try:
                    await self._send(client, acc["chat"], acc["message"])
                    await db.add_log(acc["id"], name, "sent", "auto after captcha solve")
                except ChatJoinWarmupRequired:
                    raise
                except Exception as se:
                    log.warning("[%s] send-after-solve error: %s", name, se)
                return True

            error = result.get("error", "")
            if error in ("challenge_not_found", "challenge_expired"):
                await db.add_log(acc["id"], name, "captcha_auto_passed_or_expired", error)
                log.info("[%s] captcha no longer active after WebApp open: %s", name, error)
                return False

            if error in ("penalty_active", "auth_invalid", "auth_failed"):
                log.info("[%s] captcha stopped: %s", name, error)
                break

            if attempt < 5:
                dm_cutoff = datetime.now(timezone.utc)
                await asyncio.sleep(1)
                try:
                    await self._send(client, acc["chat"], acc["message"])
                except ChatJoinWarmupRequired:
                    raise
                except Exception as se:
                    log.warning("[%s] retry-send error: %s", name, se)
                    break

        return False

    # ------------------------------------------------------------------
    # Casual chat / DM chatter
    # ------------------------------------------------------------------

    async def _maybe_send_casual(self, acc: dict):
        """With ~15% chance, send a casual random message in the group chat.
        Sometimes replies to a recent message from another account in the same chat."""
        if random.random() > 0.15:
            return
        delay = random.uniform(15, 120)
        await asyncio.sleep(delay)
        if self._stop_event.is_set():
            return
        if not self.client or not self.client.is_connected():
            return

        chat = acc["chat"]
        peer = self._get_peer(chat)
        msg = _random_casual_msg()
        reply_to = None

        if random.random() < 0.40:  # 40% chance to reply to another account
            try:
                all_accs = await db.get_accounts_by_chat(chat)
                other_ids = {
                    a["tg_id"] for a in all_accs
                    if a["tg_id"] and a["tg_id"] != acc.get("tg_id")
                }
                if other_ids:
                    msgs = await self.client.get_messages(peer, limit=30)
                    candidates = [
                        m for m in msgs
                        if getattr(getattr(m, 'from_id', None), 'user_id', None) in other_ids
                    ]
                    if candidates:
                        reply_to = random.choice(candidates[:5]).id
            except Exception as e:
                log.debug("[%s] casual reply lookup: %s", acc["name"], e)

        try:
            await self.client.send_message(peer, msg, reply_to=reply_to)
            suffix = f" (reply→{reply_to})" if reply_to else ""
            log.info("[%s] casual chat: %r%s", acc["name"], msg, suffix)
            await db.add_log(acc["id"], acc["name"], "casual_chat", msg)
        except Exception as e:
            log.warning("[%s] casual chat error: %s", acc["name"], e)

    async def _maybe_send_casual_dm(self, acc: dict):
        """With ~5% chance, send a casual DM to another account in the same chat."""
        if random.random() > 0.05:
            return
        delay = random.uniform(60, 300)
        await asyncio.sleep(delay)
        if self._stop_event.is_set():
            return
        if not self.client or not self.client.is_connected():
            return

        chat = acc["chat"]
        try:
            all_accs = await db.get_accounts_by_chat(chat)
            others = [
                a for a in all_accs
                if a["tg_id"] and a["tg_id"] != acc.get("tg_id") and a["enabled"]
            ]
            if not others:
                return
            target = random.choice(others)
            msg = _random_casual_msg()
            target_id = int(target["tg_id"])

            # Resolve entity — Telethon needs access_hash; find it from recent chat messages
            entity = None
            try:
                entity = await self.client.get_entity(target_id)
            except Exception:
                peer = self._get_peer(chat)
                try:
                    recent = await self.client.get_messages(peer, limit=50)
                    for m in recent:
                        from_id = getattr(getattr(m, 'from_id', None), 'user_id', None)
                        if from_id == target_id:
                            entity = await self.client.get_entity(m.from_id)
                            break
                except Exception:
                    pass

            if entity is None:
                log.debug("[%s] casual DM skipped: entity not cached for %s",
                          acc["name"], target["tg_name"])
                return

            await self.client.send_message(entity, msg)
            log.info("[%s] casual DM to %s: %r", acc["name"], target["tg_name"], msg)
            await db.add_log(acc["id"], acc["name"], "casual_dm",
                             f"→ {target['tg_name']}: {msg}")
            self._spawn_background(self._mark_casual_dm_read(acc, target), limit=3)
        except Exception as e:
            log.warning("[%s] casual dm error: %s", acc["name"], e)

    async def _mark_casual_dm_read(self, sender: dict, target: dict):
        """After an internal DM, make the target account mark sender's dialog as read."""
        await asyncio.sleep(1)
        if self._stop_event.is_set():
            return

        session = target.get("session_string")
        if not session:
            return

        client = TelegramClient(StringSession(session), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                if TWO_FA_PASSWORD:
                    await client.sign_in(password=TWO_FA_PASSWORD)
                else:
                    log.debug("[%s] casual DM read skipped: target session unauthorized",
                              target.get("name"))
                    return

            sender_id = int(sender["tg_id"]) if sender.get("tg_id") else None
            entity = None

            if sender_id:
                try:
                    entity = await client.get_entity(sender_id)
                except Exception:
                    pass

            if entity is None and sender.get("tg_name"):
                try:
                    entity = await client.get_entity(sender["tg_name"])
                except Exception:
                    pass

            if entity is None and sender_id:
                try:
                    async for dialog in client.iter_dialogs():
                        if getattr(dialog.entity, "id", None) == sender_id:
                            entity = dialog.entity
                            break
                except Exception as e:
                    log.debug("[%s] casual DM read dialog lookup: %s",
                              target.get("name"), e)

            if entity is None:
                log.debug("[%s] casual DM read skipped: sender entity not found for %s",
                          target.get("name"), sender.get("tg_name") or sender.get("name"))
                return

            await client.send_read_acknowledge(entity)
            await db.add_log(target["id"], target["name"], "casual_dm_read",
                             f"from {sender.get('tg_name') or sender.get('name')}")
        except Exception as e:
            log.warning("[%s] casual dm read error: %s", target.get("name"), e)
        finally:
            await client.disconnect()

    async def send_once(self, acc: dict) -> dict:
        client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            sent_at = datetime.now(timezone.utc)
            sent_msg = await self._send(client, acc["chat"], acc["message"])
            await db.add_log(acc["id"], acc["name"], "sent", f"manual -> {acc['chat']}")

            asyncio.create_task(
                self._captcha_bg(acc, client, sent_at, getattr(sent_msg, "id", None))
            )
            return {"ok": True, "message": acc["message"], "captcha": "detecting..."}

            await client.disconnect()
            return {"ok": True, "message": acc["message"]}
        except ChatJoinWarmupRequired as e:
            await self._apply_chat_join_warmup(acc, e.chat)
            await client.disconnect()
            return {"ok": False, "error": f"joined {e.chat}; warming up {e.seconds // 60} min"}
        except Exception as e:
            await client.disconnect()
            await db.add_log(acc["id"], acc["name"], "error", str(e))
            return {"ok": False, "error": str(e)}

    async def send_text_once(self, acc: dict, text: str, target: str = "primary") -> dict:
        client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            target_chat = acc["chat"]
            target_label = "основной"
            if (target or "primary").strip().lower() == "secondary":
                secondary_chat = (acc.get("secondary_chat") or "").strip()
                if not secondary_chat:
                    return {"ok": False, "error": "secondary chat not set"}
                if not self._secondary_chat_ready(acc):
                    return {"ok": False, "error": "secondary chat is not ready"}
                target_chat = secondary_chat
                target_label = "второстепенный"
            await self._send(client, target_chat, text)
            await db.add_log(acc["id"], acc["name"], "manual_text", f"manual -> {target_label} чат {target_chat}: {text}")
            return {"ok": True, "message": text}
        except ChatJoinWarmupRequired as e:
            await self._apply_chat_join_warmup(acc, e.chat)
            return {"ok": False, "error": f"joined {e.chat}; warming up {e.seconds // 60} min"}
        except Exception as e:
            await db.add_log(acc["id"], acc["name"], "error", str(e))
            return {"ok": False, "error": str(e)}
        finally:
            await client.disconnect()

    async def _captcha_bg(
        self,
        acc: dict,
        client: TelegramClient,
        sent_at: Optional[datetime] = None,
        sent_msg_id: Optional[int] = None,
    ):
        try:
            await self._captcha_loop(acc, client, sent_at=sent_at, sent_msg_id=sent_msg_id)
        except ChatJoinWarmupRequired as e:
            await self._apply_chat_join_warmup(acc, e.chat)
            await db.add_log(acc["id"], acc["name"], "captcha_join_warmup", str(e))
        except Exception as e:
            log.warning("[%s] _captcha_bg error: %s", acc["name"], e)
            await db.add_log(acc["id"], acc["name"], "captcha_failed", str(e))
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass

    async def solve_captcha_once(self, acc: dict) -> dict:
        acc = {**acc, "captcha_bot": (acc.get("captcha_bot") or "@MDfish_bot").strip()}

        client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            solved = await self._captcha_loop(acc, client)
            return {"ok": solved, "error": "" if solved else "captcha_not_solved"}
        except ChatJoinWarmupRequired as e:
            await self._apply_chat_join_warmup(acc, e.chat)
            return {"ok": False, "error": f"joined {e.chat}; warming up {e.seconds // 60} min"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
        finally:
            await client.disconnect()

    async def send_tour_once(self, acc: dict) -> dict:
        bot = (acc.get("captcha_bot") or "@MDfish_bot").strip()

        client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            bot_entity = await client.get_entity(bot)
            sent_msg = await client.send_message(bot_entity, "/tour")
            sent_id = sent_msg.id

            # Look for any incoming message from the bot with ID > our sent message
            for _ in range(10):
                await asyncio.sleep(2)
                msgs = await client.get_messages(bot_entity, limit=10)
                for msg in msgs:
                    if msg.id <= sent_id:
                        break  # newest-first; past our sent msg — nothing newer
                    if msg.out:
                        continue  # skip our own messages
                    text = getattr(msg, 'text', '') or getattr(msg, 'message', '') or ''
                    if text:
                        return {"ok": True, "text": text}

            return {"ok": False, "error": "no_reply"}
        except Exception as e:
            return {"ok": False, "error": str(e)}
        finally:
            await client.disconnect()

    # ------------------------------------------------------------------
    # Client factory (handles MTProto proxy)
    # ------------------------------------------------------------------

    def _create_direct_client(self, acc: dict) -> TelegramClient:
        return TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)

    async def _create_client(self, acc: dict) -> TelegramClient:
        """Return a TelegramClient, using the account's MTProto proxy if set."""
        proxy_id = acc.get("proxy_id")
        if proxy_id:
            proxy = await db.get_proxy(proxy_id)
            if proxy and proxy["status"] == "active":
                try:
                    from telethon.network import ConnectionTcpMTProxyRandomizedIntermediate
                    secret = str(proxy["secret"]).strip()
                    if not secret:
                        raise ValueError("empty MTProxy secret")
                    return TelegramClient(
                        StringSession(acc["session_string"]), API_ID, API_HASH,
                        connection=ConnectionTcpMTProxyRandomizedIntermediate,
                        proxy=(proxy["server"], proxy["port"], secret),
                        **PROXY_CLIENT_KWARGS,
                    )
                except Exception as e:
                    log.warning("[%s] proxy client init error: %s", acc["name"], e)
        return self._create_direct_client(acc)

    async def _retire_account_proxy(self, acc: dict, reason: str) -> bool:
        proxy_id = acc.get("proxy_id")
        if not proxy_id:
            return False
        name = acc.get("name") or str(acc.get("id"))
        err_str = str(reason)[:500]
        log.info("[%s] proxy %d failed during work: %s; marking dead", name, proxy_id, err_str)
        await db.mark_proxy_dead(proxy_id, err_str)
        await db.reassign_proxy_accounts(proxy_id)
        await db.add_log(acc["id"], name, "proxy_dead", f"proxy {proxy_id} dead during work")
        return True

    async def _apply_chat_join_warmup(self, acc: dict, chat: str) -> int:
        acc_id = acc["id"]
        name = acc.get("name") or str(acc_id)
        wait_seconds = CHAT_JOIN_WARMUP_SECONDS
        next_dt = datetime.now(pytz.timezone("Europe/Moscow")) + timedelta(seconds=wait_seconds)
        available_at = datetime.now(timezone.utc) + timedelta(seconds=wait_seconds)
        updates = {}

        if str(chat) == str(acc.get("chat")):
            updates.update({
                "chat_status": "joined",
                "setup_status": "working",
                "chat_error": "",
            })
        if acc.get("secondary_chat") and str(chat) == str(acc.get("secondary_chat")):
            updates.update({
                "secondary_chat_status": "joined",
                "secondary_chat_error": "",
                "secondary_chat_available_at": available_at.isoformat(),
            })

        if updates:
            await db.update_account(acc_id, updates)
        await db.set_next_send(acc_id, next_dt)
        await db.add_log(acc_id, name, "chat_join_warmup", f"{chat} | {wait_seconds // 60} min")
        log.info("[%s] joined %s before send; warming up %.1f min", name, chat, wait_seconds / 60)
        return wait_seconds

    async def _auto_delete_account(self, acc_id: int, name: str, reason: str):
        log.warning("[%s] globally restricted — auto-deleting account: %s", name, reason)
        await db.add_log(acc_id, name, "auto_deleted", reason)
        await scheduler.remove_forest_account(acc_id)
        await db.delete_account(acc_id)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def _run(self):
        acc_id = self.acc_id
        name = "?"
        try:
            while not self._stop_event.is_set():
                acc = await db.get_account(acc_id)
                if not acc or not acc["enabled"]:
                    log.info("[%s] disabled or deleted, stopping", acc_id)
                    return

                name = acc["name"]
                tz   = pytz.timezone("Europe/Moscow")
                now  = datetime.now(tz)

                # Sleep check — outside lock, never hold lock while sleeping
                sleeping, wake_in = is_sleeping(now, acc["sleep_start"], acc["sleep_end"])
                if sleeping:
                    wake_in = wake_in or 3600
                    log.info("[%s] sleeping %.0f min", name, wake_in / 60)
                    await db.add_log(acc_id, name, "sleep", f"zzz {wake_in/60:.0f} min")
                    try:
                        await asyncio.wait_for(self._stop_event.wait(), timeout=wake_in)
                    except asyncio.TimeoutError:
                        pass
                    continue

                if acc.get("next_send_at"):
                    try:
                        next_dt = datetime.fromisoformat(acc["next_send_at"])
                        if next_dt.tzinfo is None:
                            next_dt = tz.localize(next_dt)
                        wait_seconds = (next_dt.astimezone(tz) - now).total_seconds()
                    except Exception:
                        wait_seconds = 0
                    if wait_seconds > 1:
                        log.info("[%s] waiting %.1f min before work", name, wait_seconds / 60)
                        try:
                            await asyncio.wait_for(self._stop_event.wait(), timeout=wait_seconds)
                        except asyncio.TimeoutError:
                            pass
                        continue

                # Connect — outside lock (TCP handshake + optional MTProto proxy)
                if not self.client or not self.client.is_connected():
                    self.client = await self._create_client(acc)
                    try:
                        await self.client.connect()
                        if not await self.client.is_user_authorized():
                            if TWO_FA_PASSWORD:
                                await self.client.sign_in(password=TWO_FA_PASSWORD)
                            else:
                                raise RuntimeError("Session not authorized and TG_2FA_PASSWORD not set")
                        me = await self.client.get_me()
                        log.info("[%s] connected as %s", name, me.username or me.first_name)
                        await self._ensure_private_dm_handler(acc)
                    except SessionPasswordNeededError:
                        if TWO_FA_PASSWORD:
                            await self.client.sign_in(password=TWO_FA_PASSWORD)
                            me = await self.client.get_me()
                            log.info("[%s] 2FA auth OK, connected as %s", name, me.username or me.first_name)
                            await self._ensure_private_dm_handler(acc)
                        else:
                            log.error("[%s] 2FA required but TG_2FA_PASSWORD not set", name)
                            await db.add_log(acc_id, name, "error", "2FA required, set TG_2FA_PASSWORD")
                            return
                    except AuthKeyDuplicatedError:
                        log.error("[%s] auth key duplicated — session killed by Telegram (two IPs), stopping worker", name)
                        await db.add_log(acc_id, name, "auth_key_duplicated", "session invalidated by Telegram, needs new session file")
                        return
                    except Exception as conn_err:
                        proxy_id = acc.get("proxy_id")
                        if proxy_id:
                            err_str = str(conn_err)
                            log.info("[%s] proxy %d unreachable: %s; marking dead",
                                        name, proxy_id, err_str)
                            await db.mark_proxy_dead(proxy_id, err_str)
                            await db.reassign_proxy_accounts(proxy_id)
                            await db.add_log(acc_id, name, "proxy_dead",
                                             f"proxy {proxy_id} dead, reassigned")
                            await self._disconnect_client(self.client)
                            # Retry without proxy
                            acc = await db.get_account(acc_id)
                            self.client = self._create_direct_client(acc)
                            await self.client.connect()
                            me = await self.client.get_me()
                            log.info("[%s] reconnected direct (no proxy)", name)
                            await self._ensure_private_dm_handler(acc)
                        else:
                            raise

                if await self._check_nft_watch(acc):
                    return

                await self._ensure_secondary_chat_joined(acc)
                acc = await db.get_account(acc_id)
                if not acc:
                    return

                # --- Serialized game interactions (per-chat lock) ---
                # Errors are collected inside the lock and handled outside
                flood_wait_sec = None
                slow_mode_sec  = None
                send_failed    = False
                captcha_solved = False

                async with AccountWorker._get_lock(acc["chat"]):
                    # Re-read after potentially waiting for lock
                    acc = await db.get_account(acc_id)
                    if not acc or not acc["enabled"]:
                        return

                    fishing_loc = await self._get_fishing_location(acc)

                    # Dynamite and net are skipped until the account has sent fish at least once
                    # (sending fish creates the account in MDfish; dynamite/net do not)
                    account_exists = (acc.get("fish_cast_count") or 0) > 0

                    # Dynamite
                    if account_exists and self._is_timer_ready(acc.get("dynamite_last_used"), DYNAMITE_INTERVAL):
                        try:
                            await self._do_dynamite_sequence(acc, fishing_loc, self._pick_work_chat(acc))
                            acc = await db.get_account(acc_id)
                        except ChatJoinWarmupRequired as e:
                            await self._apply_chat_join_warmup(acc, e.chat)
                            continue
                        except Exception as e:
                            log.warning("[%s] dynamite error: %s", name, e)

                    # Net — always 12h interval; buy fast net if depleted
                    acc = await db.get_account(acc_id)
                    if account_exists and self._is_timer_ready(acc.get("net_last_used"), NET_FAST_INTERVAL):
                        try:
                            await self._do_net_sequence(acc, fishing_loc, self._pick_work_chat(acc))
                            acc = await db.get_account(acc_id)
                            fishing_loc = await self._get_fishing_location(acc)
                        except ChatJoinWarmupRequired as e:
                            await self._apply_chat_join_warmup(acc, e.chat)
                            continue
                        except Exception as e:
                            log.warning("[%s] net error: %s", name, e)

                    # Send фиш — pick randomly from command list when using default message
                    acc = await db.get_account(acc_id)
                    sent_at = datetime.now(timezone.utc)
                    try:
                        skip_fish, skips_left = self._should_skip_fish()
                        if skip_fish:
                            log.info("[%s] fish skipped (chain left: %d)", name, skips_left)
                            await db.add_log(acc_id, name, "fish_skipped", f"chain_left={skips_left}")
                        else:
                            bot_tag = (acc.get("captcha_bot") or "@MDfish_bot").lstrip("@")
                            if acc["message"] == "фиш":
                                fish_pool = [*FISH_COMMANDS, f"/fish@{bot_tag}"]
                                msg_to_send = random.choice(fish_pool)
                            else:
                                msg_to_send = acc["message"]
                            work_chat = self._pick_work_chat(acc)
                            sent_msg = await AccountWorker._send(self.client, work_chat, msg_to_send)
                            log.info("[%s] sent '%s'", name, msg_to_send)
                            await db.add_log(acc_id, name, "sent", f"{msg_to_send} | chat={work_chat}")
                            try:
                                if getattr(sent_msg, 'id', None):
                                    self._recent_sent.append({
                                        'chat': work_chat,
                                        'msg_id': getattr(sent_msg, 'id', None),
                                        'ts': sent_at,
                                    })
                            except Exception:
                                pass
                            await self._maybe_react_to_bot_reply(
                                acc,
                                sent_at,
                                getattr(sent_msg, "id", None),
                                chat=work_chat,
                            )

                            # Cast count + auto location rotation
                            cast_count = (acc.get("fish_cast_count") or 0) + 1
                            updates = {"fish_cast_count": cast_count}
                            fishing_mode = await db.get_setting("fishing_location_mode", "Городской пруд")
                            if fishing_mode == "auto" and cast_count >= AUTO_ROTATE_CASTS:
                                current_loc = acc.get("current_location") or "Городской пруд"
                                new_loc = random.choice([l for l in LOCATIONS if l != current_loc])
                                try:
                                    await self._change_location_sequence(acc, new_loc)
                                    updates["current_location"] = new_loc
                                    log.info("[%s] auto-rotate: %s -> %s", name, current_loc, new_loc)
                                except ChatJoinWarmupRequired:
                                    raise
                                except Exception as e:
                                    log.warning("[%s] auto-rotate error: %s", name, e)
                                updates["fish_cast_count"] = 0
                            await db.update_account(acc_id, updates)

                            # Captcha
                            captcha_solved = await self._captcha_loop(
                                acc,
                                self.client,
                                sent_at=sent_at,
                                sent_msg_id=getattr(sent_msg, "id", None),
                                chat=work_chat,
                            )

                    except FloodWaitError as e:
                        flood_wait_sec = e.seconds
                        await db.add_log(acc_id, name, "flood_wait", f"{e.seconds}s")
                    except SlowModeWaitError as e:
                        slow_mode_sec = e.seconds
                        await db.add_log(acc_id, name, "slow_mode", f"{e.seconds}s")
                    except ChatJoinWarmupRequired as e:
                        await self._apply_chat_join_warmup(acc, e.chat)
                        continue
                    except UserRestrictedError as e:
                        await self._auto_delete_account(acc_id, name, str(e))
                        return
                    except (ChannelPrivateError, UserBannedInChannelError, ChatForbiddenError) as e:
                        await db.update_account(acc_id, {
                            "enabled": False,
                            "chat_status": "banned",
                            "setup_status": "banned",
                            "chat_error": str(e),
                        })
                        await db.add_log(acc_id, name, "banned", str(e))
                        log.warning("[%s] banned from chat during send — account disabled", name)
                        return
                    except Exception as e:
                        log.exception("[%s] send error", name)
                        await db.add_log(acc_id, name, "error", str(e))
                        await self._retire_account_proxy(acc, str(e))
                        send_failed = True
                        try:
                            await self.client.disconnect()
                        except Exception:
                            pass
                        self.client = None
                # --- Lock released ---

                # Background casual chatter — fire and forget, outside lock
                if not send_failed:
                    acc_snap = dict(acc)
                    self._spawn_background(self._maybe_send_casual_dm(acc_snap), limit=3)
                    # Periodic external-reply check (lightweight): once per minute
                    try:
                        now_utc = datetime.now(timezone.utc)
                        if (now_utc - self._last_reply_check).total_seconds() >= 60:
                            self._spawn_background(self._check_external_replies(acc_snap), limit=3)
                            self._last_reply_check = now_utc
                    except Exception:
                        pass

                if flood_wait_sec:
                    log.warning("[%s] FloodWait %ds", name, flood_wait_sec)
                    try:
                        await asyncio.wait_for(self._stop_event.wait(), timeout=flood_wait_sec + 5)
                    except asyncio.TimeoutError:
                        pass
                    continue

                if slow_mode_sec:
                    log.warning("[%s] SlowMode %ds", name, slow_mode_sec)
                    try:
                        await asyncio.wait_for(self._stop_event.wait(), timeout=slow_mode_sec + 2)
                    except asyncio.TimeoutError:
                        pass
                    continue

                if send_failed:
                    try:
                        await asyncio.wait_for(self._stop_event.wait(), timeout=60)
                    except asyncio.TimeoutError:
                        pass
                    continue

                if captcha_solved:
                    # captcha loop already sent the next фиш — loop immediately
                    continue

                # Schedule next send
                acc    = await db.get_account(acc_id)
                base   = max(10, acc["interval_minutes"]) * 60
                jitter = acc["jitter_minutes"] * 60
                delay  = max(660, base + random.uniform(-jitter, jitter))
                next_dt = datetime.now(tz) + timedelta(seconds=delay)
                await db.set_next_send(acc_id, next_dt)
                log.info("[%s] next in %.1f min (%s)", name, delay / 60,
                         next_dt.strftime("%H:%M:%S"))
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass

        except asyncio.CancelledError:
            log.info("[%s] worker cancelled", name)
        except AuthKeyDuplicatedError:
            log.error("[%s] auth key duplicated — session killed by Telegram, worker stopped permanently", name)
            await db.add_log(acc_id, name, "auth_key_duplicated", "session invalidated by Telegram, needs new session file")
        except Exception:
            log.exception("[%s] worker crashed", name)
            await db.add_log(acc_id, name, "crash", "worker died, restarting in 60s")
            await asyncio.sleep(60)
            if not self._stop_event.is_set():
                await self.start()
        finally:
            if self.client:
                try:
                    await self.client.disconnect()
                except Exception:
                    pass
                self.client = None


class ForestWorker(AccountWorker):
    _forest_lock = asyncio.Lock()

    @staticmethod
    def _parse_dt(value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            return None

    @staticmethod
    def _next_delay(base_seconds: int, jitter_seconds: int) -> float:
        return max(60, base_seconds + random.uniform(-jitter_seconds, jitter_seconds))

    @staticmethod
    def _next_net_delay() -> float:
        return FOREST_NET_INTERVAL_SECONDS + random.uniform(0, FOREST_NET_JITTER_SECONDS)

    async def _apply_forest_join_warmup(self, acc_id: int, name: str, chat: str) -> int:
        wait_seconds = FOREST_WARMUP_SECONDS
        available_at = datetime.now(timezone.utc) + timedelta(seconds=wait_seconds)
        await db.update_account(acc_id, {
            "forest_chat_status": "joined",
            "forest_chat_error": "",
            "forest_available_at": available_at.isoformat(),
            "forest_next_fish_at": available_at.isoformat(),
            "forest_next_net_at": available_at.isoformat(),
        })
        await db.add_log(acc_id, name, "forest_join_warmup", f"{chat} | {wait_seconds // 60} min")
        log.info("[%s] joined forest chat before send; warming up %.1f min", name, wait_seconds / 60)
        return wait_seconds

    async def _wait_until(self, dt: datetime) -> bool:
        while not self._stop_event.is_set():
            wait_seconds = (dt - datetime.now(timezone.utc)).total_seconds()
            if wait_seconds <= 1:
                return True
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=min(wait_seconds, 60))
                return False
            except asyncio.TimeoutError:
                pass
        return False

    async def _run(self):
        acc_id = self.acc_id
        name = "?"
        try:
            while not self._stop_event.is_set():
                acc = await db.get_account(acc_id)
                if not acc or not acc.get("forest_enabled"):
                    return

                name = acc.get("name") or str(acc_id)
                if (acc.get("forest_chat_status") or "queued") != "joined":
                    try:
                        await asyncio.wait_for(self._stop_event.wait(), timeout=30)
                    except asyncio.TimeoutError:
                        pass
                    continue

                available_at = self._parse_dt(acc.get("forest_available_at"))
                if available_at and available_at > datetime.now(timezone.utc):
                    await self._wait_until(available_at)
                    continue

                next_fish_at = self._parse_dt(acc.get("forest_next_fish_at"))
                if next_fish_at and next_fish_at > datetime.now(timezone.utc):
                    await self._wait_until(next_fish_at)
                    continue

                if not self.client or not self.client.is_connected():
                    self.client = await self._create_client(acc)
                    try:
                        await self.client.connect()
                        if not await self.client.is_user_authorized():
                            if TWO_FA_PASSWORD:
                                await self.client.sign_in(password=TWO_FA_PASSWORD)
                            else:
                                raise RuntimeError("Session not authorized and TG_2FA_PASSWORD not set")
                        await self._ensure_private_dm_handler(acc)
                    except SessionPasswordNeededError:
                        if TWO_FA_PASSWORD:
                            await self.client.sign_in(password=TWO_FA_PASSWORD)
                            await self._ensure_private_dm_handler(acc)
                        else:
                            log.error("[%s] 2FA required but TG_2FA_PASSWORD not set", name)
                            await db.add_log(acc_id, name, "error", "2FA required, set TG_2FA_PASSWORD")
                            return
                    except AuthKeyDuplicatedError:
                        log.error("[%s] forest auth key duplicated — session killed by Telegram, stopping worker", name)
                        await db.add_log(acc_id, name, "auth_key_duplicated", "session invalidated by Telegram, needs new session file")
                        return
                    except Exception as conn_err:
                        proxy_id = acc.get("proxy_id")
                        if not proxy_id:
                            raise
                        err_str = str(conn_err)
                        log.info("[%s] forest proxy %d unreachable: %s; marking dead",
                                 name, proxy_id, err_str)
                        await db.mark_proxy_dead(proxy_id, err_str)
                        await db.reassign_proxy_accounts(proxy_id)
                        await db.add_log(acc_id, name, "proxy_dead",
                                         f"forest proxy {proxy_id} dead, reassigned")
                        await self._disconnect_client(self.client)

                        acc = await db.get_account(acc_id)
                        if not acc or not acc.get("forest_enabled"):
                            return
                        self.client = self._create_direct_client(acc)
                        await self.client.connect()
                        if not await self.client.is_user_authorized():
                            if TWO_FA_PASSWORD:
                                await self.client.sign_in(password=TWO_FA_PASSWORD)
                            else:
                                raise RuntimeError("Session not authorized and TG_2FA_PASSWORD not set")
                        log.info("[%s] forest reconnected direct (no proxy)", name)
                        await self._ensure_private_dm_handler(acc)

                async with ForestWorker._forest_lock:
                    acc = await db.get_account(acc_id)
                    if not acc or not acc.get("forest_enabled"):
                        return
                    if (acc.get("forest_chat_status") or "queued") != "joined":
                        continue

                    peer = self._get_peer(FOREST_CHAT_LINK)
                    now = datetime.now(timezone.utc)
                    next_net_at = self._parse_dt(acc.get("forest_next_net_at"))
                    if not next_net_at:
                        last_net = self._parse_dt(acc.get("forest_net_last_used"))
                        next_net_at = (last_net + timedelta(seconds=FOREST_NET_INTERVAL_SECONDS)) if last_net else now

                    if next_net_at <= now:
                        try:
                            await AccountWorker._send(self.client, peer, f"/net@{FOREST_BOT_USERNAME}")
                            next_net = now + timedelta(seconds=self._next_net_delay())
                            await db.update_account(acc_id, {
                                "forest_net_last_used": now.isoformat(),
                                "forest_next_net_at": next_net.isoformat(),
                                "forest_net_count": (acc.get("forest_net_count") or 0) + 1,
                            })
                            await db.add_log(acc_id, name, "forest_net", f"chat={FOREST_CHAT_LABEL}")
                            acc = await db.get_account(acc_id)
                        except (FloodWaitError, SlowModeWaitError) as e:
                            wait = getattr(e, "seconds", 60)
                            await db.add_log(acc_id, name, "forest_wait", f"{type(e).__name__}: {wait}s")
                            await asyncio.sleep(wait + 2)
                            continue
                        except ChatJoinWarmupRequired as e:
                            await self._apply_forest_join_warmup(acc_id, name, e.chat)
                            continue
                        except UserRestrictedError as e:
                            await self._auto_delete_account(acc_id, name, str(e))
                            return
                        except (ChannelPrivateError, UserBannedInChannelError, ChatForbiddenError) as e:
                            await db.update_account(acc_id, {
                                "forest_enabled": False,
                                "forest_chat_status": "banned",
                                "forest_chat_error": str(e),
                            })
                            await db.add_log(acc_id, name, "forest_banned", str(e))
                            log.warning("[%s] forest banned during net — forest disabled", name)
                            return
                        except Exception as e:
                            await db.add_log(acc_id, name, "forest_error", str(e))
                            await self._retire_account_proxy(acc, str(e))
                            try:
                                await self.client.disconnect()
                            except Exception:
                                pass
                            self.client = None
                            await asyncio.sleep(60)
                            continue

                    fish_pool = ["фиш", f"/fish@{FOREST_BOT_USERNAME}"]
                    msg_to_send = random.choice(fish_pool)
                    try:
                        await AccountWorker._send(self.client, peer, msg_to_send)
                        next_fish = datetime.now(timezone.utc) + timedelta(
                            seconds=self._next_delay(FOREST_FISH_INTERVAL_SECONDS, FOREST_FISH_JITTER_SECONDS)
                        )
                        await db.update_account(acc_id, {
                            "forest_next_fish_at": next_fish.isoformat(),
                            "forest_fish_count": (acc.get("forest_fish_count") or 0) + 1,
                        })
                        await db.add_log(acc_id, name, "forest_fish", f"{msg_to_send} | chat={FOREST_CHAT_LABEL}")
                    except FloodWaitError as e:
                        await db.add_log(acc_id, name, "forest_wait", f"FloodWait: {e.seconds}s")
                        await asyncio.sleep(e.seconds + 5)
                    except SlowModeWaitError as e:
                        await db.add_log(acc_id, name, "forest_wait", f"SlowMode: {e.seconds}s")
                        await asyncio.sleep(e.seconds + 2)
                    except ChatJoinWarmupRequired as e:
                        await self._apply_forest_join_warmup(acc_id, name, e.chat)
                        continue
                    except UserRestrictedError as e:
                        await self._auto_delete_account(acc_id, name, str(e))
                        return
                    except (ChannelPrivateError, UserBannedInChannelError, ChatForbiddenError) as e:
                        await db.update_account(acc_id, {
                            "forest_enabled": False,
                            "forest_chat_status": "banned",
                            "forest_chat_error": str(e),
                        })
                        await db.add_log(acc_id, name, "forest_banned", str(e))
                        log.warning("[%s] forest banned during fish — forest disabled", name)
                        return
                    except Exception as e:
                        await db.add_log(acc_id, name, "forest_error", str(e))
                        await self._retire_account_proxy(acc, str(e))
                        try:
                            await self.client.disconnect()
                        except Exception:
                            pass
                        self.client = None
                        await asyncio.sleep(60)

        except asyncio.CancelledError:
            log.info("[%s] forest worker cancelled", name)
        except AuthKeyDuplicatedError:
            log.error("[%s] forest auth key duplicated — session killed by Telegram, worker stopped permanently", name)
            await db.add_log(acc_id, name, "auth_key_duplicated", "session invalidated by Telegram, needs new session file")
        except Exception:
            log.exception("[%s] forest worker crashed", name)
            await db.add_log(acc_id, name, "forest_crash", "worker died, restarting in 60s")
            await asyncio.sleep(60)
            if not self._stop_event.is_set():
                await self.start()
        finally:
            if self.client:
                try:
                    await self.client.disconnect()
                except Exception:
                    pass
                self.client = None


class Scheduler:
    def __init__(self):
        self._workers: dict[int, AccountWorker] = {}
        self._forest_workers: dict[int, ForestWorker] = {}
        self._chat_join_tasks: dict[int, asyncio.Task] = {}
        self._forest_join_task: Optional[asyncio.Task] = None

    async def start(self):
        await db.assign_random_secondary_chats()
        accounts = await db.get_accounts()
        await self._ensure_forest_timers(accounts)
        accounts = await db.get_accounts()
        for acc in accounts:
            if acc["enabled"] and self._can_run_account(acc):
                await self.add_account(acc["id"])
            if acc.get("forest_enabled") and (acc.get("forest_chat_status") or "queued") == "joined":
                await self.add_forest_account(acc["id"])
        for chat in await db.get_chats():
            await self.ensure_chat_queue(chat["id"])
        self._forest_join_task = asyncio.create_task(self._forest_join_loop(), name="forest-join")
        log.info(
            "Scheduler started, %d workers and %d forest workers launched",
            len(self._workers),
            len(self._forest_workers),
        )

    async def stop(self):
        if self._forest_join_task and not self._forest_join_task.done():
            self._forest_join_task.cancel()
            await asyncio.gather(self._forest_join_task, return_exceptions=True)
        self._forest_join_task = None
        for task in list(self._chat_join_tasks.values()):
            task.cancel()
        await asyncio.gather(*self._chat_join_tasks.values(), return_exceptions=True)
        self._chat_join_tasks.clear()
        for worker in list(self._forest_workers.values()):
            await worker.stop()
        self._forest_workers.clear()
        for worker in list(self._workers.values()):
            await worker.stop()
        self._workers.clear()

    @staticmethod
    def _can_run_account(acc: dict) -> bool:
        if not acc.get("enabled"):
            return False
        status = acc.get("chat_status") or "joined"
        return status == "joined" and bool(acc.get("chat"))

    async def add_account(self, acc_id: int):
        acc = await db.get_account(acc_id)
        if not acc or not self._can_run_account(acc):
            return
        if acc_id in self._workers:
            if self._workers[acc_id].is_running():
                return
        worker = AccountWorker(acc_id)
        self._workers[acc_id] = worker
        await worker.start()

    async def remove_account(self, acc_id: int):
        if acc_id in self._workers:
            await self._workers[acc_id].stop()
            del self._workers[acc_id]

    async def restart_account(self, acc_id: int):
        await self.remove_account(acc_id)
        acc = await db.get_account(acc_id)
        if acc and self._can_run_account(acc):
            await self.add_account(acc_id)

    async def add_forest_account(self, acc_id: int):
        acc = await db.get_account(acc_id)
        if not acc or not acc.get("forest_enabled"):
            return
        if (acc.get("forest_chat_status") or "queued") != "joined":
            return
        if acc_id in self._forest_workers and self._forest_workers[acc_id].is_running():
            return
        worker = ForestWorker(acc_id)
        self._forest_workers[acc_id] = worker
        await worker.start()

    async def remove_forest_account(self, acc_id: int):
        if acc_id in self._forest_workers:
            await self._forest_workers[acc_id].stop()
            del self._forest_workers[acc_id]

    async def restart_forest_account(self, acc_id: int):
        await self.remove_forest_account(acc_id)
        await self.add_forest_account(acc_id)

    async def _forest_join_loop(self):
        while True:
            acc = await db.get_next_forest_queued_account()
            if not acc:
                await asyncio.sleep(30)
                continue

            await db.update_account(acc["id"], {
                "forest_chat_status": "joining",
                "forest_chat_error": "",
            })
            result = await self._join_account_to_chat(acc, {
                "link": FOREST_CHAT_LINK,
            })
            fresh_acc = await db.get_account(acc["id"])
            if not fresh_acc or not fresh_acc.get("forest_enabled"):
                continue
            if result["ok"]:
                available_at = datetime.now(timezone.utc) + timedelta(seconds=FOREST_WARMUP_SECONDS)
                await db.update_account(acc["id"], {
                    "forest_chat_status": "joined",
                    "forest_chat_error": "",
                    "forest_available_at": available_at.isoformat(),
                    "forest_next_fish_at": available_at.isoformat(),
                })
                await db.add_log(acc["id"], acc["name"], "forest_chat_joined", FOREST_CHAT_LINK)
                await self.add_forest_account(acc["id"])
            elif result.get("banned"):
                await db.update_account(acc["id"], {
                    "forest_enabled": False,
                    "forest_chat_status": "banned",
                    "forest_chat_error": result["error"],
                })
                await db.add_log(acc["id"], acc["name"], "forest_banned", result["error"])
                log.warning("[%s] forest banned — forest disabled automatically", acc["name"])
            else:
                await db.update_account(acc["id"], {
                    "forest_chat_status": "error",
                    "forest_chat_error": result["error"],
                })
                await db.add_log(acc["id"], acc["name"], "forest_chat_join_error", result["error"])

            try:
                await asyncio.sleep(FOREST_JOIN_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                raise

    async def _ensure_forest_timers(self, accounts: list[dict]):
        now = datetime.now(timezone.utc)
        joined = [
            acc for acc in accounts
            if acc.get("forest_enabled") and (acc.get("forest_chat_status") or "queued") == "joined"
        ]
        for idx, acc in enumerate(joined):
            updates = {}
            if not ForestWorker._parse_dt(acc.get("forest_next_fish_at")):
                spread = idx * 90 + random.uniform(0, FOREST_FISH_INTERVAL_SECONDS)
                updates["forest_next_fish_at"] = (now + timedelta(seconds=spread)).isoformat()
            if not ForestWorker._parse_dt(acc.get("forest_next_net_at")):
                last_net = ForestWorker._parse_dt(acc.get("forest_net_last_used"))
                if last_net:
                    next_net = last_net + timedelta(seconds=FOREST_NET_INTERVAL_SECONDS)
                    if next_net <= now:
                        next_net = now + timedelta(seconds=idx * 120 + random.uniform(0, FOREST_NET_JITTER_SECONDS))
                else:
                    next_net = now + timedelta(seconds=idx * 120 + random.uniform(0, FOREST_NET_JITTER_SECONDS))
                updates["forest_next_net_at"] = next_net.isoformat()
            if updates:
                await db.update_account(acc["id"], updates)

    async def leave_account_chat(self, acc: dict) -> dict:
        chat = (acc.get("chat") or "").strip()
        if not chat:
            return {"ok": True}
        client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                if TWO_FA_PASSWORD:
                    await client.sign_in(password=TWO_FA_PASSWORD)
                else:
                    return {"ok": False, "error": "session not authorized"}
            peer = await client.get_entity(AccountWorker._get_peer(chat))
            try:
                await client(functions.channels.LeaveChannelRequest(peer))
            except Exception:
                me = await client.get_input_entity("me")
                await client(functions.messages.DeleteChatUserRequest(
                    chat_id=peer.id,
                    user_id=me,
                ))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
        finally:
            await client.disconnect()

    async def leave_account_secondary_chat(self, acc: dict) -> dict:
        secondary = (acc.get("secondary_chat") or "").strip()
        if not secondary:
            return {"ok": True}
        return await self.leave_account_chat({**acc, "chat": secondary})

    async def enforce_chat_limit(self, chat_id: int):
        chat = await db.get_chat(chat_id)
        if not chat:
            return 0
        limit = max(1, int(chat["account_limit"]))
        assigned = await db.get_accounts_by_chat_id_and_statuses(chat_id, ["queued", "joining", "joined"])
        excess = assigned[limit:]
        moved = 0
        for acc in excess:
            await self.remove_account(acc["id"])
            if acc.get("chat_status") == "joined" and acc.get("chat"):
                leave_result = await self.leave_account_chat(acc)
                if not leave_result["ok"]:
                    await db.add_log(acc["id"], acc["name"], "chat_leave_error", leave_result["error"])
            await db.unassign_account_chat(acc["id"])
            moved += 1
        if moved:
            await db.allocate_waiting_accounts()
            for chat in await db.get_chats():
                await self.ensure_chat_queue(chat["id"])
        return moved

    async def force_chat_join(self, acc_id: int) -> dict:
        acc = await db.get_account(acc_id)
        if not acc:
            return {"ok": False, "error": "not found"}
        if acc.get("chat_status") == "joined":
            await self.add_account(acc_id)
            return {"ok": True, "already_joined": True}
        chat_id = acc.get("chat_id")
        if not chat_id:
            return {"ok": False, "error": "account has no chat"}
        chat = await db.get_chat(chat_id)
        if not chat:
            return {"ok": False, "error": "chat not found"}
        await self.remove_account(acc_id)
        await db.update_account(acc_id, {"chat_status": "joining", "setup_status": "joining_chat", "chat_error": ""})
        result = await self._join_account_to_chat(acc, chat)
        if result["ok"]:
            await db.update_account(acc_id, {"chat_status": "joined", "setup_status": "working", "chat_error": ""})
            await db.add_log(acc_id, acc["name"], "chat_joined", f"forced: {chat['link']}")
            await db.set_next_send(acc_id, datetime.now(pytz.timezone("Europe/Moscow")) + timedelta(seconds=CHAT_JOIN_WARMUP_SECONDS))
            await self.add_account(acc_id)
            return {"ok": True}
        await db.update_account(acc_id, {"chat_status": "waiting", "setup_status": "chat_error", "chat_error": result["error"]})
        await db.add_log(acc_id, acc["name"], "chat_join_error", result["error"])
        return {"ok": False, "error": result["error"]}

    async def find_chat_for_account(self, acc_id: int) -> dict:
        acc = await db.get_account(acc_id)
        if not acc:
            return {"ok": False, "error": "not found"}
        await db.unassign_account_chat(acc_id)
        assigned = await db.allocate_waiting_accounts()
        for chat in await db.get_chats():
            await self.ensure_chat_queue(chat["id"])
        return {"ok": True, "assigned": assigned}

    async def ensure_chat_queue(self, chat_id: int):
        task = self._chat_join_tasks.get(chat_id)
        if task and not task.done():
            return
        self._chat_join_tasks[chat_id] = asyncio.create_task(
            self._chat_join_loop(chat_id), name=f"chat-join-{chat_id}"
        )

    async def restart_chat_queue(self, chat_id: int):
        task = self._chat_join_tasks.get(chat_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._chat_join_tasks.pop(chat_id, None)
        await self.ensure_chat_queue(chat_id)

    async def _chat_join_loop(self, chat_id: int):
        while True:
            chat = await db.get_chat(chat_id)
            if not chat:
                return
            if chat.get("next_join_at"):
                try:
                    next_join = datetime.fromisoformat(chat["next_join_at"])
                    if next_join.tzinfo is None:
                        next_join = next_join.replace(tzinfo=timezone.utc)
                    wait_seconds = (next_join.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds()
                except Exception:
                    wait_seconds = 0
                if wait_seconds > 1:
                    try:
                        await asyncio.sleep(min(wait_seconds, 60))
                    except asyncio.CancelledError:
                        raise
                    continue
            queued = [
                a for a in await db.get_accounts_by_chat_id(chat_id)
                if a.get("chat_status") == "queued"
            ]
            if not queued:
                await asyncio.sleep(5)
                continue

            acc = queued[0]
            await db.update_account(acc["id"], {"chat_status": "joining", "setup_status": "joining_chat", "chat_error": ""})
            result = await self._join_account_to_chat(acc, chat)
            if result["ok"]:
                await db.update_account(acc["id"], {"chat_status": "joined", "setup_status": "working", "chat_error": ""})
                await db.add_log(acc["id"], acc["name"], "chat_joined", chat["link"])
                await db.set_next_send(acc["id"], datetime.now(pytz.timezone("Europe/Moscow")) + timedelta(seconds=CHAT_JOIN_WARMUP_SECONDS))
                await self.add_account(acc["id"])
            elif result.get("banned"):
                await db.update_account(acc["id"], {
                    "enabled": False,
                    "chat_status": "banned",
                    "setup_status": "banned",
                    "chat_error": result["error"],
                })
                await db.add_log(acc["id"], acc["name"], "banned", result["error"])
                log.warning("[%s] banned from chat — account disabled automatically", acc["name"])
                await self.remove_account(acc["id"])
            else:
                await db.update_account(acc["id"], {"chat_status": "waiting", "setup_status": "chat_error", "chat_error": result["error"]})
                await db.add_log(acc["id"], acc["name"], "chat_join_error", result["error"])

            await db.set_chat_next_join(
                chat_id,
                datetime.now(timezone.utc) + timedelta(minutes=max(1, int(chat["join_interval_minutes"]))),
            )

    async def _join_account_to_chat(self, acc: dict, chat: dict) -> dict:
        client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **DIRECT_CLIENT_KWARGS)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                if TWO_FA_PASSWORD:
                    await client.sign_in(password=TWO_FA_PASSWORD)
                else:
                    return {"ok": False, "error": "session not authorized"}
            await self._join_chat_link(client, chat["link"])
            return {"ok": True}
        except (ChannelPrivateError, UserBannedInChannelError, ChatForbiddenError) as e:
            return {"ok": False, "error": str(e), "banned": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
        finally:
            await client.disconnect()

    async def _join_chat_link(self, client: TelegramClient, link: str):
        raw = (link or "").strip()
        if not raw:
            raise RuntimeError("chat link is empty")
        target = raw
        if "t.me/" in raw or "telegram.me/" in raw:
            parsed = urlparse(raw if "://" in raw else "https://" + raw)
            target = parsed.path.strip("/")
        if target.startswith("+"):
            try:
                await client(functions.messages.ImportChatInviteRequest(target[1:]))
            except UserAlreadyParticipantError:
                pass
        elif target.startswith("joinchat/"):
            try:
                await client(functions.messages.ImportChatInviteRequest(target.split("/", 1)[1]))
            except UserAlreadyParticipantError:
                pass
        else:
            if target.startswith("@"):
                target = target[1:]
            try:
                await client(functions.channels.JoinChannelRequest(target))
            except UserAlreadyParticipantError:
                pass

    async def change_location_all(self, target_location: str):
        """Queue a forced location change for every running worker."""
        for acc_id, worker in list(self._workers.items()):
            if worker.is_running():
                asyncio.create_task(worker.change_location_now(target_location))
        log.info("change_location_all queued for %d workers -> %s",
                 len(self._workers), target_location)

    async def send_now(self, acc_id: int) -> dict:
        acc = await db.get_account(acc_id)
        if not acc:
            return {"ok": False, "error": "not found"}
        return await AccountWorker(acc_id).send_once(acc)

    async def send_text_now(self, acc_id: int, text: str, target: str = "primary") -> dict:
        acc = await db.get_account(acc_id)
        if not acc:
            return {"ok": False, "error": "not found"}
        return await AccountWorker(acc_id).send_text_once(acc, text, target)

    async def find_chat_now(self, acc_id: int) -> dict:
        return await self.find_chat_for_account(acc_id)

    async def solve_captcha_now(self, acc_id: int) -> dict:
        acc = await db.get_account(acc_id)
        if not acc:
            return {"ok": False, "error": "not found"}
        return await AccountWorker(acc_id).solve_captcha_once(acc)

    async def send_tour_command(self, acc_id: int) -> dict:
        acc = await db.get_account(acc_id)
        if not acc:
            return {"ok": False, "error": "not found"}
        return await AccountWorker(acc_id).send_tour_once(acc)

    def get_status(self, acc_id: int) -> str:
        w = self._workers.get(acc_id)
        return "running" if w and w.is_running() else "stopped"

    def get_forest_status(self, acc_id: int) -> str:
        w = self._forest_workers.get(acc_id)
        return "running" if w and w.is_running() else "stopped"


scheduler = Scheduler()
