import requests
import time
import json
import threading
import random
import string

# ══════════════════════════════════════════════
#  ЗАПОЛНИ ЭТИ ДВА ПОЛЯ ПЕРЕД ЗАПУСКОМ
# ══════════════════════════════════════════════
INIT_DATA = "user=%7B%22id%22%3A7813581079%2C%22first_name%22%3A%22%D0%94%D1%80%D1%83%D0%BA%22%2C%22last_name%22%3A%22%22%2C%22username%22%3A%22Friend04ka%22%2C%22language_code%22%3A%22ru%22%2C%22allows_write_to_pm%22%3Atrue%2C%22photo_url%22%3A%22https%3A%5C%2F%5C%2Ft.me%5C%2Fi%5C%2Fuserpic%5C%2F320%5C%2F91rQoIQhoK1ZyGWQQphl-uYTmiBEpwonj7ZyG1F8KNgJ2l1LmekResNURnzz3TA4.svg%22%7D&chat_instance=-1671838509738724420&chat_type=sender&auth_date=1776971974&signature=Q147O2Z-NHplVuq2l6v3hnxe52zZDu1FKXn5tBibjnolpCSFebUoRvA39lX7xy0IisG2ERgsaymrVUiDvV0hBg&hash=ffbb2099b0db2203f8cced7be8ea04423e06e430f9dcefdcb3d6416a2b4063db"
TOKEN     = "5DB85SDlvqGKyqcdzehkOq9W"  # вставь токен из ссылки капчи сюда
# ══════════════════════════════════════════════

BASE = "https://fish.monkeysdynasty.website"
HDR  = {"X-Telegram-Init-Data": INIT_DATA, "Content-Type": "application/json"}

results = []

def sep(n, title):
    print(f"\n{'═'*55}")
    print(f"  ТЕСТ {n}: {title}")
    print('═'*55)

def ok(msg):   print(f"  ✅ {msg}"); results.append(("✅", msg))
def fail(msg): print(f"  ❌ {msg}"); results.append(("❌", msg))
def warn(msg): print(f"  ⚠️  {msg}"); results.append(("⚠️ ", msg))
def info(msg): print(f"  ℹ  {msg}")

def solve(token, answer, headers=None):
    h = headers or HDR
    return requests.post(f"{BASE}/api/captcha/solve", headers=h,
                         json={"token": token, "answer": answer})

def challenge(token, headers=None):
    h = headers or HDR
    return requests.get(f"{BASE}/api/captcha/challenge?token={token}", headers=h)


# ──────────────────────────────────────────────
# 1. initData жив?
# ──────────────────────────────────────────────
sep(1, "initData действителен без браузера")
r = requests.get(f"{BASE}/api/profile", headers=HDR)
if r.ok:
    p = r.json()
    ok(f"Работает. user={p.get('username')} level={p.get('level')} coins={p.get('coins')}")
else:
    fail(f"HTTP {r.status_code}: {r.text[:150]}")

# ──────────────────────────────────────────────
# 2. Запрос БЕЗ заголовка вообще
# ──────────────────────────────────────────────
sep(2, "Запрос без X-Telegram-Init-Data")
r = requests.get(f"{BASE}/api/profile")
if r.status_code in (401, 403):
    ok(f"Сервер блокирует без заголовка ({r.status_code})")
else:
    fail(f"Пустой заголовок не блокируется! HTTP {r.status_code}: {r.text[:150]}")

# ──────────────────────────────────────────────
# 3. Фейковый initData (подделанная подпись)
# ──────────────────────────────────────────────
sep(3, "Фейковый initData — подделанная подпись")
fake_hdr = {
    "X-Telegram-Init-Data": "query_id=FAKE&user=%7B%22id%22%3A1234567%7D&auth_date=1776952176&hash=deadbeefdeadbeefdeadbeefdeadbeef",
    "Content-Type": "application/json"
}
r = requests.get(f"{BASE}/api/profile", headers=fake_hdr)
if r.status_code in (401, 403):
    ok(f"Подпись проверяется, фейк отклонён ({r.status_code})")
else:
    fail(f"ФЕЙКОВЫЙ initData принят! HTTP {r.status_code}: {r.text[:150]}")

# ──────────────────────────────────────────────
# 4. Пустой initData
# ──────────────────────────────────────────────
sep(4, "Пустой initData")
r = requests.get(f"{BASE}/api/profile", headers={"X-Telegram-Init-Data": ""})
if r.status_code in (401, 403):
    ok(f"Пустой заголовок блокируется ({r.status_code})")
else:
    fail(f"Пустой initData принят! HTTP {r.status_code}")

