# 🚀 Space Expedition Game — Telegram Mini App

Асинхронная экономическая игра в жанре космической экспедиции для Telegram Mini App.

Небольшой [MCP-сервер для админ-панели](admin-panel/mcp/README.md) предоставляет
статистику, поиск игроков, профили и глобальные события через stdio.

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────────┐
│              Telegram Client (WebApp)               │
│   React 18 + Vite + Zustand + Framer Motion        │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS + X-Telegram-Init-Data
┌──────────────────────▼──────────────────────────────┐
│           Backend (Node.js + Fastify)               │
│  Auth → RateLimit → AntiCheat → Services → DB      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              PostgreSQL 16                          │
│  users | expeditions | inventory | ship_modules    │
└─────────────────────────────────────────────────────┘
```

---

## 📁 Структура проекта

```
space-game/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── gameConfig.js      ← Все параметры игры
│   │   │   └── configManager.js   ← Hot-reload конфига из БД
│   │   ├── db/
│   │   │   ├── schema.sql         ← Полная схема PostgreSQL
│   │   │   └── pool.js            ← Пул соединений
│   │   ├── middleware/
│   │   │   └── telegramAuth.js    ← Валидация initData + nonce
│   │   ├── services/
│   │   │   ├── expeditionService.js  ← Жизненный цикл экспедиции
│   │   │   ├── findGeneratorService.js ← Генерация находок (provably fair)
│   │   │   └── userService.js     ← Пользователь, инвентарь, апгрейды
│   │   ├── routes/
│   │   │   └── index.js           ← Все REST маршруты
│   │   ├── bot/
│   │   │   └── telegramBot.js     ← Бот + уведомления
│   │   └── utils/logger.js
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── hooks/useTelegram.js   ← Telegram WebApp SDK
│   │   ├── store/gameStore.js     ← Zustand глобальный стор
│   │   ├── services/api.js        ← Все API вызовы
│   │   ├── components/
│   │   │   ├── panels/            ← Expedition, Collection, Upgrades
│   │   │   └── ui/                ← Переиспользуемые компоненты
│   │   └── assets/styles/global.css
│   ├── Dockerfile
│   └── package.json
│
└── docker-compose.yml
```

---

## 🔒 Безопасность

### 1. Telegram initData валидация
```
X-Telegram-Init-Data: query_id=...&user=...&auth_date=...&hash=...
```
- HMAC-SHA256 с ключом `HMAC("WebAppData", botToken)`
- Проверка `auth_date` (TTL = 1 час)
- Сохранение в каждом запросе

### 2. Anti-replay (nonce)
- Каждый мутирующий запрос содержит одноразовый `nonce`
- Nonce хранится в `used_nonces` и не принимается повторно
- TTL = 5 минут

### 3. Provably Fair генерация
- Сервер генерирует `server_seed` (скрытый до завершения)
- Клиент предоставляет `client_seed`
- Результат = `SHA256(server_seed + ":" + client_seed + ":" + nonce)`
- После сбора server_seed раскрывается для проверки

### 4. Rate Limiting
- 100 запросов / минуту на пользователя
- Fastify rate-limit plugin

### 5. Server-side validation
- ВСЕ расчёты цен, XP, редкости — только на сервере
- Клиент НЕ может передать желаемый результат

---

## 🚀 Быстрый старт (Development)

### 1. Требования
- Node.js 18+
- PostgreSQL 16+
- Telegram Bot Token

### 2. База данных
```bash
createdb space_game
psql space_game < backend/src/db/schema.sql
```

### 3. Backend
```bash
cd backend
cp .env.example .env
# Заполни .env
npm install
npm run dev
```

### 4. Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

---

## 🐳 Production (Docker)

```bash
# 1. Создай .env в корне проекта
cp .env.example .env

# 2. Запусти всё
docker-compose up -d

# 3. Проверь логи
docker-compose logs -f backend
```

### Переменные окружения
```env
DB_PASSWORD=strong_password_here
TELEGRAM_BOT_TOKEN=1234567890:AAF...
MINI_APP_URL=https://yourdomain.com
WEBHOOK_BASE_URL=https://api.yourdomain.com
BOT_WEBHOOK_SECRET=random_32_char_secret
VITE_API_URL=https://api.yourdomain.com/api
```

---

## 📡 API Reference

### Authentication
Все запросы (кроме `/health`) требуют заголовок:
```
X-Telegram-Init-Data: <Telegram.WebApp.initData>
```

### Endpoints

| Method | Path | Описание |
|--------|------|----------|
| GET | `/api/user/profile` | Профиль пользователя |
| GET | `/api/user/zones` | Доступные зоны |
| GET | `/api/user/inventory` | Инвентарь |
| GET | `/api/expedition/active` | Активная экспедиция |
| POST | `/api/expedition/start` | Начать экспедицию |
| POST | `/api/expedition/collect` | Получить результат |
| POST | `/api/expedition/action` | Действие (sell/collect/save_coords) |
| POST | `/api/expedition/speedup` | Ускорить за Stars |
| GET | `/api/upgrades` | Информация об апгрейдах |
| POST | `/api/upgrades/upgrade` | Улучшить модуль |

---

## ⚙️ Конфигурация игры

Все параметры в `backend/src/config/gameConfig.js`.
Переопределение через БД (таблица `game_config`):

```sql
-- Пример: изменить время экспедиции
INSERT INTO game_config (key, value, description)
VALUES ('expedition.baseDurationMinutes', '5', 'Базовое время экспедиции в минутах');

-- Пример: изменить шанс легендарного
INSERT INTO game_config (key, value)
VALUES ('rarity.legendary.weight', '3.5');
```

Конфиг перезагружается **автоматически каждые 60 секунд** без перезапуска сервера.

---

## 🔮 Дорожная карта (будущие расширения)

- [ ] Добыча астероидов (буровые установки)
- [ ] Фракции (модификаторы цен и редкости)
- [ ] Рынок игроков (торговля между пользователями)
- [ ] Галактические события (временные буферы)
- [ ] TON blockchain интеграция для NFT
- [ ] Турниры и лидерборд по сезонам
- [ ] WebSocket уведомления в реальном времени
- [ ] Реферальная система

---

## 📐 Схема БД (упрощённо)

```
users          → expeditions → expedition_results
     ↘                              ↓
      ship_modules          inventory_items
     ↗
credit_transactions
```

---

## 🧪 Тестирование

```bash
cd backend
npm test

# Для ручного теста без Telegram:
# Используй Postman с заголовком X-Telegram-Init-Data
# из реального Telegram WebApp (или мок в dev режиме)
```
