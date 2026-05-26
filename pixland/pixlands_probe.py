import argparse
import asyncio
import json
import os
import re
import sqlite3
import sys
import time
import math
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from telethon import TelegramClient
from telethon.tl.functions.messages import RequestAppWebViewRequest, RequestWebViewRequest
from telethon.tl.types import InputBotAppShortName


API_ID = int(os.getenv("TELEGRAM_API_ID") or os.getenv("PIXLANDS_TELEGRAM_API_ID") or "38148591")
API_HASH = os.getenv("TELEGRAM_API_HASH") or os.getenv("PIXLANDS_TELEGRAM_API_HASH") or ""
DEFAULT_SESSION = str(Path("sessions") / "newLex")
BOT = "pixlandsbot"
WEBAPP_URL = os.getenv("PIXLANDS_WEBAPP_URL") or "https://pixlands.com/?v=20260513G"
UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36"


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def save_json(path: str, value) -> None:
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"saved {path}")


def show(label: str, value, limit: int = 14000) -> None:
    print(f"\n== {label} ==")
    text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    print(text if len(text) <= limit else text[:limit] + "\n...<truncated>")


def extract_init_data(webview_url: str) -> str:
    parsed = urllib.parse.urlparse(webview_url)
    for raw in (parsed.fragment, parsed.query):
        for key in ("tgWebAppData", "tgwebappdata", "initData"):
            prefix = key + "="
            for part in raw.split("&"):
                if part.startswith(prefix):
                    return urllib.parse.unquote(part[len(prefix) :])
    match = re.search(r"(?:tgWebAppData|tgwebappdata|initData)=([^&#]+)", webview_url)
    return urllib.parse.unquote(match.group(1)) if match else ""


def parse_init_user(init_data: str) -> dict:
    data = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True))
    try:
        user = json.loads(data.get("user", "{}"))
    except Exception:
        user = {}
    if "start_param" in data:
        user["start_param"] = data["start_param"]
    return user


def webapp_origin() -> str:
    parsed = urllib.parse.urlparse(WEBAPP_URL)
    return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else "https://pixlands.com"


def session_sqlite_info(session: str) -> dict:
    path = Path(session)
    if not path.exists() and not str(path).endswith(".session"):
        path = Path(str(path) + ".session")
    info = {"path": str(path), "exists": path.exists()}
    if not path.exists():
        return info
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as db:
            cols = db.execute("pragma table_info(sessions)").fetchall()
            info["sessions_columns"] = [c[1] for c in cols]
            row = db.execute("select * from sessions limit 1").fetchone()
            info["sessions_row_len"] = len(row) if row else 0
            version = db.execute("select name from sqlite_master where type='table' and name='version'").fetchone()
            if version:
                vrow = db.execute("select version from version limit 1").fetchone()
                info["version"] = vrow[0] if vrow else None
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


def legacy_telethon_session_copy(session: str) -> str:
    src = Path(session)
    if not src.exists() and not str(src).endswith(".session"):
        src = Path(str(src) + ".session")
    data_dir = Path(os.getenv("PIXLANDS_DATA_DIR") or src.parent).resolve()
    out_dir = data_dir / "telethon_compat_sessions"
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / src.name
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return str(dst)

    with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as source:
        row = source.execute("select * from sessions limit 1").fetchone()
        if not row or len(row) < 5:
            raise RuntimeError(f"cannot build legacy Telethon session copy: sessions row len={len(row) if row else 0}")
        entities = []
        try:
            entities = source.execute("select id, hash, username, phone, name, date from entities").fetchall()
        except Exception:
            entities = []

    if dst.exists():
        dst.unlink()
    with sqlite3.connect(dst) as target:
        target.execute("create table version (version integer primary key)")
        target.execute(
            "create table sessions (dc_id integer primary key, server_address text, port integer, auth_key blob, takeout_id integer)"
        )
        target.execute(
            "create table entities (id integer primary key, hash integer not null, username text, phone integer, name text, date integer)"
        )
        target.execute(
            "create table sent_files (md5_digest blob, file_size integer, type integer, id integer, hash integer, primary key(md5_digest, file_size, type))"
        )
        target.execute("create table update_state (id integer primary key, pts integer, qts integer, date integer, seq integer)")
        target.execute("insert into version values (?)", (7,))
        target.execute("insert into sessions values (?,?,?,?,?)", tuple(row[:5]))
        if entities:
            target.executemany("insert or replace into entities values (?,?,?,?,?,?)", entities)
        target.commit()
    return str(dst)


