# StarLoot Admin MCP

Небольшой MCP-сервер для чтения данных из работающей админ-панели. Использует
официальный MCP SDK и транспорт stdio. Подключение к БД остаётся в админ-панели.

## Запуск

Требуется Node.js 18.20+. Настройте `admin-panel/config.json` по
`admin-panel/config.example.json` и запустите панель обычным способом.
В отдельном терминале из корня репозитория:

```bash
npm --prefix admin-panel/mcp ci
```

Добавьте сервер в конфигурацию MCP-клиента (замените путь и секрет):

```json
{
  "mcpServers": {
    "starloot-admin": {
      "command": "node",
      "args": ["/absolute/path/StarLoot/admin-panel/mcp/server.js"],
      "env": {
        "STARLOOT_ADMIN_URL": "http://127.0.0.1:8765",
        "STARLOOT_ADMIN_SECRET": "YOUR_ADMIN_SECRET"
      }
    }
  }
}
```

На Windows путь в JSON выглядит как `C:/projects/StarLoot/admin-panel/mcp/server.js`.
`STARLOOT_ADMIN_SECRET` должен совпадать с `adminSecret` в конфигурации панели.
URL панели по умолчанию — `http://127.0.0.1:8765`; для удалённого адреса нужен HTTPS.
Секрет передаётся через `Authorization: Bearer`. Не сохраняйте реальный секрет в Git.

Для ручного запуска задайте эти переменные окружения и выполните
`npm --prefix admin-panel/mcp start`. Сервер ожидает MCP-сообщения на stdin;
MCP-клиент запускает `node` напрямую, чтобы stdout содержал только протокол.

## Инструменты

| Инструмент | Параметры | Данные |
|---|---|---|
| `get_stats` | — | Игроки, активные экспедиции, ожидающие NFT |
| `list_players` | `search?`, `limit?` (1–100, по умолчанию 20), `offset?` | Поиск по ID, username или имени |
| `get_player` | `userId` (строка) | Профиль, экспедиции, инвентарь, баффы, модули, NFT, репутации |
| `list_events` | — | Последние 50 глобальных событий |

Например: `list_players({"search":"@pilot","limit":10})`, затем
`get_player({"userId":"123456789"})`.

Все инструменты обращаются только к существующим GET-маршрутам панели.
`list_players` получает список из API панели и применяет поиск и пагинацию локально.
Ошибки API возвращаются как MCP tool errors; таймаут запроса — 10 секунд.

## Проверка

```bash
npm --prefix admin-panel/mcp test
```

Тесты запускают сервер через stdio и локальную заглушку API. Реальная БД и бот
для проверки не нужны.
