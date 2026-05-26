# Pixlands Railway Controller

Minimal web panel for running Pixlands progression sessions without opening the Telegram WebApp UI.

## Deploy To Railway

1. Create a private GitHub repo from this folder.
2. In Railway, create a new service from the GitHub repo.
3. Add a Railway Volume and mount it to:


```text
/data
```

4. Add Variables:

```text
PIXLANDS_DATA_DIR=/data
PIXLANDS_CONCURRENCY=2
PIXLANDS_NOTIFY_CHAT=777679631
PIXLANDS_PANEL_USER=admin
PIXLANDS_PANEL_PASSWORD=change_this_password
TELEGRAM_API_ID=38148591
TELEGRAM_API_HASH=YOUR_TELEGRAM_API_HASH
PIXLANDS_WEBAPP_URL=https://pixlands.com/?v=20260513G
PIXLANDS_REF_CODE=cxVQNPL
PIXLANDS_AUTOSTART=0
```

`PIXLANDS_PANEL_USER` and `PIXLANDS_PANEL_PASSWORD` enable the browser-native Basic Auth login prompt.

`TELEGRAM_API_ID` and `TELEGRAM_API_HASH` must match the Telegram app credentials used for these `.session` files.

Use `PIXLANDS_AUTOSTART=1` only if you want enabled sessions to restart automatically after each redeploy.

`PIXLANDS_WEBAPP_URL` is used by the Telegram `url` fallback mode. The runner tries `app,url` by default, so a Telegram Mini App short-name issue will automatically fall back to the visible bot link.

## Persistent Data

With `PIXLANDS_DATA_DIR=/data`, redeploys keep:

- uploaded `.session` files in `/data/pixsessions`
- runner reports in `/data/pixlands_progression_reports`
- panel config in `/data/pixlands_panel_state.json`
- storage marker in `/data/pixlands_storage_marker.json`
- Telethon runtime compatibility copies in `/data/telethon_compat_sessions`

The panel shows `Storage marker`, `writable`, and `sessions on disk` at the top. If the marker changes after redeploy, the Railway Volume is not mounted to the same path or `PIXLANDS_DATA_DIR` is wrong.

If sessions were uploaded before the Volume was attached, they were stored in Railway's ephemeral filesystem and must be uploaded again after the Volume is mounted.

## Panel Usage

- Upload `.session` files from the top form.
- Role defaults:
  - `1.session` to `5.session` -> `indara`
  - all other names -> `skywind`
- `Start progression` runs waves until `Target wave`, then daily actions.
- `Force daily only` runs boss/SkySea checks without wave progression.
- `Check auth` verifies the uploaded Telegram session and both WebView modes.
- `Start enabled` starts enabled accounts until the concurrency limit is reached.
- Banned accounts are stopped and shown as `banned`; they are not replaced automatically.

## Local Run

```powershell
cd C:\Users\User\Documents\botnet\pixland
python -m pip install -r requirements.txt
$env:PIXLANDS_DATA_DIR="C:\Users\User\Documents\botnet"
$env:PIXLANDS_PANEL_USER="admin"
$env:PIXLANDS_PANEL_PASSWORD="YOUR_PANEL_PASSWORD"
python -m uvicorn pixlands_web:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

Or use:

```powershell
.\run_web.bat
```

For local `run_web.bat`, auth is enabled only if `PIXLANDS_PANEL_PASSWORD` is set before launch.

## Troubleshooting

### Sessions disappeared after redeploy

Check the panel line:

```text
Storage marker: ... | writable: true | sessions on disk: ...
```

Expected Railway settings:

```text
Volume mount path: /data
PIXLANDS_DATA_DIR=/data
```

Upload sessions again after these two settings are active.

### Check auth fails

Use the `Check auth` button and copy the JSON. It includes:

- `authorized`
- Telegram user id/name when the `.session` is valid
- result for `app` and `url` WebView modes
- traceback for errors such as `too many values to unpack`

If a `.session` was created by a Telethon version with a 6-column `sessions` table but Railway has a Telethon build expecting 5 columns, the app creates a runtime compatibility copy in `/data/telethon_compat_sessions`. The uploaded original remains unchanged.