# ──────────────────────────────────────────────
# 5. Получить вопрос + проверка утечки ответа
# ──────────────────────────────────────────────
sep(5, "Получить вопрос и проверить утечку ответа")
if not TOKEN:
    warn("TOKEN пустой — пропускаем тесты 5-20")
else:
    r = challenge(TOKEN)
    print(f"  HTTP: {r.status_code}")
    if r.ok:
        data = r.json()
        ok("Вопрос получен через API без браузера")
        print(f"\n  Полный ответ:\n{json.dumps(data, ensure_ascii=False, indent=4)}\n")

        payload = data.get("challenge", {}).get("payload", {})
        info(f"prompt:     {payload.get('prompt')}")
        info(f"symbol_map: {payload.get('symbol_map')}")
        info(f"steps:      {payload.get('steps')}")

        raw = json.dumps(data, ensure_ascii=False).lower()
        leaked = [f for f in ["answer","correct","solution","expected","key","result"] if f in raw]
        if leaked:
            fail(f"УТЕЧКА ОТВЕТА: поля {leaked} найдены в ответе!")
        else:
            ok("Ответ в ответе сервера не найден")
    else:
        fail(f"{r.status_code}: {r.text[:200]}")

# ──────────────────────────────────────────────
# 6. Повторный GET challenge — сбрасывается ли таймер?
# ──────────────────────────────────────────────
sep(6, "Повторный запрос challenge — сбрасывает ли таймер?")
if TOKEN:
    r1 = challenge(TOKEN)
    t1 = r1.json().get("challenge", {}).get("remaining_seconds", 0) if r1.ok else 0
    time.sleep(3)
    r2 = challenge(TOKEN)
    t2 = r2.json().get("challenge", {}).get("remaining_seconds", 0) if r2.ok else 0
    info(f"remaining при 1-м запросе: {t1}s | при 2-м (через 3с): {t2}s")
    if t2 >= t1:
        fail("Таймер сбрасывается при каждом GET — можно перезапрашивать вечно!")
    else:
        ok(f"Таймер идёт корректно (убыло ~{t1-t2}с)")

# ──────────────────────────────────────────────
# 7. Ответ с разным регистром и пробелами
# ──────────────────────────────────────────────
sep(7, "Чувствительность к регистру и пробелам")
if TOKEN:
    answer_input = input("  Введи правильный ответ для проверки регистра: ").strip()
    variants = [
        (answer_input.lower(),       "lower"),
        (answer_input.upper(),       "UPPER"),
        (answer_input.capitalize(),  "Capitalize"),
        (" " + answer_input,         "пробел_до"),
        (answer_input + " ",         "пробел_после"),
        (answer_input + "\n",        "\\n_после"),
    ]
    for v, label in variants:
        r = solve(TOKEN, v)
        status = r.json().get("error", "OK" if r.ok else f"HTTP{r.status_code}")
        info(f"  [{label}] → {status}")
        if r.ok:
            fail(f"Принят вариант [{label}] — строгости нет!")
            break

# ──────────────────────────────────────────────
# 8. Rate limit — 10 неверных подряд
# ──────────────────────────────────────────────
sep(8, "Rate limit: 10 неверных ответов подряд")
if TOKEN:
    for i in range(1, 11):
        r = solve(TOKEN, f"неверный_ответ_{i}")
        code = r.json().get("error", f"HTTP{r.status_code}")
        info(f"  Попытка {i}: {code}")
        if r.status_code == 429:
            ok(f"Rate limit сработал на попытке {i}")
            break
        if code == "penalty_active":
            warn(f"Штраф выдан на попытке {i} — это и есть защита")
            break
        time.sleep(0.2)
    else:
        fail("10 попыток без rate limit — брутфорс возможен")

# ──────────────────────────────────────────────
# 9. Гонка (race condition) — два одновременных правильных ответа
# ──────────────────────────────────────────────
sep(9, "Race condition: два одновременных верных ответа")
if TOKEN:
    answer_race = input("  Введи правильный ответ (для race test): ").strip()
    race_results = []

    def send_race(n):
        r = solve(TOKEN, answer_race)
        race_results.append((n, r.status_code, r.json()))

    t1 = threading.Thread(target=send_race, args=(1,))
    t2 = threading.Thread(target=send_race, args=(2,))
    t1.start(); t2.start()
    t1.join();  t2.join()

    for n, status, body in race_results:
        info(f"  Поток {n}: HTTP {status} | {body}")
    wins = [x for x in race_results if x[1] == 200]
    if len(wins) > 1:
        fail("Оба потока получили 200 — race condition есть!")
    else:
        ok("Только один поток прошёл — гонки нет")