def compatible_session_path(session: str) -> str:
    from telethon.sessions import SQLiteSession

    try:
        s = SQLiteSession(session)
        s.close()
        return session
    except ValueError as exc:
        message = str(exc)
        if "too many values to unpack" in message and "expected 5" in message:
            return legacy_telethon_session_copy(session)
        raise


async def get_webview_url(session: str, platform: str, mode: str, short_name: str, start_param: str) -> str:
    async with TelegramClient(compatible_session_path(session), API_ID, API_HASH) as client:
        if not await client.is_user_authorized():
            raise RuntimeError("telegram session is not authorized")
        me = await client.get_me()
        if me is None:
            raise RuntimeError("telegram session returned no current user")
        print(f"session: id={me.id} username={me.username or ''} first_name={me.first_name or ''}")
        bot = await client.get_input_entity(BOT)
        if mode == "app":
            result = await client(
                RequestAppWebViewRequest(
                    peer=bot,
                    app=InputBotAppShortName(bot_id=bot, short_name=short_name),
                    platform=platform,
                    write_allowed=True,
                    start_param=start_param or None,
                )
            )
            return result.url
        result = await client(
            RequestWebViewRequest(
                peer=bot,
                bot=bot,
                platform=platform,
                from_bot_menu=False,
                url=WEBAPP_URL,
                start_param=start_param or None,
            )
        )
        return result.url


def request(path: str, method: str = "GET", headers: dict | None = None, body=None):
    url = urllib.parse.urljoin(WEBAPP_URL, path.lstrip("/")) if not re.match(r"^https?://", path, re.I) else path
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req_headers = {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Origin": webapp_origin(),
        "Referer": WEBAPP_URL,
    }
    if body is not None:
        req_headers["Content-Type"] = "application/json"
    if headers:
        req_headers.update({k: str(v) for k, v in headers.items() if v is not None})
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            raw = res.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except Exception:
                payload = raw
            return res.status, dict(res.headers), payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = raw[:4000]
        return exc.code, dict(exc.headers), payload
    except Exception as exc:
        return 0, {}, {"error": type(exc).__name__, "message": str(exc)}


def parse_body(raw: str) -> dict:
    if not raw:
        return {}
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return json.loads(raw.replace('\\"', '"'))
    out = {}
    for part in re.split(r"[;,]", raw):
        if not part.strip():
            continue
        key, _, value = part.partition("=")
        value = value.strip()
        if value.lower() in ("true", "false"):
            out[key.strip()] = value.lower() == "true"
        else:
            try:
                out[key.strip()] = int(value)
            except ValueError:
                try:
                    out[key.strip()] = float(value)
                except ValueError:
                    out[key.strip()] = value
    return out


