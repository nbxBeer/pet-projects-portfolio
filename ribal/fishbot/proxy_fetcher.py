import logging
from urllib.parse import urlparse, parse_qs

log = logging.getLogger("proxy_fetcher")


def _parse_from_text(text: str) -> dict | None:
    server = port = secret = None
    for line in (text or "").splitlines():
        l = line.strip()
        if l.lower().startswith("server:"):
            server = l.split(":", 1)[1].strip()
        elif l.lower().startswith("port:"):
            try:
                port = int(l.split(":", 1)[1].strip())
            except ValueError:
                pass
        elif l.lower().startswith("secret:"):
            secret = l.split(":", 1)[1].strip()
    if server and port and secret:
        return {"server": server, "port": port, "secret": secret, "source_url": ""}
    return None


def _parse_from_url(url: str) -> dict | None:
    try:
        p = urlparse(url)
        if "proxy" not in (p.path + p.netloc + p.query):
            return None
        qs = parse_qs(p.query)
        server = qs.get("server", [None])[0]
        port_s = qs.get("port", [None])[0]
        secret = qs.get("secret", [None])[0]
        if server and port_s and secret:
            return {"server": server, "port": int(port_s), "secret": secret, "source_url": url}
    except Exception:
        pass
    return None


async def fetch_proxies_from_channel(client, channel: str = "@mtp4tg", limit: int = 100) -> dict:
    """Parse recent messages in channel and add new MTProto proxies to DB."""
    from database import db

    added = skipped = 0
    seen: set[tuple] = set()

    try:
        msgs = await client.get_messages(channel, limit=limit)
        for msg in msgs:
            info = None

            # Prefer URL from inline button (most reliable)
            if msg.buttons:
                for row in msg.buttons:
                    btns = row if isinstance(row, (list, tuple)) else [row]
                    for btn in btns:
                        raw = getattr(btn, "button", btn)
                        url = getattr(raw, "url", None)
                        if url and "t.me/proxy" in url:
                            info = _parse_from_url(url)
                            if info:
                                break
                    if info:
                        break

            # Fallback: parse text body
            if not info and msg.text:
                info = _parse_from_text(msg.text)

            if not info:
                continue

            key = (info["server"], info["port"], info["secret"])
            if key in seen:
                continue
            seen.add(key)

            ok = await db.add_proxy(
                server=info["server"],
                port=info["port"],
                secret=info["secret"],
                source_url=info.get("source_url", ""),
            )
            if ok:
                added += 1
                log.info("proxy added: %s:%d", info["server"], info["port"])
            else:
                skipped += 1

    except Exception as e:
        log.warning("fetch_proxies_from_channel error: %s", e)
        return {"added": added, "skipped": skipped, "error": str(e)}

    return {"added": added, "skipped": skipped}
