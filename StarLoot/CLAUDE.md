# StarLoot — Claude Rules

## ОБЯЗАТЕЛЬНО после любых изменений фронтенда

**ВСЕГДА пересобирать фронт после изменения любого файла в `frontend/src/`:**

```bash
cd /home/user/StarLoot/frontend && npm run build
```

Затем добавить `frontend/dist` в коммит:

```bash
git add frontend/dist
```

Никогда не пушить изменения фронтенда без предварительного `npm run build`.

## Stack

- **Frontend**: React + Vite, Zustand, Framer Motion — `/frontend/src/`
- **Backend**: Fastify + Node.js + PostgreSQL — `/backend/src/`
- **Deploy**: built dist served from backend

## Dev branch

`claude/starloot-telegram-game-1hdMA`

## Icon Policy

- **Game frontend** (`frontend/src/`): NO Unicode icons or emoji. Use **SVG only** (inline or imported `.svg`). Lucide-react icons are allowed.
- **Admin panel** (`admin-panel/index.html`): Unicode icons and emoji are allowed.