# ──────────────────────────────────────────────
# 10. Повторное использование решённого токена
# ──────────────────────────────────────────────
sep(10, "Токен работает повторно после решения?")
if TOKEN:
    answer_reuse = input("  Введи правильный ответ (для reuse test): ").strip()
    r1 = solve(TOKEN, answer_reuse)
    info(f"  1-й запрос: HTTP {r1.status_code} | {r1.json()}")
    r2 = solve(TOKEN, answer_reuse)
    info(f"  2-й запрос: HTTP {r2.status_code} | {r2.json()}")
    if r2.ok:
        fail("Токен принят дважды — нет защиты от replay!")
    else:
        ok(f"Токен сгорел: {r2.json().get('error')}")

# ──────────────────────────────────────────────
# 11. Инъекции в поле answer
# ──────────────────────────────────────────────
sep(11, "Инъекции в поле answer")
if TOKEN:
    injections = [
        ("SQL",        "' OR '1'='1"),
        ("SQL2",       "'; DROP TABLE users;--"),
        ("XSS",        "<script>alert(1)</script>"),
        ("JSON break", '"},"ok":true,"x":"'),
        ("Null byte",  "Вторник\x00"),
        ("Very long",  "А" * 10000),
        ("Unicode",    "𝕍𝕥𝕠𝕣𝕟𝕚𝕜"),
        ("Newline",    "Вторник\nВторник"),
    ]
    for label, payload in injections:
        try:
            r = solve(TOKEN, payload)
            code = r.json().get("error", "OK" if r.ok else f"HTTP{r.status_code}")
            if r.ok:
                fail(f"[{label}] ПРИНЯТ! payload={repr(payload[:50])}")
            elif r.status_code == 500:
                fail(f"[{label}] → 500 Server Error — инъекция вызвала ошибку сервера!")
            else:
                ok(f"[{label}] → {code}")
        except Exception as e:
            fail(f"[{label}] → Exception: {e}")
        time.sleep(0.1)

# ──────────────────────────────────────────────
# 12. Несуществующий / мусорный токен
# ──────────────────────────────────────────────
sep(12, "Несуществующий / мусорный токен")
fake_tokens = [
    ("случайный",        "".join(random.choices(string.ascii_letters, k=24))),
    ("path traversal",   "../../../../etc/passwd"),
    ("пустой",           ""),
    ("null строка",      "null"),
    ("ноль",             "0"),
    ("очень длинный",    "A" * 500),
]
for label, ft in fake_tokens:
    r = challenge(ft)
    info(f"  [{label}] token={repr(ft[:30])} → HTTP {r.status_code} | {r.json().get('error','?')}")
    if r.ok:
        fail(f"Мусорный токен [{label}] принят!")

# ──────────────────────────────────────────────
# 13. HTTP method confusion на /solve
# ──────────────────────────────────────────────
sep(13, "HTTP method confusion на /api/captcha/solve")
for method in ["GET", "PUT", "PATCH", "DELETE"]:
    r = requests.request(method, f"{BASE}/api/captcha/solve", headers=HDR,
                         json={"token": TOKEN or "x", "answer": "x"})
    info(f"  {method} /api/captcha/solve → HTTP {r.status_code}")
    if r.status_code == 200:
        fail(f"Метод {method} принят на solve — не должен!")

# ──────────────────────────────────────────────
# 14. Content-Type bypass (form вместо JSON)
# ──────────────────────────────────────────────
sep(14, "Content-Type bypass — form-data вместо JSON")
if TOKEN:
    hdr_form = {**HDR, "Content-Type": "application/x-www-form-urlencoded"}
    r = requests.post(f"{BASE}/api/captcha/solve", headers=hdr_form,
                      data=f"token={TOKEN}&answer=Вторник")
    info(f"  form-data → HTTP {r.status_code} | {r.text[:150]}")
    if r.ok:
        fail("Form-data принята — Content-Type не проверяется!")

# ──────────────────────────────────────────────
# 15. Дублирующиеся поля в JSON
# ──────────────────────────────────────────────
sep(15, "Дублирующиеся поля JSON (parameter pollution)")
if TOKEN:
    raw_body = f'{{"token":"{TOKEN}","answer":"неверный","answer":"Вторник"}}'
    r = requests.post(f"{BASE}/api/captcha/solve", headers=HDR, data=raw_body)
    info(f"  Дубль answer → HTTP {r.status_code} | {r.json()}")
    if r.ok:
        fail("Второй answer перезаписал первый — parameter pollution работает!")
    else:
        ok(f"Защита от дублей есть: {r.json().get('error')}")

