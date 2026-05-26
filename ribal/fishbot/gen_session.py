"""
Генератор сессий для FishBot.
Запускай ЛОКАЛЬНО — получишь либо строку StringSession (для вставки в веб-интерфейс),
либо .session файл (для загрузки через bulk-upload).

Установи зависимости:
    pip install telethon python-dotenv

Запуск:
    python gen_session.py
"""
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv не установлен — читаем .env вручную
    _env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(_env_path):
        with open(_env_path) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())

from telethon.sync import TelegramClient
from telethon.sessions import StringSession

print("=== FishBot — генератор сессии ===\n")

# Берём из env автоматически, иначе просим вручную
api_id_env   = os.environ.get("TG_API_ID", "")
api_hash_env = os.environ.get("TG_API_HASH", "")

if api_id_env and api_hash_env:
    api_id   = int(api_id_env)
    api_hash = api_hash_env
    print(f"api_id/api_hash загружены из env (api_id={api_id})\n")
else:
    api_id   = int(input("api_id  (с my.telegram.org): ").strip())
    api_hash = input("api_hash: ").strip()

print("Выбери вариант:")
print("  1 — StringSession (строка для вставки в веб-интерфейс)")
print("  2 — .session файл (для bulk-upload)")
mode = input("Вариант [1/2]: ").strip() or "1"

phone = input("Номер телефона (с +): ").strip()

if mode == "2":
    session_name = input("Имя файла (без .session, например 'myaccount'): ").strip() or "account"
    session_arg  = session_name
else:
    session_arg  = StringSession()

client = TelegramClient(session_arg, api_id, api_hash)
# start() обрабатывает: SMS-код → если 2FA включена → спросит пароль автоматически
client.start(phone=phone)
me = client.get_me()
print(f"\n✅ Залогинен как: {me.first_name} (@{me.username}), id={me.id}")

if mode == "2":
    fname = f"{session_name}.session"
    print(f"\nФайл сохранён: {os.path.abspath(fname)}")
    print("Загружай его через кнопку 'Bulk Upload' в веб-интерфейсе.\n")
else:
    session_str = client.session.save()
    print("\n=== СКОПИРУЙ ЭТУ СТРОКУ ===")
    print(session_str)
    print("===========================")
    print("\nВставь её в поле 'Session String' при добавлении аккаунта.\n")

client.disconnect()
