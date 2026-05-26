import asyncio
import base64
import logging
import os
import re
import random
import json
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, time as dtime, timedelta
from typing import Optional, List

import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from telethon import TelegramClient, functions, types
from telethon.sessions import StringSession
from telethon.errors import FloodWaitError, SlowModeWaitError, SessionPasswordNeededError, UserAlreadyParticipantError

from database import db
from scheduler import scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("fishbot")
logging.getLogger("telethon").setLevel(os.environ.get("TELETHON_LOG_LEVEL", "ERROR").upper())


class _TelethonReconnectNoiseFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not record.exc_info:
            return True
        exc = record.exc_info[1]
        return not (
            isinstance(exc, ValueError)
            and "readexactly size can not be less than zero" in str(exc)
        )


for _logger_name in ("telethon.network.mtprotosender", "telethon.network.connection.connection"):
    logging.getLogger(_logger_name).addFilter(_TelethonReconnectNoiseFilter())


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    await scheduler.start()
    log.info("FishBot started")
    yield
    await scheduler.stop()
    log.info("FishBot stopped")


os.makedirs("photos", exist_ok=True)
app = FastAPI(title="FishBot", lifespan=lifespan)
app.mount("/photos", StaticFiles(directory="photos"), name="photos")

API_ID = int(os.environ.get("TG_API_ID", 0))
API_HASH = os.environ.get("TG_API_HASH", "")
TWO_FA_PASSWORD = os.environ.get("TG_2FA_PASSWORD", "")
FIXED_BOT = "@MDfish_bot"
FIXED_BOT_ID = 7371447792
CLOUD_PASSWORD = os.getenv("TELEGRAM_CLOUD_PASSWORD", "")
AUTH_USER = os.environ.get("FISHBOT_AUTH_USER", "admin")
AUTH_PASSWORD = os.environ.get("FISHBOT_AUTH_PASSWORD") or os.environ.get("APP_PASSWORD") or CLOUD_PASSWORD
TELETHON_CLIENT_KWARGS = {
    "connection_retries": int(os.environ.get("TELETHON_CONNECTION_RETRIES", "2")),
    "request_retries": int(os.environ.get("TELETHON_REQUEST_RETRIES", "1")),
    "retry_delay": int(os.environ.get("TELETHON_RETRY_DELAY", "15")),
    "sequential_updates": True,
}
PENDING_BATCHES: dict[str, dict] = {}
NEW_ACCOUNT_WARMUP_CHAT = "https://t.me/+G-rG7Ey1UcY4MmRh"
PROFILE_MUSIC_CHAT = "minimal_techno_deep"
PROFILE_MUSIC_CHAT_ID = -1001112929726
PROFILE_MUSIC_CACHE_PATH = os.environ.get("PROFILE_MUSIC_CACHE_PATH", "data/profile_music_posts.json")
PROFILE_MUSIC_SCAN_LIMIT = 200
PROFILE_MUSIC_PICK_ATTEMPTS = 30
PROFILE_MUSIC_CACHE_TTL_SECONDS = int(os.environ.get("PROFILE_MUSIC_CACHE_TTL_SECONDS", 24 * 60 * 60))
PROFILE_MUSIC_CACHE_LOCK = asyncio.Lock()
PROFILE_MEDIA_CLEANUP_LOCK = asyncio.Lock()
PROFILE_MEDIA_CLEANUP_DELAY_SECONDS = float(os.environ.get("PROFILE_MEDIA_CLEANUP_DELAY_SECONDS", "1.5"))


def _unauthorized_response() -> HTMLResponse:
    return HTMLResponse(
        "Не авторизован",
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="FishBot", charset="UTF-8"'},
    )


def _basic_auth_ok(header: str) -> bool:
    if not header.startswith("Basic "):
        return False
    try:
        raw = base64.b64decode(header.removeprefix("Basic ").strip()).decode("utf-8")
        username, password = raw.split(":", 1)
    except Exception:
        return False
    return (
        secrets.compare_digest(username.encode("utf-8"), AUTH_USER.encode("utf-8"))
        and secrets.compare_digest(password.encode("utf-8"), AUTH_PASSWORD.encode("utf-8"))
    )


@app.middleware("http")
async def require_basic_auth(request: Request, call_next):
    if not _basic_auth_ok(request.headers.get("Authorization", "")):
        return _unauthorized_response()
    return await call_next(request)