def stats_view(load_payload) -> dict:
    if not isinstance(load_payload, dict):
        return {}
    stats = load_payload.get("stats") or {}
    keys = [
        "level", "experience", "gold", "farm", "shards", "season_coins",
        "talent_coins", "skill_coins", "usdt_balance", "usdt_escrow",
        "max_wave", "current_wave", "state_version",
    ]
    return {k: stats.get(k) for k in keys if k in stats}


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", default=DEFAULT_SESSION)
    parser.add_argument("--platform", default="android")
    parser.add_argument("--mode", choices=["app", "url"], default="url")
    parser.add_argument("--short-name", default="app")
    parser.add_argument("--start-param", default="")
    parser.add_argument("--save-prefix", default="pixlands")
    parser.add_argument("--get", action="append", default=[])
    parser.add_argument("--post", action="append", default=[], help="path::json or path::a=1;b=true")
    parser.add_argument("--save-set", action="append", default=[], help="Set stats fields through /api/save, e.g. gold=250 or usdt_balance=0.01")
    parser.add_argument("--coin-drop-target", type=int, default=0, help="Replay season coin-drop until season_coins reaches this target.")
    parser.add_argument("--coin-drop-sleep", type=float, default=0.05)
    parser.add_argument("--wave-walk-target", type=int, default=0, help="Advance arena waves in accepted max-gap steps.")
    parser.add_argument("--wave-walk-sleep", type=float, default=2.1)
    parser.add_argument("--kill-batches", type=int, default=0, help="Claim N season coin-drop batches with 100 normal kills each.")
    parser.add_argument("--kill-batch-sleep", type=float, default=0.35)
    parser.add_argument("--boss-win", default="", help="Start and immediately report a boss victory, e.g. indara:1.")
    parser.add_argument("--boss-win-sleep", type=float, default=0.0)
    parser.add_argument("--no-auth", action="store_true")
    args = parser.parse_args()

    webview_url = await get_webview_url(args.session, args.platform, args.mode, args.short_name, args.start_param)
    init_data = extract_init_data(webview_url)
    user = parse_init_user(init_data) if init_data else {}
    launch = {
        "webview_url": webview_url,
        "init_data_length": len(init_data),
        "user": user,
    }
    save_json(f"{args.save_prefix}-launch.json", launch)
    show("launch", launch, 5000)
    if not init_data:
        raise SystemExit("no initData")

    auth_path = "/api/auth/tg?init_data=" + urllib.parse.quote(init_data, safe="")
    st, hdrs, auth = request(auth_path)
    show("auth", {"status": st, "body": auth}, 8000)
    save_json(f"{args.save_prefix}-auth.json", {"status": st, "headers": hdrs, "body": auth})
    if not isinstance(auth, dict) or not auth.get("id"):
        raise SystemExit("auth failed")

    user_id = auth.get("id")
    session_version = auth.get("session_version")
    headers = {
        "X-Telegram-Init-Data": init_data,
        "X-User-Id": user_id,
        "X-Session-Version": session_version,
    }

    st, _, load = request(f"/api/load?cause=probe_{int(time.time())}&user_id={user_id}", headers=headers)
    show("load", {"status": st, "stats": stats_view(load), "raw": load}, 12000)
    save_json(f"{args.save_prefix}-load.json", {"status": st, "body": load})

    if args.save_set:
        if not isinstance(load, dict) or not isinstance(load.get("stats"), dict):
            raise SystemExit("cannot build /api/save payload from load")
        stats = dict(load.get("stats") or {})
        for assignment in args.save_set:
            key, _, value = assignment.partition("=")
            if not key or not _:
                raise SystemExit(f"bad --save-set: {assignment}")
            value = value.strip()
            try:
                stats[key.strip()] = int(value)
            except ValueError:
                try:
                    stats[key.strip()] = float(value)
                except ValueError:
                    stats[key.strip()] = value
        save_payload = {
            "user_id": user_id,
            "stats": stats,
            "equipment": load.get("equipment") or {},
            "enhance": load.get("enhance") or [],
            "growth": load.get("growth") or {},
            "talents": load.get("talents") or {},
            "skills": load.get("skills") or [],
            "quests": load.get("quests") or [],
            "state_version": stats.get("state_version", 0),
        }
        st, _, saved = request("/api/save", method="POST", headers=headers, body=save_payload)
        show("POST /api/save tamper", {"status": st, "set": args.save_set, "body": saved}, 12000)
        st, _, after = request(f"/api/load?cause=probe_after_save_{int(time.time())}&user_id={user_id}", headers=headers)
        show("load after save", {"status": st, "stats": stats_view(after), "raw_stats": (after or {}).get("stats") if isinstance(after, dict) else None}, 12000)
        save_json(f"{args.save_prefix}-after-save.json", {"status": st, "body": after})

    if args.coin_drop_target:
        current = 0
        if isinstance(load, dict) and isinstance(load.get("stats"), dict):
            current = int(load["stats"].get("season_coins") or 0)
        need = max(0, args.coin_drop_target - current)
        calls = int(math.ceil(need / 4.0))
        results = []
        print(f"\n== coin-drop spam ==\ncurrent={current} target={args.coin_drop_target} calls={calls}")
        successes = 0
        attempts = 0
        while successes < calls:
            attempts += 1
            body = {
                "user_id": user_id,
                "kills": 100000,
                "is_boss": True,
                "boost_active": True,
            }
            st, _, payload = request("/api/season/coin-drop", method="POST", headers=headers, body=body)
            results.append({"attempt": attempts, "success": successes + 1, "status": st, "body": payload})
            if st == 429 and isinstance(payload, dict):
                retry_after = float(payload.get("retry_after") or 0.5)
                time.sleep(max(retry_after, args.coin_drop_sleep, 0.25))
                continue
            if isinstance(payload, dict) and payload.get("ok"):
                successes += 1
            if attempts <= 5 or successes == calls:
                show(f"coin-drop {successes}/{calls}", {"status": st, "body": payload}, 3000)
            if args.coin_drop_sleep > 0:
                time.sleep(args.coin_drop_sleep)
        st, _, after = request(f"/api/load?cause=probe_after_coin_drop_{int(time.time())}&user_id={user_id}", headers=headers)
        show("load after coin-drop spam", {"status": st, "stats": stats_view(after)}, 6000)
        save_json(f"{args.save_prefix}-coin-drop-results.json", {"results": results, "after": after})

    if args.wave_walk_target:
        if not isinstance(load, dict) or not isinstance(load.get("stats"), dict):
            raise SystemExit("cannot determine current wave from load")
        current = int(load["stats"].get("max_wave") or load["stats"].get("current_wave") or 1)
        target = int(args.wave_walk_target)
        results = []
        print(f"\n== wave walk ==\ncurrent={current} target={target}")
        while current < target:
            next_wave = min(target, current + 30)
            body = {"user_id": user_id, "wave": next_wave}
            st, _, payload = request("/api/arena/wave-cleared", method="POST", headers=headers, body=body)
            results.append({"wave": next_wave, "status": st, "body": payload})
            show(f"wave {next_wave}", {"status": st, "body": payload}, 3000)
            if isinstance(payload, dict) and payload.get("ok"):
                current = int(payload.get("max_wave") or next_wave)
                if args.wave_walk_sleep > 0:
                    time.sleep(args.wave_walk_sleep)
                continue
            if isinstance(payload, dict) and payload.get("error") == "wave_too_fast":
                time.sleep(float(payload.get("retryAfterSec") or args.wave_walk_sleep or 2.0))
                continue
            if isinstance(payload, dict) and payload.get("error") == "wave_skip" and payload.get("expected"):
                current = max(current, int(payload.get("expected")) - 1)
                continue
            break
        st, _, after = request(f"/api/load?cause=probe_after_wave_walk_{int(time.time())}&user_id={user_id}", headers=headers)
        show("load after wave walk", {"status": st, "stats": stats_view(after)}, 6000)
        save_json(f"{args.save_prefix}-wave-walk-results.json", {"results": results, "after": after})
        load = after

    if args.kill_batches:
        results = []
        print(f"\n== kill batches ==\nbatches={args.kill_batches}")
        for idx in range(1, args.kill_batches + 1):
            body = {
                "user_id": user_id,
                "kills": 100,
                "is_boss": False,
                "boost_active": True,
            }
            st, _, payload = request("/api/season/coin-drop", method="POST", headers=headers, body=body)
            results.append({"batch": idx, "status": st, "body": payload})
            show(f"kill batch {idx}/{args.kill_batches}", {"status": st, "body": payload}, 3000)
            if st == 429 and isinstance(payload, dict):
                time.sleep(float(payload.get("retry_after") or args.kill_batch_sleep or 0.5))
            elif args.kill_batch_sleep > 0:
                time.sleep(args.kill_batch_sleep)
        st, _, after = request(f"/api/load?cause=probe_after_kill_batches_{int(time.time())}&user_id={user_id}", headers=headers)
        show("load after kill batches", {"status": st, "stats": stats_view(after)}, 6000)
        save_json(f"{args.save_prefix}-kill-batch-results.json", {"results": results, "after": after})
        load = after

    if args.boss_win:
        loc, _, diff_raw = args.boss_win.partition(":")
        difficulty = int(diff_raw or "1")
        start_body = {
            "user_id": user_id,
            "location": loc or "indara",
            "difficulty": difficulty,
            "drop_mult": 1,
        }
        st, _, started = request("/api/boss/start", method="POST", headers=headers, body=start_body)
        show("POST /api/boss/start", {"status": st, "sent": start_body, "body": started}, 6000)
        result = None
        if isinstance(started, dict) and started.get("ok") and started.get("token"):
            combat_body = {"user_id": user_id, "token": started.get("token")}
            st_cs, _, combat_started = request("/api/boss/combat-started", method="POST", headers=headers, body=combat_body)
            show("POST /api/boss/combat-started", {"status": st_cs, "sent": combat_body, "body": combat_started}, 4000)
            if args.boss_win_sleep > 0:
                time.sleep(args.boss_win_sleep)
            result_body = {"user_id": user_id, "token": started.get("token"), "victory": True}
            st2, _, result = request("/api/boss/result", method="POST", headers=headers, body=result_body)
            show("POST /api/boss/result", {"status": st2, "sent": result_body, "body": result}, 8000)
        st3, _, after = request(f"/api/load?cause=probe_after_boss_{int(time.time())}&user_id={user_id}", headers=headers)
        show("load after boss", {"status": st3, "stats": stats_view(after)}, 6000)
        save_json(f"{args.save_prefix}-boss-win-results.json", {"start": started, "result": result, "after": after})
        load = after

    for path in args.get:
        sep = "&" if "?" in path else "?"
        full_path = path if "user_id=" in path else f"{path}{sep}user_id={user_id}"
        st, _, payload = request(full_path, headers=headers)
        show(f"GET {path}", {"status": st, "body": payload}, 12000)

    for raw in args.post:
        path, _, body_raw = raw.partition("::")
        body = parse_body(body_raw)
        body.setdefault("user_id", user_id)
        st, _, payload = request(path, method="POST", headers=headers, body=body)
        show(f"POST {path}", {"status": st, "sent": body, "body": payload}, 12000)


if __name__ == "__main__":
    asyncio.run(main())
