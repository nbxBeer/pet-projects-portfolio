import asyncio
import json
import os
import secrets
import signal
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import pixlands_probe as pp
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("PIXLANDS_DATA_DIR") or BASE_DIR).resolve()
SESSIONS_DIR = DATA_DIR / "pixsessions"
REPORTS_DIR = DATA_DIR / "pixlands_progression_reports"
STATE_PATH = DATA_DIR / "pixlands_panel_state.json"
STORAGE_MARKER_PATH = DATA_DIR / "pixlands_storage_marker.json"
DEFAULT_NOTIFY_CHAT = int(os.getenv("PIXLANDS_NOTIFY_CHAT") or "777679631")
DEFAULT_CONCURRENCY = int(os.getenv("PIXLANDS_CONCURRENCY") or "2")
PANEL_USER = os.getenv("PIXLANDS_PANEL_USER") or os.getenv("PIXLANDS_PANEL_USERNAME") or "admin"
PANEL_PASSWORD = os.getenv("PIXLANDS_PANEL_PASSWORD") or ""


app = FastAPI(title="Pixlands Controller")
jobs: dict[str, dict[str, Any]] = {}
state_lock = asyncio.Lock()
check_results: dict[str, dict[str, Any]] = {}


def now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def ensure_dirs() -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    if not STORAGE_MARKER_PATH.exists():
        STORAGE_MARKER_PATH.write_text(
            json.dumps(
                {
                    "created_at": now(),
                    "data_dir": str(DATA_DIR),
                    "pid": os.getpid(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )


def storage_info() -> dict[str, Any]:
    ensure_dirs()
    marker = {}
    try:
        marker = json.loads(STORAGE_MARKER_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        marker = {"error": f"{type(exc).__name__}: {exc}"}
    sessions = session_files()
    return {
        "data_dir": str(DATA_DIR),
        "sessions_dir": str(SESSIONS_DIR),
        "reports_dir": str(REPORTS_DIR),
        "marker_path": str(STORAGE_MARKER_PATH),
        "marker": marker,
        "session_count": len(sessions),
        "session_files": [p.name for p in sessions],
        "data_dir_exists": DATA_DIR.exists(),
        "data_dir_writable": os.access(DATA_DIR, os.W_OK),
    }


def read_state() -> dict[str, Any]:
    ensure_dirs()
    if not STATE_PATH.exists():
        return {"sessions": {}, "settings": {"concurrency": DEFAULT_CONCURRENCY}}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"sessions": {}, "settings": {"concurrency": DEFAULT_CONCURRENCY}}


def write_state(state: dict[str, Any]) -> None:
    ensure_dirs()
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_PATH)


def session_files() -> list[Path]:
    ensure_dirs()
    return sorted(SESSIONS_DIR.glob("*.session"), key=lambda p: p.name.lower())


def safe_session_name(name: str) -> str:
    cleaned = Path(name).name.replace("\\", "_").replace("/", "_")
    if not cleaned.endswith(".session"):
        cleaned += ".session"
    if cleaned in ("", ".session") or ".." in cleaned:
        raise HTTPException(400, "bad session filename")
    return cleaned


def default_role(name: str) -> str:
    stem = Path(name).stem
    if stem.isdigit() and 1 <= int(stem) <= 5:
        return "indara"
    return "skywind"


def get_config(name: str) -> dict[str, Any]:
    state = read_state()
    cfg = dict((state.get("sessions") or {}).get(name) or {})
    cfg.setdefault("role", default_role(name))
    cfg.setdefault("target_wave", 9950 if cfg["role"] == "skywind" else 5000)
    cfg.setdefault("enabled", True)
    cfg.setdefault("sky_mode", "auto")
    cfg.setdefault("boss_mode", "auto")
    return cfg


def set_config(name: str, cfg: dict[str, Any]) -> None:
    state = read_state()
    state.setdefault("sessions", {})[name] = cfg
    write_state(state)


def panel_allowed(request: Request) -> bool:
    if not PANEL_PASSWORD:
        return True
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("basic "):
        return False
    import base64

    try:
        decoded = base64.b64decode(auth.split(" ", 1)[1]).decode("utf-8")
    except Exception:
        return False
    user, _, password = decoded.partition(":")
    return secrets.compare_digest(user, PANEL_USER) and secrets.compare_digest(password, PANEL_PASSWORD)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if not panel_allowed(request):
        return JSONResponse(
            {"error": "auth_required"},
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="Pixlands"'},
        )
    return await call_next(request)


def latest_report(name: str) -> dict[str, Any] | None:
    path = REPORTS_DIR / f"{Path(name).stem}-latest.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"error": "report_read_failed"}


def summarize_report(report: dict[str, Any] | None) -> dict[str, Any]:
    if not report:
        return {}
    final = report.get("final") or {}
    auth = report.get("auth") or {}
    fatal = report.get("fatal") or {}
    events = report.get("events") or []
    last = events[-1] if events else {}
    return {
        "auth": auth,
        "fatal": fatal,
        "final": {
            "max_wave": final.get("max_wave"),
            "current_wave": final.get("current_wave"),
            "gold": final.get("gold"),
            "level": final.get("level"),
        },
        "last_event": last,
        "last_error": last.get("error") or (report.get("fatal") or {}).get("message"),
        "updated_at": report.get("finished_at") or last.get("at") or report.get("started_at"),
    }


async def check_telegram_session(name: str) -> dict[str, Any]:
    session_path = SESSIONS_DIR / safe_session_name(name)
    if not session_path.exists():
        raise HTTPException(404, "session not found")
    result: dict[str, Any] = {
        "session": session_path.name,
        "ok": False,
        "modes": [],
        "sqlite": pp.session_sqlite_info(str(session_path)),
    }
    try:
        from telethon import TelegramClient

        compat_path = pp.compatible_session_path(str(session_path))
        result["telethon_session_path"] = compat_path
        if compat_path != str(session_path):
            result["compat_sqlite"] = pp.session_sqlite_info(compat_path)
        async with TelegramClient(compat_path, pp.API_ID, pp.API_HASH) as client:
            authorized = await client.is_user_authorized()
            result["authorized"] = authorized
            if authorized:
                me = await client.get_me()
                result["telegram_user"] = {
                    "id": getattr(me, "id", None),
                    "username": getattr(me, "username", None),
                    "first_name": getattr(me, "first_name", None),
                }
            else:
                result["error"] = "telegram session is not authorized"
                return result
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["traceback"] = traceback.format_exc(limit=8)
        return result

    for mode in ("app", "url"):
        try:
            webview_url = await asyncio.wait_for(
                pp.get_webview_url(str(session_path), "android", mode, "pixlands", os.getenv("PIXLANDS_REF_CODE") or "cxVQNPL"),
                timeout=45,
            )
            init_data = pp.extract_init_data(webview_url)
            result["modes"].append({"mode": mode, "ok": bool(init_data), "init_data": bool(init_data)})
            if init_data:
                result["ok"] = True
                result["working_mode"] = mode
                break
        except Exception as exc:
            result["modes"].append(
                {
                    "mode": mode,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(limit=8),
                }
            )
    if not result["ok"] and not result.get("error"):
        result["error"] = "Telegram returned no usable WebApp initData"
    return result


async def read_stdout(name: str, proc: asyncio.subprocess.Process) -> None:
    assert proc.stdout is not None
    while True:
        raw = await proc.stdout.readline()
        if not raw:
            break
        line = raw.decode("utf-8", errors="replace").rstrip()
        job = jobs.get(name)
        if not job:
            continue
        tail = job.setdefault("tail", [])
        tail.append(line)
        del tail[:-120]
        job["last_line"] = line
        if "account banned" in line.lower():
            job["status"] = "banned"


async def wait_job(name: str, proc: asyncio.subprocess.Process) -> None:
    code = await proc.wait()
    job = jobs.get(name)
    if job:
        if job.get("status") != "banned":
            job["status"] = "stopped" if code == 0 else "error"
        job["returncode"] = code
        job["stopped_at"] = now()
        job.pop("process", None)


def running_count() -> int:
    return sum(1 for job in jobs.values() if job.get("process") and job["process"].returncode is None)


async def start_runner(name: str, *, daily_only: bool = False) -> dict[str, Any]:
    async with state_lock:
        ensure_dirs()
        session_path = SESSIONS_DIR / safe_session_name(name)
        if not session_path.exists():
            raise HTTPException(404, "session not found")
        current = jobs.get(name)
        if current and current.get("process") and current["process"].returncode is None:
            return {"ok": True, "message": "already running"}
        state = read_state()
        concurrency = int((state.get("settings") or {}).get("concurrency") or DEFAULT_CONCURRENCY)
        if running_count() >= concurrency:
            raise HTTPException(409, f"concurrency limit reached: {concurrency}")
        cfg = get_config(name)
        role = cfg.get("role") or default_role(name)
        target_wave = 0 if daily_only else int(cfg.get("target_wave") or 200)
        cmd = [
            sys.executable,
            "-u",
            str(BASE_DIR / "pixlands_progression_runner.py"),
            "--session",
            str(session_path),
            "--target-wave",
            str(target_wave),
            "--boss-locations",
            role,
            "--boss-mode",
            str(cfg.get("boss_mode") or "auto"),
            "--sky-mode",
            str(cfg.get("sky_mode") or "auto"),
            "--notify-chat",
            str(DEFAULT_NOTIFY_CHAT),
            "--out-dir",
            str(REPORTS_DIR),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(BASE_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        jobs[name] = {
            "status": "running_daily" if daily_only else "running",
            "mode": "daily" if daily_only else "progression",
            "started_at": now(),
            "role": role,
            "target_wave": target_wave,
            "process": proc,
            "tail": [],
        }
        asyncio.create_task(read_stdout(name, proc))
        asyncio.create_task(wait_job(name, proc))
        return {"ok": True, "pid": proc.pid, "role": role, "target_wave": target_wave}


async def stop_runner(name: str) -> dict[str, Any]:
    async with state_lock:
        job = jobs.get(name)
        proc = job.get("process") if job else None
        if not proc or proc.returncode is not None:
            return {"ok": True, "message": "not running"}
        job["status"] = "stopping"
        try:
            if os.name == "nt":
                proc.terminate()
            else:
                proc.send_signal(signal.SIGTERM)
            await asyncio.wait_for(proc.wait(), timeout=20)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
        job["status"] = "stopped"
        job["stopped_at"] = now()
        job.pop("process", None)
        return {"ok": True}


def status_payload() -> dict[str, Any]:
    sessions = []
    known = {p.name for p in session_files()}
    known.update((read_state().get("sessions") or {}).keys())
    for name in sorted(known, key=str.lower):
        cfg = get_config(name)
        job = dict(jobs.get(name) or {})
        job.pop("process", None)
        report = latest_report(name)
        sessions.append(
            {
                "name": name,
                "exists": (SESSIONS_DIR / name).exists(),
                "config": cfg,
                "job": job,
                "report": summarize_report(report),
                "check": check_results.get(name),
            }
        )
    state = read_state()
    return {
        "data_dir": str(DATA_DIR),
        "sessions_dir": str(SESSIONS_DIR),
        "reports_dir": str(REPORTS_DIR),
        "storage": storage_info(),
        "settings": state.get("settings") or {},
        "running": running_count(),
        "sessions": sessions,
        "now": now(),
    }


@app.on_event("startup")
async def startup() -> None:
    ensure_dirs()
    if os.getenv("PIXLANDS_AUTOSTART") == "1":
        for path in session_files():
            cfg = get_config(path.name)
            if cfg.get("enabled"):
                try:
                    await start_runner(path.name)
                except Exception:
                    pass


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    return HTML


@app.get("/favicon.ico")
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/api/status")
async def api_status() -> dict[str, Any]:
    return status_payload()


@app.get("/api/storage")
async def api_storage() -> dict[str, Any]:
    return storage_info()


@app.post("/api/settings")
async def api_settings(concurrency: int = Form(DEFAULT_CONCURRENCY)) -> dict[str, Any]:
    state = read_state()
    state.setdefault("settings", {})["concurrency"] = max(1, min(20, int(concurrency)))
    write_state(state)
    return {"ok": True}


@app.post("/api/upload")
async def api_upload(files: list[UploadFile] = File(...), role: str = Form("auto")) -> dict[str, Any]:
    saved = []
    ensure_dirs()
    for file in files:
        name = safe_session_name(file.filename or "")
        target = SESSIONS_DIR / name
        content = await file.read()
        target.write_bytes(content)
        cfg = get_config(name)
        if role in ("indara", "skywind"):
            cfg["role"] = role
        else:
            cfg["role"] = default_role(name)
        set_config(name, cfg)
        saved.append({"name": name, "role": cfg["role"], "bytes": len(content)})
    return {"ok": True, "saved": saved}


@app.post("/api/session/{name}/config")
async def api_session_config(
    name: str,
    role: str = Form("indara"),
    target_wave: int = Form(200),
    enabled: bool = Form(True),
    boss_mode: str = Form("auto"),
    sky_mode: str = Form("auto"),
) -> dict[str, Any]:
    name = safe_session_name(name)
    if role not in ("indara", "skywind"):
        raise HTTPException(400, "role must be indara or skywind")
    cfg = {
        "role": role,
        "target_wave": max(0, int(target_wave)),
        "enabled": bool(enabled),
        "boss_mode": boss_mode if boss_mode in ("auto", "off") else "auto",
        "sky_mode": sky_mode if sky_mode in ("auto", "off") else "auto",
    }
    set_config(name, cfg)
    return {"ok": True, "config": cfg}


@app.post("/api/session/{name}/start")
async def api_start(name: str) -> dict[str, Any]:
    return await start_runner(safe_session_name(name))


@app.post("/api/session/{name}/daily")
async def api_daily(name: str) -> dict[str, Any]:
    return await start_runner(safe_session_name(name), daily_only=True)


@app.post("/api/session/{name}/stop")
async def api_stop(name: str) -> dict[str, Any]:
    return await stop_runner(safe_session_name(name))


@app.post("/api/session/{name}/check")
async def api_check_session(name: str) -> dict[str, Any]:
    safe_name = safe_session_name(name)
    result = await check_telegram_session(safe_name)
    check_results[safe_name] = {"at": now(), "result": result}
    return result


@app.post("/api/start-enabled")
async def api_start_enabled() -> dict[str, Any]:
    started = []
    errors = []
    for path in session_files():
        cfg = get_config(path.name)
        if not cfg.get("enabled"):
            continue
        try:
            started.append({path.name: await start_runner(path.name)})
        except Exception as exc:
            errors.append({path.name: str(exc)})
            break
    return {"ok": not errors, "started": started, "errors": errors}


@app.post("/api/stop-all")
async def api_stop_all() -> dict[str, Any]:
    names = list(jobs)
    stopped = []
    for name in names:
        stopped.append({name: await stop_runner(name)})
    return {"ok": True, "stopped": stopped}


HTML = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pixlands Controller</title>
  <style>
    :root{color-scheme:dark;--bg:#111316;--panel:#191d22;--panel2:#20252c;--line:#303740;--text:#eef1f4;--muted:#aab2bd;--ok:#8bd17c;--warn:#f7c46c;--bad:#ff8a80;--accent:#7fb3ff}
    *{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:var(--bg);color:var(--text);font-size:14px}
    header{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:14px 18px;background:#171a1f;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}
    h1{font-size:18px;margin:0}.subtitle{margin-top:3px;font-size:12px;color:var(--muted)}main{padding:16px;display:grid;gap:14px}
    .toolbar,.panel,.card{background:var(--panel);border:1px solid var(--line);border-radius:8px}.toolbar{display:grid;grid-template-columns:2fr 1fr auto;gap:12px;padding:12px;align-items:end}
    .panel{padding:12px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.stack{display:grid;gap:8px}
    button,input,select{background:var(--panel2);color:var(--text);border:1px solid #3d4652;border-radius:6px;padding:8px 10px;min-height:36px}
    button{cursor:pointer;font-weight:600}button:hover{border-color:var(--accent)}button.primary{background:#1f3b5f;border-color:#386da8}button.danger{background:#3a2022;border-color:#7b383b}
    input[type=file]{width:100%}label{font-size:12px;color:var(--muted);display:grid;gap:4px}.hint{font-size:12px;color:var(--muted);line-height:1.35}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
    .stat{background:#121519;border:1px solid #252b33;border-radius:6px;padding:8px}.stat b{display:block;font-size:16px}.stat span{font-size:11px;color:var(--muted)}
    .card{padding:12px;display:grid;gap:10px}.card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.name{font-weight:700;font-size:16px}.meta{font-size:12px;color:var(--muted)}
    .pill{padding:3px 8px;border:1px solid #3a414b;border-radius:999px;font-size:12px;background:#14171b}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
    .config{display:grid;grid-template-columns:repeat(5,minmax(80px,1fr));gap:8px}.actions{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
    pre{white-space:pre-wrap;max-height:170px;overflow:auto;background:#0c0e10;border:1px solid #252a30;border-radius:6px;padding:8px;font-size:12px;margin:0}
    .empty{padding:30px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:8px}.toast{position:fixed;right:14px;bottom:14px;background:#20252c;border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:none}
    @media(max-width:800px){.toolbar{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.config{grid-template-columns:1fr 1fr}.actions{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}header{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
<header>
  <div><h1>Pixlands Controller</h1><div class="subtitle" id="paths">loading...</div></div>
  <div class="row"><button onclick="refresh()">Refresh</button><button class="primary" onclick="post('/api/start-enabled')">Start enabled</button><button class="danger" onclick="post('/api/stop-all')">Stop all</button></div>
</header>
<main>
  <section class="toolbar">
    <form id="upload" class="stack">
      <label>Upload Telegram sessions<input type="file" name="files" multiple></label>
      <div class="row"><select name="role"><option value="auto">auto role by filename</option><option value="indara">force indara</option><option value="skywind">force skywind</option></select><button class="primary">Upload</button></div>
      <div class="hint">Files are stored in the volume under pixsessions. Default role: 1-5.session = indara, others = skywind.</div>
    </form>
    <form id="settings" class="stack">
      <label>Parallel runners<input name="concurrency" id="concurrency" type="number" min="1" max="20" value="2"></label>
      <button>Save concurrency</button>
    </form>
    <div class="stats">
      <div class="stat"><b id="running">0/2</b><span>running</span></div>
      <div class="stat"><b id="total">0</b><span>sessions</span></div>
      <div class="stat"><b id="enabled">0</b><span>enabled</span></div>
      <div class="stat"><b id="clock">-</b><span>server time</span></div>
    </div>
    <div class="hint" id="storage" style="grid-column:1/-1"></div>
  </section>
  <section class="panel">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <div><strong>Accounts</strong><div class="hint">Set boss target, start progression, or force only daily boss/SkySea checks.</div></div>
      <span class="pill" id="security"></span>
    </div>
    <div class="grid" id="sessions"></div>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(text){const t=document.getElementById('toast');t.textContent=text;t.style.display='block';setTimeout(()=>t.style.display='none',3500);}
async function post(url, body){
  const res = await fetch(url,{method:'POST',body});
  const text = await res.text();
  if(!res.ok){toast(text); return;}
  try{
    const data=JSON.parse(text);
    if(data.errors && data.errors.length) toast('Stopped on limit/error: '+JSON.stringify(data.errors)); else toast(data.ok===false?'Check failed':'OK');
  }catch(e){toast('OK');}
  await refresh();
}
document.getElementById('upload').onsubmit=e=>{e.preventDefault();post('/api/upload',new FormData(e.target));};
document.getElementById('settings').onsubmit=e=>{e.preventDefault();post('/api/settings',new FormData(e.target));};
function statusClass(status){return status==='running'||status==='running_daily'?'ok':(status==='banned'||status==='error'?'bad':(status==='stopping'?'warn':''));}
function statusText(status){return {running:'progression running',running_daily:'daily running',idle:'idle',stopped:'stopped',error:'error',banned:'banned',stopping:'stopping'}[status]||status;}
async function refresh(){
  const data=await (await fetch('/api/status')).json();
  const limit=data.settings.concurrency||2;
  document.getElementById('paths').textContent='data '+data.data_dir+' | sessions '+data.sessions_dir;
  const storage=data.storage||{};
  const marker=storage.marker||{};
  document.getElementById('storage').textContent='Storage marker: '+(marker.created_at||'missing')+' | writable: '+storage.data_dir_writable+' | sessions on disk: '+(storage.session_files||[]).join(', ');
  document.getElementById('running').textContent=data.running+' / '+limit;
  document.getElementById('total').textContent=data.sessions.length;
  document.getElementById('enabled').textContent=data.sessions.filter(s=>(s.config||{}).enabled).length;
  document.getElementById('clock').textContent=(data.now||'').split(' ')[1]||data.now;
  document.getElementById('concurrency').value=limit;
  document.getElementById('security').textContent='Browser Basic Auth: set PIXLANDS_PANEL_USER + PIXLANDS_PANEL_PASSWORD';
  const root=document.getElementById('sessions');
  if(!data.sessions.length){root.innerHTML='<div class="empty">No sessions yet. Upload .session files above.</div>';return;}
  root.innerHTML=data.sessions.map(s=>{
    const cfg=s.config||{}, job=s.job||{}, rep=s.report||{}, last=rep.last_event||{}, fatal=rep.fatal||{}, check=s.check||null;
    const status=job.status||fatal.type||'idle';
    const cls=statusClass(status);
    const tail=(job.tail||[]).slice(-12).join('\\n') || 'No live log yet.';
    const final=rep.final||{}, auth=rep.auth||{};
    return `<article class="card">
      <div class="card-head">
        <div><div class="name">${esc(s.name)}</div><div class="meta">Telegram user: ${esc(auth.username||auth.display_name||auth.id||'not authorized yet')}</div></div>
        <div class="row"><span class="pill ${cls}">${esc(statusText(status))}</span><span class="pill">${s.exists?'file ok':'missing file'}</span></div>
      </div>
      <div class="stats">
        <div class="stat"><b>${esc(cfg.role)}</b><span>boss role</span></div>
        <div class="stat"><b>${esc(final.max_wave||final.current_wave||'-')}</b><span>last wave</span></div>
        <div class="stat"><b>${esc(final.level||'-')}</b><span>level</span></div>
        <div class="stat"><b>${esc(final.gold||'-')}</b><span>gold</span></div>
      </div>
      <form class="config" onsubmit="event.preventDefault();post('/api/session/${encodeURIComponent(s.name)}/config',new FormData(this))">
        <label>Boss<select name="role"><option ${cfg.role==='indara'?'selected':''}>indara</option><option ${cfg.role==='skywind'?'selected':''}>skywind</option></select></label>
        <label>Target wave<input name="target_wave" type="number" min="0" value="${esc(cfg.target_wave||200)}"></label>
        <label>Enabled<select name="enabled"><option value="true" ${cfg.enabled?'selected':''}>true</option><option value="false" ${!cfg.enabled?'selected':''}>false</option></select></label>
        <label>Boss mode<select name="boss_mode"><option ${cfg.boss_mode!=='off'?'selected':''}>auto</option><option ${cfg.boss_mode==='off'?'selected':''}>off</option></select></label>
        <label>SkySea<select name="sky_mode"><option ${cfg.sky_mode!=='off'?'selected':''}>auto</option><option ${cfg.sky_mode==='off'?'selected':''}>off</option></select></label>
        <button>Save account</button>
      </form>
      <div class="actions">
        <button class="primary" onclick="post('/api/session/${encodeURIComponent(s.name)}/start')">Start progression</button>
        <button onclick="post('/api/session/${encodeURIComponent(s.name)}/daily')">Force daily only</button>
        <button onclick="post('/api/session/${encodeURIComponent(s.name)}/check')">Check auth</button>
        <button class="danger" onclick="post('/api/session/${encodeURIComponent(s.name)}/stop')">Stop</button>
      </div>
      <div class="meta">Updated: ${esc(rep.updated_at||'-')} | Last: ${esc(last.message||'-')}</div>
      <div class="meta ${rep.last_error?'bad':''}">${rep.last_error?'Error: '+esc(rep.last_error):''}</div>
      ${check?`<div class="meta">Auth check: ${esc(check.at)}</div><pre>${esc(JSON.stringify(check.result,null,2))}</pre>`:''}
      <pre>${esc(tail)}</pre>
    </article>`;
  }).join('');
}
refresh(); setInterval(refresh,5000);
</script>
</body>
</html>"""