# ──────────────────────────────────────────────
# 16. Энтропия токенов (нужно 3+ токена)
# ──────────────────────────────────────────────
sep(16, "Предсказуемость токенов — энтропия")
info("  Для этого теста нужно 3 токена (запроси капчу 3 раза).")
tokens_enum = []
for i in range(3):
    t = input(f"  Токен {i+1} (Enter чтобы пропустить): ").strip()
    if t:
        tokens_enum.append(t)

if len(tokens_enum) >= 2:
    info("  Токены:")
    for t in tokens_enum:
        info(f"    {t}")
    lengths = set(len(t) for t in tokens_enum)
    info(f"  Длины токенов: {lengths}")
    common = sum(a == b for a, b in zip(tokens_enum[0], tokens_enum[-1]))
    info(f"  Совпадающих символов 1-го и последнего: {common}/{len(tokens_enum[0])}")
    if common > len(tokens_enum[0]) * 0.3:
        fail("Токены похожи — возможно предсказуемы!")
    else:
        ok("Токены не похожи — выглядит как случайные")
else:
    warn("Недостаточно токенов для сравнения — пропущено")

# ──────────────────────────────────────────────
# 17. Серверный таймер (ждём 3 минуты)
# ──────────────────────────────────────────────
sep(17, "Таймер на сервере: ждём 3 минуты и отвечаем")
do_timer = input("  Запустить? Нужен свежий токен, ждать 3 мин [y/N]: ").strip().lower()
if do_timer == "y":
    timer_token = input("  Вставь свежий токен: ").strip()
    info("  Ждём 180 секунд...")
    for i in range(18):
        time.sleep(10)
        print(f"  {(i+1)*10}с...", end="\r")
    print()
    r = solve(timer_token, "тест_после_таймаута")
    code = r.json().get("error", "OK" if r.ok else f"HTTP{r.status_code}")
    if code == "challenge_expired":
        ok("Сервер проверяет таймер — токен сгорел")
    elif code == "wrong_answer":
        fail("Таймер НЕ проверяется на сервере — запрос принят через 3 мин!")
    else:
        info(f"Ответ: {r.json()}")
else:
    warn("Тест таймера пропущен")

# ──────────────────────────────────────────────
# 18. Доступ к admin-эндпоинту
# ──────────────────────────────────────────────
sep(18, "Доступ к admin endpoint /api/tickets/draw")
r = requests.post(f"{BASE}/api/tickets/draw", headers=HDR,
                  json={"start_date": "2026-01-01T00:00", "end_date": "2026-04-23T23:59", "count": 1})
info(f"  HTTP {r.status_code} | {r.text[:200]}")
if r.ok:
    fail("Не-admin получил доступ к розыгрышу!")
elif r.status_code == 403:
    ok("Admin-эндпоинт закрыт для обычного юзера")
else:
    warn(f"Неожиданный статус: {r.status_code}")

# ──────────────────────────────────────────────
# 19. Истёкший auth_date
# ──────────────────────────────────────────────
sep(19, "Истёкший auth_date в initData (2020 год)")
old_init = INIT_DATA.replace("auth_date=1776952176", "auth_date=1580000000")
hdr_old = {"X-Telegram-Init-Data": old_init, "Content-Type": "application/json"}
r = requests.get(f"{BASE}/api/profile", headers=hdr_old)
if r.status_code in (401, 403):
    ok(f"Истёкший auth_date отклонён ({r.status_code}): {r.json()}")
else:
    fail(f"Старый auth_date принят! HTTP {r.status_code} — нет проверки времени initData!")

# ──────────────────────────────────────────────
# 20. Параллельный спам 20 запросов к challenge
# ──────────────────────────────────────────────
sep(20, "Параллельный спам 20 запросов к challenge")
if TOKEN:
    spam_results = []

    def spam_challenge():
        r = challenge(TOKEN)
        spam_results.append(r.status_code)

    threads = [threading.Thread(target=spam_challenge) for _ in range(20)]
    [t.start() for t in threads]
    [t.join()  for t in threads]

    c429 = spam_results.count(429)
    c200 = spam_results.count(200)
    info(f"  200: {c200}x | 429: {c429}x | остальные: {len(spam_results)-c200-c429}x")
    if c429 > 0:
        ok(f"Rate limit на challenge работает ({c429} из 20 заблокировано)")
    else:
        fail("Нет rate limit на challenge — можно спамить запросами")
else:
    warn("TOKEN пустой — тест 20 пропущен")

# ══════════════════════════════════════════════
# ИТОГОВАЯ ТАБЛИЦА
# ══════════════════════════════════════════════
print(f"\n{'═'*55}")
print("  ИТОГОВАЯ ТАБЛИЦА")
print('═'*55)
for icon, msg in results:
    print(f"  {icon} {msg}")
print()