def _sqlite_to_string_session(path: str) -> str:
    """Read a Telethon .session SQLite file and return a StringSession string.
    Works regardless of Telethon version by querying SQLite directly."""
    import sqlite3
    from telethon.crypto import AuthKey

    conn = sqlite3.connect(path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT dc_id, server_address, port, auth_key FROM sessions LIMIT 1")
        row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise ValueError("sessions table is empty — session file invalid")

    dc_id, server_address, port, auth_key_bytes = row
    ss = StringSession()
    ss.set_dc(dc_id, server_address, port)
    ss.auth_key = AuthKey(data=auth_key_bytes)
    return ss.save()

# --- Pydantic models ---

class AccountCreate(BaseModel):
    name: str
    session_string: str
    chat: str
    message: str = "фиш"
    interval_minutes: int = 10
    jitter_minutes: int = 2
    sleep_start: str = "00:00"
    sleep_end: str = "00:00"
    timezone: str = "Europe/Moscow"
    enabled: bool = True
    captcha_bot: str = "@MDfish_bot"
    init_data: str = ""
    suppress_problem_notifications: bool = False

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    chat: Optional[str] = None
    chat_id: Optional[int] = None
    secondary_chat_id: Optional[int] = None
    tg_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    message: Optional[str] = None
    interval_minutes: Optional[int] = None
    jitter_minutes: Optional[int] = None
    sleep_start: Optional[str] = None
    sleep_end: Optional[str] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None
    captcha_bot: Optional[str] = None
    init_data: Optional[str] = None
    suppress_problem_notifications: Optional[bool] = None

class ChatCreate(BaseModel):
    title: str
    link: str
    account_limit: int = 1
    join_interval_minutes: int = 10
    avoid_as_secondary: bool = False

class ChatUpdate(BaseModel):
    title: Optional[str] = None
    link: Optional[str] = None
    account_limit: Optional[int] = None
    join_interval_minutes: Optional[int] = None
    avoid_as_secondary: Optional[bool] = None

class BatchFinalize(BaseModel):
    index: int
    userid: str = ""
    first_name: str = ""
    last_name: str = ""
    bio: str = ""

class SettingsUpdate(BaseModel):
    fishing_location_mode: Optional[str] = None
    skip_sell_fish: Optional[bool] = None

class MassToggleUpdate(BaseModel):
    enabled: bool

class ForestToggleUpdate(BaseModel):
    enabled: bool

class LogsResponse(BaseModel):
    logs: list[dict]

class AccountMessageSend(BaseModel):
    text: str
    target: str = "primary"


# --- HTML ---

@app.get("/", response_class=HTMLResponse)
async def index():
    with open("templates/index.html", encoding="utf-8") as f:
        return f.read()


def _load_bios() -> list[str]:
    if not os.path.exists("aboutme.txt"):
        return []
    with open("aboutme.txt", "r", encoding="utf-8", errors="ignore") as f:
        return [line.strip() for line in f if line.strip()]


def _load_photos() -> list[str]:
    if not os.path.isdir("photos"):
        return []
    allowed = (".jpg", ".jpeg", ".png", ".webp")
    return sorted(
        f"photos/{name}" for name in os.listdir("photos")
        if name.lower().endswith(allowed)
    )


async def _pick_asset(asset_type: str, values: list[str]) -> tuple[str, bool]:
    if not values:
        return "", True
    used = set(await db.get_asset_usage(asset_type))
    unused = [v for v in values if v not in used]
    if unused:
        return random.choice(unused), False
    return random.choice(values), True


def _random_birthday() -> str:
    month = random.randint(1, 12)
    days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return f"{random.randint(1, days):02d}.{month:02d}"


async def _asset_stats() -> dict:
    photos = _load_photos()
    bios = _load_bios()
    used_photos = set(await db.get_asset_usage("photo"))
    used_bios = set(await db.get_asset_usage("bio"))
    return {
        "photos": {"total": len(photos), "used": len(used_photos), "reusing": len(used_photos) >= len(photos) if photos else True},
        "bios": {"total": len(bios), "used": len(used_bios), "reusing": len(used_bios) >= len(bios) if bios else True},
    }


async def _send_bot_start(client: TelegramClient):
    try:
        entity = await client.get_entity(FIXED_BOT)
    except Exception:
        entity = FIXED_BOT_ID
    await client.send_message(entity, "/start")


def _chat_link_target(link: str) -> str:
    raw = (link or "").strip()
    if "t.me/" in raw or "telegram.me/" in raw:
        target = raw.split("t.me/", 1)[-1] if "t.me/" in raw else raw.split("telegram.me/", 1)[-1]
        return target.strip("/")
    return raw.strip("/")


async def _join_link_and_return_entity(client: TelegramClient, link: str) -> tuple[object, bool]:
    target = _chat_link_target(link)
    if target.startswith("+"):
        invite_hash = target[1:]
        try:
            result = await client(functions.messages.ImportChatInviteRequest(invite_hash))
            if getattr(result, "chats", None):
                return result.chats[0], True
            return None, True
        except UserAlreadyParticipantError:
            checked = await client(functions.messages.CheckChatInviteRequest(invite_hash))
            entity = getattr(checked, "chat", None) or await client.get_entity(link)
            return entity, False
    if target.startswith("joinchat/"):
        invite_hash = target.split("/", 1)[1]
        try:
            result = await client(functions.messages.ImportChatInviteRequest(invite_hash))
            if getattr(result, "chats", None):
                return result.chats[0], True
            return None, True
        except UserAlreadyParticipantError:
            checked = await client(functions.messages.CheckChatInviteRequest(invite_hash))
            entity = getattr(checked, "chat", None) or await client.get_entity(link)
            return entity, False
    if target.startswith("@"):
        target = target[1:]
    try:
        await client(functions.channels.JoinChannelRequest(target))
        return await client.get_entity(target), True
    except UserAlreadyParticipantError:
        return await client.get_entity(target), False


async def _leave_entity(client: TelegramClient, entity):
    if entity is None:
        return
    try:
        await client(functions.channels.LeaveChannelRequest(entity))
    except Exception:
        me = await client.get_input_entity("me")
        await client(functions.messages.DeleteChatUserRequest(
            chat_id=entity.id,
            user_id=me,
        ))


async def _warmup_new_account(client: TelegramClient):
    entity, joined_now = await _join_link_and_return_entity(client, NEW_ACCOUNT_WARMUP_CHAT)
    await client.send_message(entity, "моя анкета")
    await asyncio.sleep(60)
    if joined_now:
        await _leave_entity(client, entity)


async def _background_warmup(session_string: str, acc_id: int, acc_name: str):
    client = TelegramClient(StringSession(session_string), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    try:
        await client.connect()
        await _warmup_new_account(client)
        await _send_bot_start(client)
        await db.add_log(acc_id, acc_name, "warmup_done", NEW_ACCOUNT_WARMUP_CHAT)
    except Exception as e:
        log.warning("background warmup failed for acc %d: %s", acc_id, e)
        await db.add_log(acc_id, acc_name, "warmup_error", str(e))
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


def _message_music_document(msg):
    document = getattr(getattr(msg, "media", None), "document", None) or getattr(msg, "document", None)
    if not document:
        return None
    for attr in getattr(document, "attributes", []) or []:
        if isinstance(attr, types.DocumentAttributeAudio) and not getattr(attr, "voice", False):
            return document
    return None


def _input_document_from_message(msg):
    document = _message_music_document(msg)
    if not document:
        return None
    return types.InputDocument(
        id=document.id,
        access_hash=document.access_hash,
        file_reference=document.file_reference,
    )


def _load_profile_music_cache() -> list[int]:
    try:
        with open(PROFILE_MUSIC_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        updated_at = data.get("updated_at")
        if updated_at:
            cache_dt = datetime.fromisoformat(updated_at)
            if (datetime.utcnow() - cache_dt).total_seconds() > PROFILE_MUSIC_CACHE_TTL_SECONDS:
                return []
        ids = data.get("message_ids", [])
        return [int(x) for x in ids if str(x).lstrip("-").isdigit()]
    except Exception:
        return []


def _save_profile_music_cache(message_ids: list[int]):
    os.makedirs(os.path.dirname(PROFILE_MUSIC_CACHE_PATH) or ".", exist_ok=True)
    payload = {
        "chat": PROFILE_MUSIC_CHAT,
        "chat_id": PROFILE_MUSIC_CHAT_ID,
        "message_ids": message_ids,
        "updated_at": datetime.utcnow().isoformat(),
    }
    with open(PROFILE_MUSIC_CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


async def _profile_music_entity(client: TelegramClient) -> tuple[object, bool]:
    try:
        return await client.get_entity(PROFILE_MUSIC_CHAT), False
    except Exception:
        pass
    try:
        await client(functions.channels.JoinChannelRequest(PROFILE_MUSIC_CHAT))
        return await client.get_entity(PROFILE_MUSIC_CHAT), True
    except UserAlreadyParticipantError:
        return await client.get_entity(PROFILE_MUSIC_CHAT), False
    except Exception:
        return await client.get_entity(PROFILE_MUSIC_CHAT_ID), False


async def _refresh_profile_music_cache(client: TelegramClient, entity) -> list[int]:
    message_ids: list[int] = []
    messages = await client.get_messages(entity, limit=PROFILE_MUSIC_SCAN_LIMIT)
    for msg in messages:
        if _message_music_document(msg):
            message_ids.append(msg.id)
    random.shuffle(message_ids)
    _save_profile_music_cache(message_ids)
    return message_ids


async def _profile_has_music(client: TelegramClient) -> bool:
    if not hasattr(functions.account, "GetSavedMusicIdsRequest"):
        return False
    result = await client(functions.account.GetSavedMusicIdsRequest(hash=0))
    return bool(getattr(result, "ids", []) or [])


async def _pick_profile_music_document(client: TelegramClient) -> tuple[object, object, bool]:
    entity, joined_now = await _profile_music_entity(client)
    async with PROFILE_MUSIC_CACHE_LOCK:
        message_ids = _load_profile_music_cache()
        if not message_ids:
            message_ids = await _refresh_profile_music_cache(client, entity)

    tried_refresh = False
    for _ in range(PROFILE_MUSIC_PICK_ATTEMPTS):
        if not message_ids:
            break
        msg_id = random.choice(message_ids)
        msg = await client.get_messages(entity, ids=msg_id)
        input_doc = _input_document_from_message(msg)
        if input_doc:
            return input_doc, entity, joined_now
        message_ids = [x for x in message_ids if x != msg_id]
        if not tried_refresh:
            async with PROFILE_MUSIC_CACHE_LOCK:
                message_ids = await _refresh_profile_music_cache(client, entity)
            tried_refresh = True
    raise RuntimeError("no music posts found in source channel")


async def _ensure_profile_music(client: TelegramClient) -> str:
    if not hasattr(functions.account, "SaveMusicRequest"):
        return "unsupported_telethon"
    try:
        if await _profile_has_music(client):
            return "already_exists"
    except Exception as e:
        log.warning("profile music check skipped: %s", e)
        return "check_failed"

    entity = None
    joined_now = False
    try:
        input_doc, entity, joined_now = await _pick_profile_music_document(client)
        await client(functions.account.SaveMusicRequest(id=input_doc))
        return "saved"
    finally:
        if joined_now and entity is not None:
            try:
                await _leave_entity(client, entity)
            except Exception as e:
                log.warning("profile music source leave skipped: %s", e)


async def _ensure_profile_music_safe(client: TelegramClient) -> str:
    try:
        return await _ensure_profile_music(client)
    except Exception as e:
        log.warning("profile music skipped: %s", e)
        return f"error: {e}"


async def _delete_previous_profile_photos(client: TelegramClient) -> dict:
    photos = await client.get_profile_photos("me")
    total_before = len(photos)
    if total_before == 0:
        return {"total_before": 0, "deleted": 0, "remaining": 0, "kept_current": False}

    previous_photos = []
    for photo in photos[1:]:
        photo_id = getattr(photo, "id", None)
        access_hash = getattr(photo, "access_hash", None)
        if photo_id is None or access_hash is None:
            continue
        previous_photos.append(types.InputPhoto(
            id=photo_id,
            access_hash=access_hash,
            file_reference=getattr(photo, "file_reference", b"") or b"",
        ))

    deleted = 0
    for offset in range(0, len(previous_photos), 100):
        chunk = previous_photos[offset:offset + 100]
        result = await client(functions.photos.DeletePhotosRequest(id=chunk))
        try:
            deleted += len(result)
        except Exception:
            deleted += len(chunk)

    remaining = len(await client.get_profile_photos("me"))
    return {
        "total_before": total_before,
        "deleted": deleted,
        "remaining": remaining,
        "kept_current": remaining >= 1,
    }


def _story_id(item) -> Optional[int]:
    story = getattr(item, "story", item)
    story_id = getattr(story, "id", None)
    return int(story_id) if story_id is not None else None


async def _collect_story_ids(client: TelegramClient) -> tuple[list[int], list[str]]:
    story_ids: list[int] = []
    seen: set[int] = set()
    errors: list[str] = []

    def add_story_items(items) -> int:
        added = 0
        for item in items or []:
            story_id = _story_id(item)
            if story_id is None or story_id in seen:
                continue
            seen.add(story_id)
            story_ids.append(story_id)
            added += 1
        return added

    try:
        result = await client(functions.stories.GetPeerStoriesRequest("me"))
        add_story_items(getattr(getattr(result, "stories", None), "stories", []))
    except Exception as e:
        errors.append(f"active: {e}")

    for source_name, request_cls in (
        ("pinned", functions.stories.GetPinnedStoriesRequest),
        ("archive", functions.stories.GetStoriesArchiveRequest),
    ):
        offset_id = 0
        source_seen: set[int] = set()
        while True:
            try:
                result = await client(request_cls("me", offset_id=offset_id, limit=100))
            except Exception as e:
                errors.append(f"{source_name}: {e}")
                break

            items = getattr(result, "stories", []) or []
            before = len(seen)
            add_story_items(items)
            page_ids = [_story_id(item) for item in items]
            page_ids = [sid for sid in page_ids if sid is not None]
            if not page_ids or len(seen) == before:
                break
            last_id = page_ids[-1]
            if last_id in source_seen:
                break
            source_seen.add(last_id)
            offset_id = last_id
            if len(items) < 100:
                break

    offset = ""
    while True:
        try:
            result = await client(functions.stories.SearchPostsRequest(peer="me", offset=offset, limit=100))
        except Exception as e:
            errors.append(f"posts: {e}")
            break

        items = getattr(result, "stories", []) or []
        add_story_items(items)
        next_offset = getattr(result, "next_offset", None) or ""
        if not next_offset or next_offset == offset:
            break
        offset = next_offset

    return story_ids, errors


async def _delete_all_profile_stories(client: TelegramClient) -> dict:
    story_ids, errors = await _collect_story_ids(client)
    deleted = 0
    for offset in range(0, len(story_ids), 100):
        chunk = story_ids[offset:offset + 100]
        try:
            result = await client(functions.stories.DeleteStoriesRequest(peer="me", id=chunk))
            deleted += len(result)
        except Exception as e:
            errors.append(f"delete {chunk[0]}-{chunk[-1]}: {e}")
    return {"found": len(story_ids), "deleted": deleted, "errors": errors}


async def _cleanup_account_profile_media(acc: dict) -> dict:
    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise HTTPException(400, "session not authorized")
        photos = await _delete_previous_profile_photos(client)
        stories = await _delete_all_profile_stories(client)
        return {"ok": True, "photos": photos, "stories": stories}
    finally:
        await client.disconnect()


async def _apply_profile(client: TelegramClient, item: dict, userid: str, first_name: str, last_name: str, bio: str = ""):
    current_me = await client.get_me()
    current_username = (item.get("current_username") or current_me.username or "").strip().lstrip("@")
    current_first_name = (item.get("current_first_name") or current_me.first_name or "").strip()
    current_last_name = (item.get("current_last_name") or current_me.last_name or "").strip()
    username = userid.strip().lstrip("@") or current_username
    first_name = first_name.strip() or current_first_name or str(current_me.id)
    last_name = last_name.strip() or current_last_name

    await client(functions.account.UpdateProfileRequest(
        first_name=first_name,
        last_name=last_name,
        about=bio.strip() if bio.strip() else item.get("bio") or "",
    ))
    if username and username.lower() != current_username.lower():
        await client(functions.account.UpdateUsernameRequest(username))

    photo = item.get("photo") or ""
    if photo and os.path.exists(photo):
        uploaded = await client.upload_file(photo)
        await client(functions.photos.UploadProfilePhotoRequest(file=uploaded))

    birthday = item.get("birthday") or ""
    if birthday and hasattr(functions.account, "UpdateBirthdayRequest"):
        try:
            from telethon import types
            day, month = [int(x) for x in birthday.split(".")]
            await client(functions.account.UpdateBirthdayRequest(
                birthday=types.Birthday(day=day, month=month)
            ))
        except Exception as e:
            log.warning("birthday update skipped: %s", e)
        # Set birthday visibility to public using account.setPrivacy
        try:
            await client(functions.account.SetPrivacyRequest(
                key=types.InputPrivacyKeyBirthday(),
                rules=[types.InputPrivacyValueAllowAll()]
            ))
            log.info("birthday set to public visibility")
        except Exception as e:
            log.warning("birthday privacy set skipped: %s", e)

    try:
        await client.edit_2fa(new_password=CLOUD_PASSWORD, hint="", email=None)
    except Exception as e:
        log.warning("2FA password update skipped: %s", e)

    me = await client.get_me()
    if username and (me.username or "").lower() != username.lower():
        raise HTTPException(400, "userid was not applied")
    return me


# --- API: accounts ---

@app.get("/api/accounts")
async def get_accounts():
    accounts = await db.get_accounts()
    result = []
    for acc in accounts:
        status = scheduler.get_status(acc["id"])
        forest_status = scheduler.get_forest_status(acc["id"])
        result.append({**acc, "status": status, "forest_status": forest_status})
    return result


@app.get("/api/assets/stats")
async def get_assets_stats():
    return await _asset_stats()


@app.post("/api/assets/reset-profile-usage")
async def reset_profile_asset_usage():
    await db.reset_profile_asset_usage()
    return {"ok": True, "asset_stats": await _asset_stats()}


@app.post("/api/accounts/batch/prepare")
async def prepare_account_batch(
    session_files: List[UploadFile] = File(...),
    message: str = Form("С„РёС€"),
    interval_minutes: int = Form(10),
    jitter_minutes: int = Form(2),
    sleep_start: str = Form("00:00"),
    sleep_end: str = Form("00:00"),
    timezone: str = Form("Europe/Moscow"),
    enabled: str = Form("true"),
    auto_queue_chat: str = Form("true"),
):
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH not set in env")

    import tempfile, uuid
    items = []
    photos = _load_photos()
    bios = _load_bios()
    picked_photos = set()
    picked_bios = set()

    for sf in session_files:
        filename = sf.filename or "unknown.session"
        content = await sf.read()
        with tempfile.NamedTemporaryFile(suffix=".session", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            session_string = _sqlite_to_string_session(tmp_path)
            client = TelegramClient(StringSession(session_string), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                items.append({"file": filename, "ok": False, "error": "session is not authorized"})
                continue
            me = await client.get_me()
            await client.disconnect()

            photo_pool = [p for p in photos if p not in picked_photos]
            bio_pool = [b for b in bios if b not in picked_bios]
            photo, photo_reused = await _pick_asset("photo", photo_pool or photos)
            bio, bio_reused = await _pick_asset("bio", bio_pool or bios)
            photo_reused = photo_reused or (bool(photos) and not photo_pool)
            bio_reused = bio_reused or (bool(bios) and not bio_pool)
            if photo:
                picked_photos.add(photo)
            if bio:
                picked_bios.add(bio)

            items.append({
                "file": filename,
                "ok": True,
                "session_string": session_string,
                "tg_id": me.id,
                "tg_name": me.username or me.first_name or str(me.id),
                "current_username": me.username or "",
                "current_first_name": me.first_name or "",
                "current_last_name": me.last_name or "",
                "photo": photo,
                "photo_url": "/" + photo.replace("\\", "/") if photo else "",
                "photo_reused": photo_reused,
                "bio": bio,
                "bio_reused": bio_reused,
                "birthday": _random_birthday(),
            })
        except Exception as e:
            items.append({"file": filename, "ok": False, "error": str(e)})
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    batch_id = uuid.uuid4().hex
    PENDING_BATCHES[batch_id] = {
        "config": {
            "message": message,
            "interval_minutes": max(10, interval_minutes),
            "jitter_minutes": jitter_minutes,
            "sleep_start": sleep_start,
            "sleep_end": sleep_end,
            "timezone": "Europe/Moscow",
            "enabled": enabled.lower() in ("true", "1", "yes"),
            "auto_queue_chat": auto_queue_chat.lower() in ("true", "1", "yes"),
        },
        "items": items,
    }
    public_items = [{k: v for k, v in item.items() if k != "session_string"} for item in items]
    return {"batch_id": batch_id, "items": public_items, "asset_stats": await _asset_stats()}


@app.post("/api/accounts/batch/{batch_id}/finalize")
async def finalize_batch_account(batch_id: str, data: BatchFinalize):
    batch = PENDING_BATCHES.get(batch_id)
    if not batch:
        raise HTTPException(404, "batch expired")
    if data.index < 0 or data.index >= len(batch["items"]):
        raise HTTPException(400, "bad account index")
    item = batch["items"][data.index]
    if not item.get("ok"):
        raise HTTPException(400, item.get("error") or "account is not prepared")
    if item.get("created_id"):
        return {"ok": True, "id": item["created_id"], "already_created": True}

    client = TelegramClient(StringSession(item["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise HTTPException(400, "session is not authorized")
        me = await _apply_profile(client, item, data.userid, data.first_name, data.last_name, data.bio)
        music_status = await _ensure_profile_music_safe(client)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        await client.disconnect()

    config = batch["config"]
    display_name = (data.first_name.strip() or item.get("current_first_name") or me.first_name or me.username or str(me.id)).strip()
    acc_id = await db.create_account(
        name=display_name,
        session_string=item["session_string"],
        chat="",
        message=config["message"],
        interval_minutes=config["interval_minutes"],
        jitter_minutes=config["jitter_minutes"],
        sleep_start=config["sleep_start"],
        sleep_end=config["sleep_end"],
        timezone="Europe/Moscow",
        enabled=config["enabled"],
        tg_name=me.username or data.userid.strip().lstrip("@") or item.get("current_username") or display_name,
        tg_id=me.id,
        captcha_bot=FIXED_BOT,
        setup_status="waiting_chat" if config["auto_queue_chat"] else "manual_waiting_chat",
        chat_status="waiting" if config["auto_queue_chat"] else "manual_waiting",
        assigned_photo=item.get("photo") or "",
        assigned_bio=item.get("bio") or "",
        assigned_birthday=item.get("birthday") or "",
        init_data="",
    )
    if item.get("photo"):
        await db.mark_asset_used("photo", item["photo"], acc_id)
    if item.get("bio"):
        await db.mark_asset_used("bio", item["bio"], acc_id)
    await db.add_log(acc_id, display_name, "profile_music", music_status)
    item["created_id"] = acc_id

    asyncio.create_task(_background_warmup(item["session_string"], acc_id, display_name))

    assigned = 0
    if config["auto_queue_chat"]:
        assigned = await db.allocate_waiting_accounts()
        await db.assign_random_secondary_chats()
        for chat in await db.get_chats():
            await scheduler.ensure_chat_queue(chat["id"])
    return {"ok": True, "id": acc_id, "tg_name": me.username, "assigned": assigned}

@app.post("/api/accounts")
async def create_account(data: AccountCreate):
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH не заданы в env")

    # Validate session
    try:
        client = TelegramClient(StringSession(data.session_string), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
        await client.connect()
        if not await client.is_user_authorized():
            if TWO_FA_PASSWORD:
                await client.sign_in(password=TWO_FA_PASSWORD)
            else:
                await client.disconnect()
                raise HTTPException(400, "Сессия невалидна или истекла")
        me = await client.get_me()
        tg_name = me.username or me.first_name or str(me.id)
        tg_id = me.id
        music_status = await _ensure_profile_music_safe(client)
        await client.disconnect()
    except SessionPasswordNeededError:
        if TWO_FA_PASSWORD:
            try:
                await client.sign_in(password=TWO_FA_PASSWORD)
                me = await client.get_me()
                tg_name = me.username or me.first_name or str(me.id)
                tg_id = me.id
                music_status = await _ensure_profile_music_safe(client)
                await client.disconnect()
            except Exception as e2:
                await client.disconnect()
                raise HTTPException(400, f"Ошибка 2FA: {e2}")
        else:
            await client.disconnect()
            raise HTTPException(400, "Аккаунт требует 2FA пароль. Задай TG_2FA_PASSWORD в env.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Ошибка подключения к Telegram: {e}")

    acc_id = await db.create_account(
        name=data.name,
        session_string=data.session_string,
        chat=data.chat,
        message=data.message,
        interval_minutes=max(10, data.interval_minutes),
        jitter_minutes=data.jitter_minutes,
        sleep_start=data.sleep_start,
        sleep_end=data.sleep_end,
        timezone="Europe/Moscow",
        enabled=data.enabled,
        tg_name=tg_name,
        tg_id=tg_id,
        captcha_bot=FIXED_BOT,
        init_data="",
        suppress_problem_notifications=data.suppress_problem_notifications,
    )
    if data.enabled:
        await scheduler.add_account(acc_id)
    await db.add_log(acc_id, data.name, "profile_music", music_status)
    asyncio.create_task(_background_warmup(data.session_string, acc_id, data.name))
    return {"id": acc_id, "tg_name": tg_name}

@app.post("/api/accounts/upload")
async def upload_account(
    session_file: UploadFile = File(...),
    name: str = Form(...),
    chat: str = Form(...),
    message: str = Form("фиш"),
    interval_minutes: int = Form(10),
    jitter_minutes: int = Form(2),
    sleep_start: str = Form("00:00"),
    sleep_end: str = Form("00:00"),
    timezone: str = Form("Europe/Moscow"),
    enabled: str = Form("true"),
):
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH не заданы в env")

    # Save .session file to a temp location
    import tempfile, os
    content = await session_file.read()
    with tempfile.NamedTemporaryFile(suffix=".session", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        session_string = _sqlite_to_string_session(tmp_path)
        client = TelegramClient(StringSession(session_string), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            raise HTTPException(400, "Сессия невалидна или истекла")
        me = await client.get_me()
        tg_name = me.username or me.first_name or str(me.id)
        tg_id = me.id
        music_status = await _ensure_profile_music_safe(client)
        await client.disconnect()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Ошибка подключения: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    enabled_bool = enabled.lower() in ("true", "1", "yes")
    acc_id = await db.create_account(
        name=name,
        session_string=session_string,
        chat=chat,
        message=message,
        interval_minutes=max(10, interval_minutes),
        jitter_minutes=jitter_minutes,
        sleep_start=sleep_start,
        sleep_end=sleep_end,
        timezone="Europe/Moscow",
        enabled=enabled_bool,
        tg_name=tg_name,
        tg_id=tg_id,
        captcha_bot=FIXED_BOT,
        init_data="",
    )
    if enabled_bool:
        await scheduler.add_account(acc_id)
    await db.add_log(acc_id, name, "profile_music", music_status)
    asyncio.create_task(_background_warmup(session_string, acc_id, name))
    return {"id": acc_id, "tg_name": tg_name}


@app.post("/api/accounts/bulk-upload")
async def bulk_upload_accounts(
    session_files: List[UploadFile] = File(...),
    chat: str = Form(...),
    message: str = Form("фиш"),
    interval_minutes: int = Form(10),
    jitter_minutes: int = Form(2),
    sleep_start: str = Form("00:00"),
    sleep_end: str = Form("00:00"),
    timezone: str = Form("Europe/Moscow"),
    enabled: str = Form("true"),
):
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH не заданы в env")

    import tempfile, os
    enabled_bool = enabled.lower() in ("true", "1", "yes")
    results = []

    for sf in session_files:
        filename = sf.filename or "unknown.session"
        content = await sf.read()
        with tempfile.NamedTemporaryFile(suffix=".session", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            session_string = _sqlite_to_string_session(tmp_path)
            client = TelegramClient(StringSession(session_string), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                results.append({"file": filename, "ok": False, "error": "Сессия невалидна или истекла"})
                continue

            me = await client.get_me()
            tg_name = me.username or me.first_name or str(me.id)
            tg_id = me.id
            music_status = await _ensure_profile_music_safe(client)
            await client.disconnect()

            acc_id_new = await db.create_account(
                name=tg_name,
                session_string=session_string,
                chat=chat,
                message=message,
                interval_minutes=max(10, interval_minutes),
                jitter_minutes=jitter_minutes,
                sleep_start=sleep_start,
                sleep_end=sleep_end,
                timezone="Europe/Moscow",
                enabled=enabled_bool,
                tg_name=tg_name,
                tg_id=tg_id,
                captcha_bot="@MDfish_bot",
                init_data="",
            )
            if enabled_bool:
                await scheduler.add_account(acc_id_new)
            await db.add_log(acc_id_new, tg_name, "profile_music", music_status)
            asyncio.create_task(_background_warmup(session_string, acc_id_new, tg_name))
            results.append({"file": filename, "ok": True, "tg_name": tg_name, "id": acc_id_new})

        except Exception as e:
            results.append({"file": filename, "ok": False, "error": str(e)})
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    added = sum(1 for r in results if r["ok"])
    failed = len(results) - added
    return {"results": results, "added": added, "failed": failed}


@app.patch("/api/accounts/{acc_id}")
async def update_account(acc_id: int, data: AccountUpdate):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")

    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    requested_chat_id = updates.pop("chat_id", None)
    requested_secondary_chat_id = updates.pop("secondary_chat_id", None)
    updates.pop("chat", None)
    updates.pop("captcha_bot", None)
    updates.pop("init_data", None)
    if "timezone" in updates:
        updates["timezone"] = "Europe/Moscow"
    if "interval_minutes" in updates:
        updates["interval_minutes"] = max(10, updates["interval_minutes"])

    target_chat = None
    if requested_chat_id not in (None, 0):
        target_chat = await db.get_chat(requested_chat_id)
        if not target_chat:
            raise HTTPException(404, "chat not found")

    target_secondary_chat = None
    effective_primary_chat_id = requested_chat_id if requested_chat_id is not None else acc.get("chat_id")
    if requested_secondary_chat_id not in (None, 0):
        if requested_secondary_chat_id == effective_primary_chat_id:
            raise HTTPException(400, "secondary chat must be different from primary chat")
        target_secondary_chat = await db.get_chat(requested_secondary_chat_id)
        if not target_secondary_chat:
            raise HTTPException(404, "secondary chat not found")

    if requested_chat_id is not None and requested_chat_id != acc.get("chat_id"):
        await scheduler.remove_account(acc_id)
        if acc.get("chat"):
            leave_result = await scheduler.leave_account_chat(acc)
            if not leave_result["ok"]:
                await db.add_log(acc_id, acc["name"], "chat_leave_error", leave_result["error"])
        if requested_chat_id == 0:
            await db.unassign_account_chat(acc_id)
        else:
            await db.assign_account_to_chat(acc_id, target_chat, "queued")
            await scheduler.ensure_chat_queue(requested_chat_id)
        fresh = await db.get_account(acc_id)
        if fresh and fresh.get("secondary_chat_id") == requested_chat_id:
            await db.assign_account_secondary_chat(acc_id, None)

    if requested_secondary_chat_id is not None and requested_secondary_chat_id != acc.get("secondary_chat_id"):
        await scheduler.remove_account(acc_id)
        if acc.get("secondary_chat"):
            leave_result = await scheduler.leave_account_secondary_chat(acc)
            if not leave_result["ok"]:
                await db.add_log(acc_id, acc["name"], "secondary_chat_leave_error", leave_result["error"])
        if requested_secondary_chat_id == 0:
            await db.assign_account_secondary_chat(acc_id, None)
        else:
            await db.assign_account_secondary_chat(acc_id, target_secondary_chat, "queued", manual=True)

    if updates:
        # If first_name/last_name provided, merge into display name
        if "first_name" in updates or "last_name" in updates:
            fn = updates.pop("first_name", None) or ""
            ln = updates.pop("last_name", None) or ""
            full = (fn + " " + ln).strip()
            if full:
                updates["name"] = full
        await db.update_account(acc_id, updates)
    await scheduler.restart_account(acc_id)
    return {"ok": True}

@app.post("/api/accounts/{acc_id}/solve_captcha")
async def solve_captcha_endpoint(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    result = await scheduler.solve_captcha_now(acc_id)
    return result

@app.post("/api/accounts/{acc_id}/tour")
async def send_tour_endpoint(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    result = await scheduler.send_tour_command(acc_id)
    return result

@app.post("/api/accounts/{acc_id}/terminate_sessions")
async def terminate_other_sessions(acc_id: int):
    """Terminate all Telegram sessions except the current one (the stored session)."""
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        result = await client(functions.account.GetAuthorizationsRequest())
        terminated = 0
        for auth in result.authorizations:
            if not getattr(auth, 'current', False):
                try:
                    await client(functions.account.ResetAuthorizationRequest(hash=auth.hash))
                    terminated += 1
                except Exception:
                    pass
        await db.add_log(acc_id, acc["name"], "sessions_terminated", f"{terminated} сессий завершено")
        return {"ok": True, "terminated": terminated}
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        await client.disconnect()


@app.post("/api/accounts/{acc_id}/cleanup_profile_photos")
async def cleanup_profile_photos(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH не заданы в env")

    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise HTTPException(400, "session not authorized")
        result = await _delete_previous_profile_photos(client)
        await db.add_log(
            acc_id,
            acc["name"],
            "profile_photos_cleanup",
            f"deleted={result['deleted']} remaining={result['remaining']} kept_current={result['kept_current']}",
        )
        return {"ok": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        await db.add_log(acc_id, acc["name"], "profile_photos_cleanup_error", str(e))
        raise HTTPException(400, str(e))
    finally:
        await client.disconnect()


@app.post("/api/accounts/cleanup_profile_media_all")
async def cleanup_profile_media_all():
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH не заданы в env")
    if PROFILE_MEDIA_CLEANUP_LOCK.locked():
        raise HTTPException(409, "Массовая очистка уже запущена")

    async with PROFILE_MEDIA_CLEANUP_LOCK:
        accounts = await db.get_accounts()
        results = []
        totals = {
            "accounts": len(accounts),
            "succeeded": 0,
            "failed": 0,
            "photos_deleted": 0,
            "stories_found": 0,
            "stories_deleted": 0,
            "story_warnings": 0,
        }

        for index, acc in enumerate(accounts):
            acc_result = {
                "id": acc.get("id"),
                "name": acc.get("name"),
                "ok": False,
                "photos_deleted": 0,
                "photos_remaining": None,
                "stories_found": 0,
                "stories_deleted": 0,
                "story_errors": [],
                "error": "",
            }
            try:
                cleanup = await _cleanup_account_profile_media(acc)
                photos = cleanup["photos"]
                stories = cleanup["stories"]
                acc_result.update({
                    "ok": True,
                    "photos_deleted": photos.get("deleted", 0),
                    "photos_remaining": photos.get("remaining"),
                    "stories_found": stories.get("found", 0),
                    "stories_deleted": stories.get("deleted", 0),
                    "story_errors": stories.get("errors", []),
                })
                totals["photos_deleted"] += acc_result["photos_deleted"]
                totals["stories_found"] += acc_result["stories_found"]
                totals["stories_deleted"] += acc_result["stories_deleted"]
                totals["story_warnings"] += len(acc_result["story_errors"])
                details = (
                    f"photos_deleted={acc_result['photos_deleted']} "
                    f"photos_remaining={acc_result['photos_remaining']} "
                    f"stories_found={acc_result['stories_found']} "
                    f"stories_deleted={acc_result['stories_deleted']}"
                )
                if acc_result["story_errors"]:
                    details += f" story_errors={len(acc_result['story_errors'])}"
                await db.add_log(acc["id"], acc["name"], "profile_media_cleanup", details)
                totals["succeeded"] += 1
            except HTTPException as e:
                totals["failed"] += 1
                acc_result["error"] = str(e.detail)
                await db.add_log(acc["id"], acc["name"], "profile_media_cleanup_error", acc_result["error"])
            except FloodWaitError as e:
                totals["failed"] += 1
                acc_result["error"] = f"FloodWait {e.seconds}s"
                await db.add_log(acc["id"], acc["name"], "profile_media_cleanup_error", acc_result["error"])
            except Exception as e:
                totals["failed"] += 1
                acc_result["error"] = str(e)
                await db.add_log(acc["id"], acc["name"], "profile_media_cleanup_error", acc_result["error"])

            results.append(acc_result)
            if index < len(accounts) - 1 and PROFILE_MEDIA_CLEANUP_DELAY_SECONDS > 0:
                await asyncio.sleep(PROFILE_MEDIA_CLEANUP_DELAY_SECONDS)

        return {"ok": totals["failed"] == 0, **totals, "results": results}


@app.get("/api/accounts/{acc_id}/last_code")
async def get_last_login_code(acc_id: int):
    """Read last login code from Telegram service messages (777000)."""
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        msgs = await client.get_messages(777000, limit=5)
        for msg in msgs:
            text = getattr(msg, 'text', '') or getattr(msg, 'message', '') or ''
            m = re.search(r'\b(\d{5,6})\b', text)
            if m:
                return {"ok": True, "code": m.group(1), "text": text[:300]}
        return {"ok": False, "error": "Код не найден в последних 5 сообщениях"}
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        await client.disconnect()


@app.get("/api/accounts/{acc_id}/phone")
async def get_account_phone(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        me = await client.get_me()
        return {"ok": True, "phone": getattr(me, "phone", "") or ""}
    except Exception as e:
        raise HTTPException(400, str(e))
    finally:
        await client.disconnect()


@app.post("/api/accounts/{acc_id}/send_text")
async def send_account_text(acc_id: int, data: AccountMessageSend):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    text = data.text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    target = (data.target or "primary").strip().lower()
    if target not in ("primary", "secondary"):
        raise HTTPException(400, "invalid target")
    if target == "secondary" and not acc.get("secondary_chat"):
        raise HTTPException(400, "account has no secondary chat")
    if target == "primary" and not acc.get("chat"):
        raise HTTPException(400, "account has no chat")
    result = await scheduler.send_text_now(acc_id, text, target)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


@app.post("/api/accounts/{acc_id}/initialize")
async def initialize_account(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            if TWO_FA_PASSWORD:
                await client.sign_in(password=TWO_FA_PASSWORD)
            else:
                raise HTTPException(400, "session not authorized")
        music_status = await _ensure_profile_music_safe(client)
        await _warmup_new_account(client)
        await db.add_log(acc_id, acc["name"], "profile_music", music_status)
        await db.add_log(acc_id, acc["name"], "initialized", NEW_ACCOUNT_WARMUP_CHAT)
        return {"ok": True, "profile_music": music_status}
    except HTTPException:
        raise
    except Exception as e:
        await db.add_log(acc_id, acc["name"], "initialize_error", str(e))
        raise HTTPException(400, str(e))
    finally:
        await client.disconnect()


@app.post("/api/accounts/{acc_id}/replace_session")
async def replace_session(acc_id: int, session_file: UploadFile = File(...)):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404, "Аккаунт не найден")
    if not API_ID or not API_HASH:
        raise HTTPException(400, "TG_API_ID / TG_API_HASH не заданы в env")

    import tempfile
    content = await session_file.read()
    with tempfile.NamedTemporaryFile(suffix=".session", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        session_string = _sqlite_to_string_session(tmp_path)
        client = TelegramClient(StringSession(session_string), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
        await client.connect()
        try:
            if not await client.is_user_authorized():
                if TWO_FA_PASSWORD:
                    await client.sign_in(password=TWO_FA_PASSWORD)
                else:
                    raise HTTPException(400, "Сессия невалидна или истекла")
            me = await client.get_me()
            tg_name = me.username or me.first_name or str(me.id)
            tg_id = me.id
        finally:
            await client.disconnect()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Ошибка подключения: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    await scheduler.remove_account(acc_id)
    await scheduler.remove_forest_account(acc_id)
    await db.update_account(acc_id, {
        "session_string": session_string,
        "tg_name": tg_name,
        "tg_id": tg_id,
    })
    if acc.get("enabled"):
        await scheduler.add_account(acc_id)
    if acc.get("forest_enabled") and acc.get("forest_chat_status") == "joined":
        await scheduler.add_forest_account(acc_id)
    await db.add_log(acc_id, acc["name"], "session_replaced", f"new tg_id={tg_id}")
    return {"ok": True, "tg_name": tg_name}


@app.delete("/api/accounts/{acc_id}")
async def delete_account(acc_id: int):
    await scheduler.remove_account(acc_id)
    await scheduler.remove_forest_account(acc_id)
    await db.delete_account(acc_id)
    return {"ok": True}

@app.post("/api/accounts/{acc_id}/toggle")
async def toggle_account(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404)
    new_state = not acc["enabled"]
    await db.update_account(acc_id, {"enabled": new_state})
    if new_state:
        await scheduler.add_account(acc_id)
    else:
        await scheduler.remove_account(acc_id)
    return {"enabled": new_state}


@app.post("/api/accounts/{acc_id}/forest-toggle")
async def toggle_forest_account(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404)
    new_state = not bool(acc.get("forest_enabled"))
    updates = {"forest_enabled": new_state}
    if new_state and (acc.get("forest_chat_status") or "queued") != "joined":
        updates["forest_chat_status"] = "queued"
        updates["forest_chat_error"] = ""
    await db.update_account(acc_id, updates)
    if new_state:
        await scheduler.add_forest_account(acc_id)
    else:
        await scheduler.remove_forest_account(acc_id)
    return {"enabled": new_state}


@app.post("/api/forest/toggle-all")
async def toggle_all_forest_accounts(data: ForestToggleUpdate):
    accounts = await db.get_accounts()
    changed = 0
    for acc in accounts:
        if bool(acc.get("forest_enabled")) == data.enabled:
            continue
        updates = {"forest_enabled": data.enabled}
        if data.enabled and (acc.get("forest_chat_status") or "queued") != "joined":
            updates["forest_chat_status"] = "queued"
            updates["forest_chat_error"] = ""
        await db.update_account(acc["id"], updates)
        if data.enabled:
            await scheduler.add_forest_account(acc["id"])
        else:
            await scheduler.remove_forest_account(acc["id"])
        changed += 1
    return {"ok": True, "enabled": data.enabled, "changed": changed}


@app.post("/api/accounts/toggle-all")
async def toggle_all_accounts(data: MassToggleUpdate):
    accounts = await db.get_accounts()
    changed = 0
    for acc in accounts:
        if bool(acc.get("enabled")) == data.enabled:
            continue
        await db.update_account(acc["id"], {"enabled": data.enabled})
        if data.enabled:
            await scheduler.add_account(acc["id"])
        else:
            await scheduler.remove_account(acc["id"])
        changed += 1
    return {"ok": True, "enabled": data.enabled, "changed": changed}


@app.post("/api/chats/{chat_id}/toggle-accounts")
async def toggle_chat_accounts(chat_id: int, data: MassToggleUpdate):
    chat = await db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404, "chat not found")
    accounts = await db.get_accounts()
    changed = 0
    for acc in accounts:
        if acc.get("chat_id") != chat_id:
            continue
        if bool(acc.get("enabled")) == data.enabled:
            continue
        await db.update_account(acc["id"], {"enabled": data.enabled})
        if data.enabled and acc.get("chat_status") == "joined" and acc.get("chat"):
            await scheduler.add_account(acc["id"])
        else:
            await scheduler.remove_account(acc["id"])
        changed += 1
    return {"ok": True, "chat_id": chat_id, "enabled": data.enabled, "changed": changed}

@app.post("/api/accounts/{acc_id}/send_now")
async def send_now(acc_id: int):
    acc = await db.get_account(acc_id)
    if not acc:
        raise HTTPException(404)
    result = await scheduler.send_now(acc_id)
    return result

@app.get("/api/logs")
async def get_logs(acc_id: Optional[int] = None, limit: int = 100):
    logs = await db.get_logs(acc_id=acc_id, limit=limit)
    return {"logs": logs}

@app.get("/api/stats")
async def get_stats():
    stats = await db.get_stats()
    stats["forest"] = await db.get_forest_stats()
    return stats

@app.get("/api/settings")
async def get_settings():
    mode = await db.get_setting("fishing_location_mode", "Городской пруд")
    skip_sell = await db.get_setting("skip_sell_fish", "false")
    return {"fishing_location_mode": mode, "skip_sell_fish": skip_sell == "true"}

@app.post("/api/settings")
async def update_settings(data: SettingsUpdate):
    valid = ["Городской пруд", "Река", "Озеро", "Море", "auto"]
    if data.fishing_location_mode is not None:
        if data.fishing_location_mode not in valid:
            raise HTTPException(400, f"fishing_location_mode must be one of: {valid}")
        await db.set_setting("fishing_location_mode", data.fishing_location_mode)
        if data.fishing_location_mode != "auto":
            asyncio.create_task(scheduler.change_location_all(data.fishing_location_mode))
    if data.skip_sell_fish is not None:
        await db.set_setting("skip_sell_fish", "true" if data.skip_sell_fish else "false")
    return {"ok": True}


# --- API: chats ---

@app.get("/api/chats")
async def get_chats():
    return await db.get_chats()


@app.post("/api/chats")
async def create_chat(data: ChatCreate):
    chat_id = await db.create_chat(
        data.title.strip(),
        data.link.strip(),
        max(1, data.account_limit),
        max(1, data.join_interval_minutes),
        data.avoid_as_secondary,
    )
    assigned = await db.allocate_waiting_accounts()
    secondary_assigned = await db.assign_random_secondary_chats()
    for chat in await db.get_chats():
        await scheduler.ensure_chat_queue(chat["id"])
    return {"id": chat_id, "assigned": assigned, "secondary_assigned": secondary_assigned}


@app.patch("/api/chats/{chat_id}")
async def update_chat(chat_id: int, data: ChatUpdate):
    old_chat = await db.get_chat(chat_id)
    if not old_chat:
        raise HTTPException(404, "chat not found")
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "account_limit" in updates:
        updates["account_limit"] = max(1, updates["account_limit"])
    if "join_interval_minutes" in updates:
        updates["join_interval_minutes"] = max(1, updates["join_interval_minutes"])
    if updates:
        await db.update_chat(chat_id, updates)
    secondary_cleared = 0
    secondary_assigned = 0
    if updates.get("avoid_as_secondary") and not old_chat.get("avoid_as_secondary"):
        secondary_cleared = await db.clear_secondary_chat_assignments(chat_id)
        secondary_assigned = await db.assign_random_secondary_chats()
    moved = 0
    if "account_limit" in updates:
        moved = await scheduler.enforce_chat_limit(chat_id)
    await scheduler.restart_chat_queue(chat_id)
    return {"ok": True, "moved": moved, "secondary_cleared": secondary_cleared, "secondary_assigned": secondary_assigned}


@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: int):
    await db.delete_chat(chat_id)
    await db.assign_random_secondary_chats()
    await scheduler.restart_chat_queue(chat_id)
    return {"ok": True}


@app.post("/api/chats/distribute")
async def distribute_accounts():
    assigned = await db.allocate_waiting_accounts()
    secondary_assigned = await db.assign_random_secondary_chats()
    for chat in await db.get_chats():
        await scheduler.ensure_chat_queue(chat["id"])
    return {"assigned": assigned, "secondary_assigned": secondary_assigned}


@app.post("/api/accounts/{acc_id}/force_chat_join")
async def force_chat_join(acc_id: int):
    result = await scheduler.force_chat_join(acc_id)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


@app.post("/api/accounts/{acc_id}/find_chat")
async def find_chat(acc_id: int):
    result = await scheduler.find_chat_now(acc_id)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


# --- API: proxies ---

@app.get("/api/proxies")
async def get_proxies():
    return await db.get_proxies()

@app.post("/api/proxies/fetch")
async def fetch_proxies_endpoint(channel: str = "@mtp4tg", limit: int = 100):
    """Fetch MTProto proxies from a Telegram channel using the first available account."""
    from proxy_fetcher import fetch_proxies_from_channel
    accs = await db.get_accounts()
    if not accs:
        raise HTTPException(400, "Нет аккаунтов — нужен хотя бы один для подключения к каналу")
    acc = accs[0]
    client = TelegramClient(StringSession(acc["session_string"]), API_ID, API_HASH, **TELETHON_CLIENT_KWARGS)
    await client.connect()
    try:
        result = await fetch_proxies_from_channel(client, channel=channel, limit=limit)
        return result
    finally:
        await client.disconnect()

@app.post("/api/proxies/{proxy_id}/assign/{acc_id}")
async def assign_proxy(proxy_id: int, acc_id: int):
    if not await db.get_proxy(proxy_id):
        raise HTTPException(404, "Прокси не найден")
    if not await db.get_account(acc_id):
        raise HTTPException(404, "Аккаунт не найден")
    await db.assign_proxy(acc_id, proxy_id)
    await scheduler.restart_account(acc_id)
    return {"ok": True}

@app.post("/api/proxies/{proxy_id}/unassign/{acc_id}")
async def unassign_proxy(proxy_id: int, acc_id: int):
    await db.assign_proxy(acc_id, None)
    await scheduler.restart_account(acc_id)
    return {"ok": True}

@app.post("/api/proxies/{proxy_id}/mark-dead")
async def mark_proxy_dead_endpoint(proxy_id: int):
    accs = await db.get_accounts_by_proxy(proxy_id)
    await db.mark_proxy_dead(proxy_id, "manual")
    await db.reassign_proxy_accounts(proxy_id)
    for acc in accs:
        await scheduler.restart_account(acc["id"])
    return {"ok": True, "reassigned": len(accs)}

@app.post("/api/proxies/{proxy_id}/revive")
async def revive_proxy(proxy_id: int):
    """Mark a dead proxy as active again for retry."""
    proxy = await db.get_proxy(proxy_id)
    if not proxy:
        raise HTTPException(404)
    await db.update_proxy_status(proxy_id, "active")
    return {"ok": True}

@app.post("/api/proxies/revive-all")
async def revive_all_proxies():
    """Mark all proxies as active again without checking connectivity."""
    proxies = await db.get_proxies()
    revived = 0
    for proxy in proxies:
        if proxy.get("status") != "active":
            await db.update_proxy_status(proxy["id"], "active")
            revived += 1
    return {"ok": True, "revived": revived, "total": len(proxies)}

@app.post("/api/proxies/{proxy_id}/test")
async def test_proxy_endpoint(proxy_id: int):
    """Test a single proxy by trying to connect with any available account."""
    proxy = await db.get_proxy(proxy_id)
    if not proxy:
        raise HTTPException(404, "Прокси не найден")
    
    accounts = await db.get_accounts()
    if not accounts:
        raise HTTPException(400, "Нет аккаунтов для тестирования")
    
    acc = accounts[0]
    from telethon.sessions import StringSession
    from telethon.network import ConnectionTcpMTProxyRandomizedIntermediate
    
    proxy_cfg = (
        proxy["server"],
        proxy["port"],
        proxy["secret"],
    )
    
    client = TelegramClient(
        StringSession(acc["session_string"]),
        API_ID,
        API_HASH,
        connection=ConnectionTcpMTProxyRandomizedIntermediate,
        proxy=proxy_cfg,
        auto_reconnect=False,
        **TELETHON_CLIENT_KWARGS,
    )
    
    try:
        # Wait up to 15 seconds for actual connection
        await asyncio.wait_for(client.connect(), timeout=15)
        
        # Verify authorization
        is_auth = await asyncio.wait_for(client.is_user_authorized(), timeout=5)
        if not is_auth:
            await client.disconnect()
            raise RuntimeError("Сессия неавторизована")
        
        # Get user info to confirm it works
        me = await asyncio.wait_for(client.get_me(), timeout=5)
        await client.disconnect()
        
        # Success — reset proxy (clear errors)
        await db.reset_proxy(proxy_id)
        return {"ok": True, "status": "active", "user": f"{me.first_name} (@{me.username})"}
    except asyncio.TimeoutError:
        error_msg = "timeout"
        await db.mark_proxy_fail(proxy_id, error_msg)
        raise HTTPException(400, f"Прокси не ответил (timeout)")
    except Exception as e:
        try:
            await client.disconnect()
        except Exception:
            pass
        error_msg = str(e)[:150]
        await db.mark_proxy_fail(proxy_id, error_msg)
        raise HTTPException(400, f"Прокси неработающий: {error_msg}")

@app.post("/api/proxies/test-all")
async def test_all_proxies():
    """Test all dead proxies sequentially and attempt to revive working ones."""
    proxies = await db.get_proxies()
    dead_proxies = [p for p in proxies if p.get("status") == "dead"]
    
    if not dead_proxies:
        return {"ok": True, "tested": 0, "revived": 0}
    
    accounts = await db.get_accounts()
    if not accounts:
        raise HTTPException(400, "Нет аккаунтов для тестирования")
    
    acc = accounts[0]
    from telethon.sessions import StringSession
    from telethon.network import ConnectionTcpMTProxyRandomizedIntermediate
    
    revived = []
    failed = []
    
    for proxy in dead_proxies:
        client = None
        try:
            proxy_cfg = (
                proxy["server"],
                proxy["port"],
                proxy["secret"],
            )
            
            client = TelegramClient(
                StringSession(acc["session_string"]),
                API_ID,
                API_HASH,
                connection=ConnectionTcpMTProxyRandomizedIntermediate,
                proxy=proxy_cfg,
                auto_reconnect=False,
                **TELETHON_CLIENT_KWARGS,
            )
            
            # Wait for actual connection (up to 15 seconds)
            await asyncio.wait_for(client.connect(), timeout=15)
            
            # Verify authorization
            is_auth = await asyncio.wait_for(client.is_user_authorized(), timeout=5)
            if not is_auth:
                raise RuntimeError("Сессия неавторизована")
            
            # Verify we can fetch user (connection really works)
            await asyncio.wait_for(client.get_me(), timeout=5)
            
            # Success — reset proxy
            await db.reset_proxy(proxy["id"])
            revived.append(proxy["id"])
        except asyncio.TimeoutError:
            await db.mark_proxy_fail(proxy["id"], "timeout")
            failed.append(proxy["id"])
        except Exception as e:
            error_msg = str(e)[:100]
            await db.mark_proxy_fail(proxy["id"], error_msg)
            failed.append(proxy["id"])
        finally:
            if client:
                try:
                    await client.disconnect()
                except Exception:
                    pass
    
    return {"ok": True, "tested": len(dead_proxies), "revived": len(revived), "failed": len(failed)}

@app.delete("/api/proxies/{proxy_id}")
async def delete_proxy_endpoint(proxy_id: int):
    accs = await db.get_accounts_by_proxy(proxy_id)
    await db.delete_proxy(proxy_id)
    for acc in accs:
        await scheduler.restart_account(acc["id"])
    return {"ok": True}

@app.post("/api/proxies/auto-assign")
async def auto_assign_proxies(max_per_proxy: int = 3):
    """Auto-assign unassigned accounts to available active proxies."""
    accs = await db.get_accounts()
    unassigned = [a for a in accs if not a.get("proxy_id")]
    assigned_count = 0
    for acc in unassigned:
        proxy = await db.get_next_proxy(max_per_proxy)
        if not proxy:
            break
        await db.assign_proxy(acc["id"], proxy["id"])
        await scheduler.restart_account(acc["id"])
        assigned_count += 1
    return {"assigned": assigned_count, "no_proxy_available": len(unassigned) - assigned_count}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
