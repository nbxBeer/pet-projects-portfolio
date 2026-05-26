import argparse
import asyncio
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pixlands_probe as pp
from telethon import TelegramClient


DEFAULT_NOTIFY_CHAT = 777679631
DEFAULT_REF_CODE = "cxVQNPL"
REPORT_DIR = Path("pixlands_progression_reports")
DEF_K = 1500


class FatalAccountError(RuntimeError):
    pass


class BannedAccountError(FatalAccountError):
    pass


def ts() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def dump_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def compact(value: Any, limit: int = 700) -> str:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + "...<truncated>"


def is_ban_payload(status: int, payload: Any) -> bool:
    if status == 403:
        if isinstance(payload, dict):
            reason = str(payload.get("reason") or payload.get("error") or "").lower()
            return bool(payload.get("banned")) or "ban" in reason or "policy" in reason
        return True
    if isinstance(payload, dict):
        reason = str(payload.get("reason") or payload.get("error") or "").lower()
        return bool(payload.get("banned")) or "policy violation" in reason
    return False


def mob_gold(w: int) -> int:
    return round(50 + 30 * (w ** 1.10))


def mob_hp(w: int) -> int:
    if w < 1:
        return 40
    if w <= 60:
        return round(40 * (w ** 1.35))
    h60 = 40 * (60 ** 1.35)
    if w <= 120:
        return round(h60 * ((w / 60) ** 2.0))
    h120 = h60 * (2 ** 2.0)
    if w <= 200:
        return round(h120 * ((w / 120) ** 2.5))
    h200 = h120 * ((200 / 120) ** 2.5)
    if w <= 500:
        return round(h200 * ((w / 200) ** 2.8))
    h500 = h200 * ((500 / 200) ** 2.8)
    return round(h500 * ((w / 500) ** 3.8))


def mob_dmg(w: int) -> int:
    if w < 1:
        return 2
    if w <= 60:
        return max(1, round(2 + (w ** 1.22)))
    d60 = 2 + (60 ** 1.22)
    if w <= 120:
        return max(1, round(d60 * ((w / 60) ** 4.5)))
    d120 = d60 * (2 ** 4.5)
    if w <= 200:
        return max(1, round(d120 * ((w / 120) ** 4.5)))
    d200 = d120 * ((200 / 120) ** 4.5)
    if w <= 500:
        return max(1, round(d200 * ((w / 200) ** 4.7)))
    d500 = d200 * ((500 / 200) ** 4.7)
    return max(1, round(d500 * ((w / 500) ** 5.7)))


def mob_def(w: int) -> int:
    if w < 1:
        return 1
    if w <= 60:
        return max(1, round(1 + 0.3 * (w ** 1.15)))
    base60 = 1 + 0.3 * (60 ** 1.15)
    if w <= 120:
        return max(1, round(base60 * ((w / 60) ** 2.10)))
    base120 = base60 * (2 ** 2.10)
    return max(1, round(base120 * ((w / 120) ** 2.9)))


def mob_xp(w: int) -> int:
    return round(5 + 2 * w)


def kills_per_wave(w: int) -> int:
    return min(5 + ((w - 1) // 3), 25)


def is_boss_wave(w: int) -> bool:
    return w % 5 == 0


def boss_timer_s(w: int) -> float:
    return min(45 + w * 0.5, 180)


def boss_hp(w: int) -> int:
    return round(mob_hp(max(1, w - 1)) * 8 * 1.3)


def boss_dmg(w: int) -> int:
    return round(mob_dmg(max(1, w - 1)) * 3.0 * 1.3)


def boss_def(w: int) -> int:
    return mob_def(max(1, w - 1)) * 4


def indara_unlock_wave(difficulty: int) -> int:
    d = max(1, min(100, int(difficulty)))
    if d <= 1:
        return 31
    if d == 2:
        return 101
    if d == 3:
        return 151
    if d == 4:
        return 201
    return 201 + (d - 4) * 100


def skywind_unlock_wave(difficulty: int) -> int:
    d = max(1, min(50, int(difficulty)))
    return 51 if d <= 1 else 51 + (d - 1) * 100


def location_boss_stats(location: str, difficulty: int) -> dict[str, int]:
    if location == "skywind":
        w = skywind_unlock_wave(difficulty)
        base = location_boss_stats("indara", difficulty)
        return {"hp": boss_hp(w) * 7, "dmg": boss_dmg(w), "def": base["def"], "wave_equiv": w}
    w = indara_unlock_wave(difficulty)
    return {"hp": boss_hp(w), "dmg": boss_dmg(w), "def": boss_def(w), "wave_equiv": w}


def mitigate(raw: float, defense: float) -> int:
    return max(1, math.floor(max(0.0, raw) * DEF_K / (DEF_K + max(0.0, defense))))


def growth_cost(stat_id: str, level: int) -> int:
    if stat_id == "attack":
        return math.floor((50 + 5 * level) * ((1 + level / 200) ** 2.2))
    if stat_id == "hp":
        return math.floor((40 + 4 * level) * ((1 + level / 250) ** 2.2))
    if stat_id == "defense":
        return math.floor((45 + 4.5 * level) * ((1 + level / 180) ** 2.2))
    if stat_id == "critDmg":
        return math.floor((300 + 15 * level) * ((1 + level / 100) ** 2.2))
    return 10**12


@dataclass
class CheckResult:
    wave: int
    boss: bool
    ok: bool
    bottleneck: str
    hits: float
    expected_seconds: float
    hp_margin: float
    incoming_hit: int
    required_damage_8hit: int


@dataclass
class AuthContext:
    session_path: Path
    init_data: str
    auth: dict
    headers: dict
    user_id: int


class PixlandsProgressionRunner:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.report: dict[str, Any] = {
            "started_at": ts(),
            "session": str(args.session),
            "events": [],
        }
        self.ctx: AuthContext | None = None
        self._last_report_save = 0.0
        self._state_cache: dict | None = None
        self._state_cache_at = 0.0
        self._waves_since_load = 0
        self._last_daily_check = 0.0
        self._boss_state_cache: dict | None = None
        self._boss_state_cache_at = 0.0
        self._sky_state_cache: dict | None = None
        self._sky_state_cache_at = 0.0

    def log(self, message: str, *, important: bool = False, **extra: Any) -> None:
        line = f"[{ts()}] {message}"
        print(line, flush=True)
        event = {"at": ts(), "message": message}
        event.update({k: self.compact_log_value(k, v) for k, v in extra.items()})
        self.report["events"].append(event)
        if len(self.report["events"]) > self.args.max_report_events:
            self.report["events"] = self.report["events"][-self.args.max_report_events :]
        now = time.time()
        if important or now - self._last_report_save >= self.args.report_save_interval:
            self.save_report()

    def compact_log_value(self, key: str, value: Any) -> Any:
        if self.args.log_payloads:
            return value
        if isinstance(value, dict):
            keep = (
                "ok", "error", "reason", "status", "id", "token", "left", "day_idx", "retry_after",
                "retryAfterSec", "accepted", "kills", "coins", "gold", "gold_after", "farm",
                "season_coins", "level", "applied", "spent", "max_wave", "current_wave",
                "player_max_wave", "max_unlocked_tier", "difficulty", "location",
            )
            out = {k: value.get(k) for k in keep if k in value}
            stats = value.get("stats")
            if isinstance(stats, dict):
                out["stats"] = {
                    k: stats.get(k)
                    for k in (
                        "max_wave", "current_wave", "gold", "level", "xp",
                        "damage", "damage_eff", "health_max", "health_max_eff",
                        "defense", "defense_eff", "skill_coins", "season_coins",
                    )
                    if k in stats
                }
            attempts = value.get("attempts") or value.get("attempts_by_location")
            if isinstance(attempts, dict):
                out["attempts_keys"] = list(attempts.keys())[:8]
            if not out:
                out = {"keys": list(value.keys())[:12], "size": len(value)}
            return out
        if isinstance(value, list):
            return {"list_len": len(value)}
        if isinstance(value, str) and len(value) > 300:
            return value[:300] + "...<truncated>"
        return value

    def save_report(self) -> None:
        out_dir = Path(self.args.out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        name = Path(self.args.session).name.replace(".session", "")
        dump_json(out_dir / f"{name}-latest.json", self.report)
        self._last_report_save = time.time()

    async def notify(self, text: str) -> None:
        if not self.args.notify_chat:
            return
        try:
            async with TelegramClient(pp.compatible_session_path(str(self.args.session)), pp.API_ID, pp.API_HASH) as client:
                await client.send_message(int(self.args.notify_chat), text)
        except Exception as exc:
            self.log("notify failed", error=f"{type(exc).__name__}: {exc}")

    async def auth(self) -> AuthContext:
        session = Path(self.args.session)
        tg_attempt = 0
        auth_modes = [x.strip() for x in self.args.auth_modes.split(",") if x.strip()]
        while True:
            tg_attempt += 1
            last_exc: Exception | None = None
            try:
                for mode in auth_modes:
                    try:
                        webview_url = await pp.get_webview_url(
                            str(session),
                            self.args.platform,
                            mode,
                            self.args.short_name,
                            self.args.ref_code,
                        )
                        self.log("telegram webview ok", mode=mode, attempt=tg_attempt, important=True)
                        break
                    except Exception as exc:
                        last_exc = exc
                        self.log("telegram webview mode failed", mode=mode, attempt=tg_attempt, error=f"{type(exc).__name__}: {exc}")
                else:
                    raise last_exc or RuntimeError("all telegram webview modes failed")
                break
            except Exception as exc:
                wait_s = min(self.args.server_retry_max_sleep, 10 + tg_attempt * 10)
                self.log("telegram webview retry", attempt=tg_attempt, wait_s=wait_s, modes=auth_modes, error=f"{type(exc).__name__}: {exc}", important=True)
                time.sleep(wait_s)
        init_data = pp.extract_init_data(webview_url)
        if not init_data:
            raise FatalAccountError("no initData")
        auth_attempt = 0
        auth_path = "/api/auth/tg?init_data=" + pp.urllib.parse.quote(init_data, safe="")
        while True:
            auth_attempt += 1
            status, _, auth = pp.request(auth_path)
            if status not in (0, 500, 502, 503, 504, 521, 522, 523, 524):
                break
            wait_s = min(self.args.server_retry_max_sleep, 10 + auth_attempt * 10)
            self.log("auth endpoint unavailable, retrying", status=status, attempt=auth_attempt, wait_s=wait_s, payload=auth)
            time.sleep(wait_s)
        if is_ban_payload(status, auth):
            raise BannedAccountError(f"auth banned status={status} payload={compact(auth)}")
        if status != 200 or not isinstance(auth, dict) or not auth.get("id"):
            raise FatalAccountError(f"auth failed status={status} payload={compact(auth)}")
        headers = {
            "X-Telegram-Init-Data": init_data,
            "X-User-Id": auth["id"],
            "X-Session-Version": auth.get("session_version"),
        }
        ctx = AuthContext(session, init_data, auth, headers, int(auth["id"]))
        self.ctx = ctx
        self.report["auth"] = {"id": ctx.user_id, "username": auth.get("username"), "display_name": auth.get("display_name")}
        self.log(f"auth ok user_id={ctx.user_id} username={auth.get('username') or ''}", important=True)
        return ctx

    def api(self, method: str, path: str, body: dict | None = None, *, allow_error: bool = False) -> tuple[int, Any]:
        assert self.ctx is not None
        attempt = 0
        while True:
            attempt += 1
            status, _, payload = pp.request(path, method=method, headers=self.ctx.headers, body=body)
            if is_ban_payload(status, payload):
                raise BannedAccountError(f"banned status={status} path={path} payload={compact(payload)}")
            if status in (0, 500, 502, 503, 504, 521, 522, 523, 524):
                wait_s = min(self.args.server_retry_max_sleep, 10 + attempt * 10)
                self.log("server unavailable, retrying", method=method, path=path, status=status, attempt=attempt, wait_s=wait_s, payload=payload)
                time.sleep(wait_s)
                continue
            if status == 429:
                retry = 30
                if isinstance(payload, dict):
                    retry = float(payload.get("retry_after") or payload.get("retryAfterSec") or retry)
                self.log("rate limited, retrying", path=path, wait_s=retry, payload=payload)
                time.sleep(max(1.0, retry))
                continue
            if not allow_error and status >= 400:
                raise RuntimeError(f"api failed {method} {path}: status={status} payload={compact(payload)}")
            return status, payload

    def api_get(self, path: str, *, allow_error: bool = False) -> tuple[int, Any]:
        assert self.ctx is not None
        sep = "&" if "?" in path else "?"
        full = path if "user_id=" in path else f"{path}{sep}user_id={self.ctx.user_id}"
        return self.api("GET", full, None, allow_error=allow_error)

    def api_post(self, path: str, body: dict | None = None, *, allow_error: bool = False) -> tuple[int, Any]:
        assert self.ctx is not None
        payload = dict(body or {})
        payload.setdefault("user_id", self.ctx.user_id)
        return self.api("POST", path, payload, allow_error=allow_error)

    def load_state(self, cause: str, *, force: bool = False) -> dict:
        if (
            not force
            and self._state_cache is not None
            and time.time() - self._state_cache_at <= self.args.load_cache_sec
        ):
            return self._state_cache
        status, payload = self.api_get(f"/api/load?cause={cause}_{int(time.time())}")
        if status != 200 or not isinstance(payload, dict) or not isinstance(payload.get("stats"), dict):
            raise RuntimeError(f"load failed status={status} payload={compact(payload)}")
        self._state_cache = payload
        self._state_cache_at = time.time()
        self._waves_since_load = 0
        self.report["final"] = self.stats(payload)
        return payload

    def cache_state(self, state: dict) -> dict:
        self._state_cache = state
        self._state_cache_at = time.time()
        return state

    def stats(self, state: dict) -> dict:
        return state.get("stats") or {}

    def current_wave(self, state: dict) -> int:
        stats = self.stats(state)
        return max(1, int(stats.get("max_wave") or stats.get("current_wave") or 1))

    def effective_stats(self, state: dict) -> dict:
        s = self.stats(state)
        growth = state.get("growth") or {}
        talents = state.get("talents") or {}
        if isinstance(talents, list):
            talents = {t.get("talent_id"): t.get("level", 0) for t in talents if isinstance(t, dict)}

        dmg = float(s.get("damage_eff") or s.get("damage") or 10)
        defense = float(s.get("defense_eff") or s.get("defense") or 2)
        hp = float(s.get("health_max_eff") or s.get("health_max") or s.get("health") or 100)

        if not s.get("damage_eff"):
            dmg += int(growth.get("attack") or 0) + int(talents.get("t_attack") or 0) * 20
        if not s.get("defense_eff"):
            defense += int(growth.get("defense") or 0) * 3 + int(talents.get("t_defense") or 0) * 20
        if not s.get("health_max_eff"):
            hp += int(growth.get("hp") or 0) * 5 + int(talents.get("t_hp") or 0) * 100

        atk_spd = int(talents.get("t_atkspd") or 0) * 2
        regen = math.floor(hp * 0.004) + 1 + int(talents.get("t_hpregen") or 0) * 10 + int(s.get("hp_regen") or 0)
        attack_cd = 0.8 / (1 + atk_spd / 100)
        return {"damage": dmg, "defense": defense, "hp": hp, "atk_spd": atk_spd, "regen": regen, "attack_cd": attack_cd}

    def check_wave(self, state: dict) -> CheckResult:
        wave = self.current_wave(state)
        eff = self.effective_stats(state)
        if is_boss_wave(wave):
            enemy_hp = boss_hp(wave)
            enemy_def = boss_def(wave)
            enemy_dmg = boss_dmg(wave)
            hits_limit = max(1, boss_timer_s(wave) * 0.75 / eff["attack_cd"])
            boss = True
        else:
            enemy_hp = mob_hp(wave)
            enemy_def = mob_def(wave)
            enemy_dmg = mob_dmg(wave)
            hits_limit = self.args.max_hits_normal
            boss = False

        hit = mitigate(eff["damage"], enemy_def)
        hits = enemy_hp / max(1, hit)
        expected_seconds = hits * eff["attack_cd"]
        incoming = mitigate(enemy_dmg, eff["defense"])
        hp_margin = eff["hp"] / max(1, incoming)
        req_8 = math.ceil(math.ceil(enemy_hp / 8) * (DEF_K + enemy_def) / DEF_K)

        if boss:
            ok = expected_seconds <= boss_timer_s(wave) * 0.95 and hp_margin >= self.args.min_boss_hp_margin
        else:
            ok = hits <= hits_limit and hp_margin >= self.args.min_hp_margin

        if hits > hits_limit or (boss and expected_seconds > boss_timer_s(wave) * 0.95):
            bottleneck = "damage"
        elif hp_margin < (self.args.min_boss_hp_margin if boss else self.args.min_hp_margin):
            bottleneck = "survival"
        else:
            bottleneck = "none"

        return CheckResult(wave, boss, ok, bottleneck, hits, expected_seconds, hp_margin, incoming, req_8)

    def claim_completed_quests(self, state: dict) -> None:
        quests = state.get("quests") or []
        for q in quests:
            if not isinstance(q, dict):
                continue
            complete = bool(q.get("complete") or q.get("completed"))
            if not complete or q.get("claimed"):
                continue
            key = q.get("quest_key")
            if not key:
                continue
            status, payload = self.api_post("/api/quest/claim", {"quest_key": key}, allow_error=True)
            self.log("quest claim", quest_key=key, status=status, payload=payload)
            time.sleep(0.5)

    def upgrade_talent(self, talent_id: str, limit: int = 5) -> int:
        applied = 0
        for _ in range(limit):
            status, payload = self.api_post("/api/talents/upgrade", {"talent_id": talent_id}, allow_error=True)
            if isinstance(payload, dict) and payload.get("ok"):
                applied += 1
                self.log("talent upgraded", talent_id=talent_id, level=payload.get("level"), left=payload.get("talent_coins"))
                time.sleep(0.4)
                continue
            self.log("talent not upgraded", talent_id=talent_id, status=status, payload=payload)
            break
        return applied

    def upgrade_growth(self, stat_id: str, count: int) -> int:
        status, payload = self.api_post("/api/growth/upgrade", {"stat_id": stat_id, "count": count}, allow_error=True)
        if isinstance(payload, dict) and payload.get("ok"):
            applied = int(payload.get("applied") or 0)
            self.log("growth upgraded", stat_id=stat_id, applied=applied, level=payload.get("level"), spent=payload.get("spent"), gold=payload.get("gold"))
            return applied
        self.log("growth not upgraded", stat_id=stat_id, status=status, payload=payload)
        return 0

    def maybe_craft_and_equip(self, state: dict) -> None:
        if self.args.craft_mode == "off":
            self.log("craft skipped: craft_mode=off")
            return
        stats = self.stats(state)
        crystals = int(stats.get("item_crystal") or 0) + int(stats.get("item_crystal_bound") or 0)
        crafts = min(self.args.max_f_crafts_per_cycle, crystals // 3)
        for _ in range(crafts):
            status, payload = self.api_post("/api/craft/random-f", {}, allow_error=True)
            self.log("craft random F", status=status, payload=payload)
            if not (isinstance(payload, dict) and payload.get("ok")):
                break
            time.sleep(0.7)

        status, items = self.api_get("/api/items/list", allow_error=True)
        if status != 200 or not isinstance(items, dict):
            self.log("items list unavailable", status=status, payload=items)
            return
        arr = items.get("items") or items.get("data") or []
        if not isinstance(arr, list):
            return

        best_by_slot: dict[str, tuple[float, dict]] = {}
        for item in arr:
            if not isinstance(item, dict):
                continue
            slot = item.get("slot") or item.get("equip_slot")
            if not slot:
                continue
            score = self.item_score(item)
            if slot not in best_by_slot or score > best_by_slot[slot][0]:
                best_by_slot[slot] = (score, item)

        for slot, (_, item) in best_by_slot.items():
            if item.get("equipped"):
                continue
            item_id = item.get("id") or item.get("itemId") or item.get("item_id")
            if not item_id:
                continue
            status, payload = self.api_post("/api/items/equip", {"itemId": item_id}, allow_error=True)
            self.log("equip best item", slot=slot, item_id=item_id, status=status, payload=payload)
            time.sleep(0.4)

    def item_score(self, item: dict) -> float:
        raw = json.dumps(item, ensure_ascii=False).lower()
        score = 0.0
        for key, weight in (
            ("final_dmg", 5000), ("dmg_vs_boss", 2500), ("atk_spd", 1800),
            ("atk_pct", 1300), ("def_pct", 1000), ("hp_pct", 1000),
            ("atk", 4), ("def", 2), ("hp", 0.4), ("lifesteal", 800), ("damp", 900),
        ):
            val = self.find_number(item, key)
            score += val * weight
        tier = str(item.get("tier_name") or item.get("tier") or "")
        score += {"F": 1, "F+": 2, "D": 3, "D+": 4, "C": 5, "C+": 6, "B": 7, "B+": 8, "A": 9, "A+": 10, "S": 11, "S+": 12}.get(tier, 0) * 100
        if "weapon" in raw:
            score *= 1.15
        return score

    def find_number(self, value: Any, key: str) -> float:
        if isinstance(value, dict):
            total = 0.0
            for k, v in value.items():
                if k == key and isinstance(v, (int, float)):
                    total += float(v)
                else:
                    total += self.find_number(v, key)
            return total
        if isinstance(value, list):
            return sum(self.find_number(x, key) for x in value)
        return 0.0

    def _growth_best_effort(self, stat_id: str) -> bool:
        if self.upgrade_growth(stat_id, self.args.growth_batch) > 0:
            return True
        return self.args.growth_batch > 1 and self.upgrade_growth(stat_id, 1) > 0

    def spend_for_bottleneck(self, state: dict, bottleneck: str) -> bool:
        before = self.effective_stats(state)
        self.upgrade_wings_if_possible()
        self.spend_skill_resources(state, bottleneck)
        if bottleneck == "damage":
            if self.upgrade_talent("t_attack", 10):
                return True
            if self.upgrade_talent("t_atkspd", 3):
                return True
            self.buy_talent_coins_if_useful()
            if self._growth_best_effort("attack"):
                return True
        elif bottleneck == "survival":
            if self.upgrade_talent("t_hp", 5):
                return True
            if self.upgrade_talent("t_defense", 5):
                return True
            if self.upgrade_talent("t_hpregen", 5):
                return True
            self.buy_talent_coins_if_useful()
            if self._growth_best_effort("hp"):
                return True
            if self._growth_best_effort("defense"):
                return True

        self.maybe_craft_and_equip(state)
        after_state = self.load_state("after_spend_attempt", force=True)
        after = self.effective_stats(after_state)
        changed = after != before
        if changed:
            self.log("equipment/craft changed effective stats", before=before, after=after)
        return changed

    def upgrade_wings_if_possible(self) -> bool:
        if self.args.wings_upgrade_mode == "off":
            self.log("wings upgrade skipped: wings_upgrade_mode=off")
            return False
        status, state = self.api_get("/api/wings/state", allow_error=True)
        if status != 200 or not isinstance(state, dict) or not state.get("ok"):
            return False
        changed = False
        feathers = int(state.get("sky_feather") or 0)
        if feathers > 0:
            status, payload = self.api_post("/api/wings/deposit-feather", {"amount": feathers}, allow_error=True)
            ok = isinstance(payload, dict) and payload.get("ok")
            self.log("wings deposit feather", amount=feathers, status=status, ok=ok, payload=payload)
            changed = changed or bool(ok)
            if ok and isinstance(payload.get("state"), dict):
                state = payload["state"]
        # If the bar/rank is ready and the account has plume, server will accept.
        for _ in range(3):
            status, payload = self.api_post("/api/wings/breakthrough", {}, allow_error=True)
            ok = isinstance(payload, dict) and payload.get("ok")
            self.log("wings breakthrough", status=status, ok=ok, payload=payload)
            if not ok:
                break
            changed = True
            time.sleep(0.5)
        return changed

    def buy_talent_coins_if_useful(self) -> bool:
        status, payload = self.api_post("/api/talents/buy-step", {}, allow_error=True)
        ok = isinstance(payload, dict) and payload.get("ok")
        self.log("talent coin buy-step", status=status, ok=ok, payload=payload)
        return bool(ok)

    def spend_skill_resources(self, state: dict, bottleneck: str) -> None:
        stats = self.stats(state)
        if int(stats.get("skill_coins") or 0) <= 0:
            return
        if bottleneck == "survival":
            order = ["aura_iron", "stone_skin", "frost", "curse_wave", "splash"]
        else:
            order = ["splash", "aura_battle", "aura_wrath", "berserker", "lightning", "whirlwind", "charge", "meteor", "vortex"]

        for skill_id in order[: self.args.max_skill_upgrades_per_cycle]:
            status, payload = self.api_post("/api/skills/upgrade", {"skill_id": skill_id}, allow_error=True)
            ok = isinstance(payload, dict) and payload.get("ok")
            self.log("skill upgrade", skill_id=skill_id, status=status, ok=ok, payload=payload)
            if ok:
                time.sleep(0.4)

        # Merge/equip are opportunistic. If the skill is not owned or not enough cards, server rejects.
        for skill_id in order[:3]:
            status, payload = self.api_post("/api/skills/merge", {"skill_id": skill_id}, allow_error=True)
            ok = isinstance(payload, dict) and payload.get("ok")
            self.log("skill merge", skill_id=skill_id, status=status, ok=ok, payload=payload)
            time.sleep(0.25)

        status, payload = self.api_post("/api/skills/buy-slot", {}, allow_error=True)
        self.log("skill slot buy", status=status, ok=isinstance(payload, dict) and payload.get("ok"), payload=payload)

    def claim_ad_once(self, reason: str) -> bool:
        assert self.ctx is not None
        body = {"type": "farm", "userId": self.ctx.user_id, "reason": reason}
        status, payload = self.api_post("/api/ad/claim", body, allow_error=True)
        ok = isinstance(payload, dict) and payload.get("ok")
        self.log("ad claim", reason=reason, status=status, ok=ok, payload=payload)
        return bool(ok)

    def economy_cycle(self) -> dict:
        state = self.load_state("economy_start", force=True)
        self.run_daily_activities_if_due(state, force_if_urgent=True)
        # Always check and spend first — daily activities may have added resources.
        check = self.check_wave(state)
        self.log_check(check, state)
        if self.spend_for_bottleneck(state, check.bottleneck):
            return self.load_state("after_daily_spend", force=True)
        for idx in range(1, self.args.ads_before_afk + 1):
            if self.claim_ad_once(f"progression_block_{idx}"):
                state = self.load_state(f"after_ad_{idx}", force=True)
                check = self.check_wave(state)
                self.log_check(check, state)
                if self.spend_for_bottleneck(state, check.bottleneck):
                    return self.load_state("after_ad_spend", force=True)
            else:
                break

        self.run_afk_window()
        state = self.load_state("after_afk", force=True)
        self.run_daily_activities_if_due(state, force_if_urgent=True)

        for idx in range(1, self.args.ads_after_afk + 1):
            check = self.check_wave(state)
            self.log_check(check, state)
            if self.spend_for_bottleneck(state, check.bottleneck):
                return self.load_state("after_afk_spend", force=True)
            if not self.claim_ad_once(f"progression_after_afk_{idx}"):
                break
            state = self.load_state(f"after_afk_ad_{idx}", force=True)

        return state

    def reset_seconds_from_attempts(self, attempts: dict) -> int | None:
        day_idx = attempts.get("day_idx") if isinstance(attempts, dict) else None
        if not isinstance(day_idx, int):
            return None
        next_reset = (day_idx + 1) * 86400
        return max(0, int(next_reset - time.time()))

    def boss_state(self, *, force: bool = False) -> dict:
        if (
            not force
            and self._boss_state_cache is not None
            and time.time() - self._boss_state_cache_at <= self.args.boss_state_cache_sec
        ):
            return self._boss_state_cache
        status, payload = self.api_get("/api/boss/state", allow_error=True)
        if status == 200 and isinstance(payload, dict):
            self._boss_state_cache = payload
            self._boss_state_cache_at = time.time()
            return payload
        self.log("boss state unavailable", status=status, payload=payload)
        return {}

    def attempts_for_location(self, boss_state: dict, location: str) -> dict:
        return ((boss_state.get("attempts_by_location") or {}).get(location) or boss_state.get("attempts") or {})

    def estimate_boss(self, state: dict, location: str, difficulty: int) -> dict:
        eff = self.effective_stats(state)
        bs = location_boss_stats(location, difficulty)
        base_hit = mitigate(eff["damage"], bs["def"])
        crit_chance = min(0.75, float((self.stats(state).get("crit_chance_eff") or self.stats(state).get("crit_chance") or 0.1)))
        crit_mul = 2.0
        avg_hit = base_hit * (1 + crit_chance * (crit_mul - 1))
        # Boss arena uses 480ms base cooldown, then attack-speed bonuses. Skills add conservative extra DPS.
        boss_attack_cd = 0.48 / (1 + eff["atk_spd"] / 100)
        skill_mul = self.args.boss_skill_dps_multiplier
        dps = max(1.0, avg_hit / boss_attack_cd * skill_mul)
        time_to_kill = bs["hp"] / dps

        swing_avg = 1.25 if location == "indara" else 1.375
        incoming = mitigate(bs["dmg"] * swing_avg, eff["defense"])
        hp_margin = eff["hp"] / max(1, incoming)
        ok = time_to_kill <= self.args.boss_time_limit * self.args.boss_time_safety and hp_margin >= self.args.min_boss_hp_margin
        return {
            "location": location,
            "difficulty": difficulty,
            "ok": ok,
            "boss": bs,
            "dps": round(dps, 2),
            "time_to_kill": round(time_to_kill, 1),
            "incoming_hit_avg": incoming,
            "hp_margin": round(hp_margin, 2),
        }

    def select_boss_difficulty(self, state: dict, boss_state: dict, location: str) -> dict | None:
        locs = boss_state.get("locations") or []
        loc = next((x for x in locs if isinstance(x, dict) and x.get("key") == location), None)
        if not loc:
            return None
        attempts = self.attempts_for_location(boss_state, location)
        if int(attempts.get("left") or 0) <= 0:
            self.log("boss no attempts", location=location, attempts=attempts)
            return None

        max_diff = int(loc.get("max_difficulty") or (50 if location == "skywind" else 100))
        unlocked = min(max_diff, int(loc.get("player_max_unlocked") or 1))
        min_waves = loc.get("min_wave_per_difficulty") or []
        player_wave = int(boss_state.get("player_max_wave") or self.current_wave(state))

        best_ok = None
        best_seen = None
        for difficulty in range(1, unlocked + 1):
            if difficulty - 1 < len(min_waves) and player_wave < int(min_waves[difficulty - 1] or 0):
                continue
            est = self.estimate_boss(state, location, difficulty)
            best_seen = est
            if est["ok"]:
                best_ok = est
        if best_ok:
            return best_ok
        if best_seen:
            self.log("no beatable boss difficulty", location=location, best_seen=best_seen)
        return None

    def run_one_boss(self, location: str, difficulty: int, estimate: dict) -> bool:
        status, started = self.api_post("/api/boss/start", {"location": location, "difficulty": difficulty, "drop_mult": 1}, allow_error=True)
        self.log("boss start", location=location, difficulty=difficulty, estimate=estimate, status=status, payload=started)
        if not (isinstance(started, dict) and started.get("ok") and started.get("token")):
            return False
        token = started["token"]
        self.api_post("/api/boss/combat-started", {"token": token}, allow_error=True)
        wait_s = min(self.args.boss_time_limit, max(self.args.min_boss_sleep, float(estimate.get("time_to_kill") or 1) * self.args.boss_result_sleep_factor))
        self.log("boss combat wait", location=location, difficulty=difficulty, wait_s=round(wait_s, 1))
        time.sleep(wait_s)
        status, result = self.api_post("/api/boss/result", {"token": token, "victory": True}, allow_error=True)
        self.log("boss result", location=location, difficulty=difficulty, status=status, payload=result)
        ok = isinstance(result, dict) and result.get("ok") is True
        if ok and self.args.boss_between_sleep > 0:
            self.log("boss between-attempt wait", wait_s=self.args.boss_between_sleep)
            time.sleep(self.args.boss_between_sleep)
        return ok

    def run_bosses_if_due(self, state: dict, force: bool = False) -> None:
        if self.args.boss_mode == "off":
            return
        boss_state = self.boss_state(force=force)
        if not boss_state.get("ok"):
            return
        for location in self.args.boss_locations.split(","):
            location = location.strip()
            if not location:
                continue
            attempts = self.attempts_for_location(boss_state, location)
            reset_left = self.reset_seconds_from_attempts(attempts)
            urgent = reset_left is not None and reset_left <= self.args.boss_reset_urgency_sec
            if not (force or urgent or self.current_wave(state) >= self.args.target_wave):
                self.log("boss deferred", location=location, attempts=attempts, reset_left=reset_left)
                continue
            while int(attempts.get("left") or 0) > 0:
                choice = self.select_boss_difficulty(state, boss_state, location)
                if not choice:
                    break
                if not self.run_one_boss(location, int(choice["difficulty"]), choice):
                    break
                time.sleep(1.0)
                boss_state = self.boss_state(force=True)
                attempts = self.attempts_for_location(boss_state, location)

    def sky_state(self, *, force: bool = False) -> dict:
        if (
            not force
            and self._sky_state_cache is not None
            and time.time() - self._sky_state_cache_at <= self.args.sky_state_cache_sec
        ):
            return self._sky_state_cache
        status, payload = self.api_get("/api/skySea/state", allow_error=True)
        if status == 200 and isinstance(payload, dict):
            self._sky_state_cache = payload
            self._sky_state_cache_at = time.time()
            return payload
        self.log("skySea state unavailable", status=status, payload=payload)
        return {}

    def run_sky_sea_if_due(self, force: bool = False) -> None:
        if self.args.sky_mode == "off":
            return
        state = self.sky_state(force=force)
        if not state.get("ok"):
            return
        attempts = state.get("attempts") or {}
        reset_left = self.reset_seconds_from_attempts(attempts)
        urgent = reset_left is not None and reset_left <= self.args.boss_reset_urgency_sec
        if not (force or urgent):
            self.log("skySea deferred", attempts=attempts, reset_left=reset_left, max_unlocked_tier=state.get("max_unlocked_tier"))
            return
        if int(attempts.get("left") or 0) <= 0:
            self.log("skySea no attempts", attempts=attempts)
            return
        tiers = [t for t in (state.get("tiers") or []) if isinstance(t, dict) and t.get("unlocked")]
        active = state.get("active_run")
        if active and active.get("token"):
            token = active["token"]
            tier = int(active.get("tier") or state.get("max_unlocked_tier") or 1)
        else:
            if not tiers:
                self.log("skySea no unlocked tier", state=state)
                return
            tier = max(int(t.get("tier") or 1) for t in tiers)
            status, started = self.api_post("/api/skySea/start", {"tier": tier, "drop_mult": 1}, allow_error=True)
            self.log("skySea start", tier=tier, status=status, payload=started)
            if not (isinstance(started, dict) and started.get("ok") and started.get("token")):
                return
            token = started["token"]
        # Pace kills so total submission time >= sky_min_run_seconds to avoid 429.
        effective_batch_sleep = max(
            self.args.sky_batch_sleep,
            self.args.sky_min_run_seconds * self.args.sky_batch_size / max(1, self.args.sky_kills),
        )
        run_started = time.time()
        done = 0
        while done < self.args.sky_kills:
            n = min(self.args.sky_batch_size, self.args.sky_kills - done)
            status, payload = self.api_post("/api/skySea/kills-batch", {"token": token, "n": n}, allow_error=True)
            self.log("skySea kills", tier=tier, n=n, status=status, payload=payload)
            if isinstance(payload, dict) and payload.get("ok"):
                done += int(payload.get("accepted") or n)
                time.sleep(effective_batch_sleep)
                continue
            if isinstance(payload, dict) and payload.get("error") in ("time_up", "kill_cap_reached"):
                break
            break
        elapsed = time.time() - run_started
        if elapsed < self.args.sky_min_run_seconds:
            wait_s = self.args.sky_min_run_seconds - elapsed
            self.log("skySea full-run wait before end", elapsed=round(elapsed, 1), wait_s=round(wait_s, 1))
            time.sleep(wait_s)
        status, ended = self.api_post("/api/skySea/end", {"token": token}, allow_error=True)
        self.log("skySea end", tier=tier, kills=done, status=status, payload=ended)

    def run_daily_activities_if_due(self, state: dict, force_if_urgent: bool = False) -> None:
        force = force_if_urgent and self.args.force_daily_when_blocked
        now = time.time()
        if not force and now - self._last_daily_check < self.args.daily_check_interval:
            return
        self._last_daily_check = now
        self.run_bosses_if_due(state, force=force)
        self.run_sky_sea_if_due(force=force)

    def run_afk_window(self) -> None:
        self.log("AFK window started", seconds=self.args.afk_seconds)
        remaining = self.args.afk_seconds
        while remaining > 0:
            step = min(remaining, self.args.afk_log_interval)
            time.sleep(step)
            remaining -= step
            self.log("AFK wait", remaining_seconds=remaining)

        status, checked = self.api_get("/api/afk/check", allow_error=True)
        self.log("AFK check", status=status, payload=checked)
        if not (isinstance(checked, dict) and checked.get("afk")):
            return

        claim_payloads = [
            {"multiplier": 2, "double": True, "ad": True},
            {"multiplier": 2},
            {"multiplier": 1},
        ]
        for body in claim_payloads:
            status, payload = self.api_post("/api/afk/claim", body, allow_error=True)
            self.log("AFK claim", status=status, body=body, payload=payload)
            if isinstance(payload, dict) and payload.get("ok"):
                return

    def log_check(self, check: CheckResult, state: dict | None = None) -> None:
        extra: dict = {}
        if state is not None:
            s = self.stats(state)
            eff = self.effective_stats(state)
            extra = {
                "gold": int(s.get("gold") or 0),
                "level": int(s.get("level") or 0),
                "atk": int(eff["damage"]),
                "hp": int(eff["hp"]),
                "defense": int(eff["defense"]),
            }
        self.log(
            "wave check",
            wave=check.wave,
            boss=check.boss,
            ok=check.ok,
            bottleneck=check.bottleneck,
            hits=round(check.hits, 2),
            expected_seconds=round(check.expected_seconds, 1),
            hp_margin=round(check.hp_margin, 2),
            incoming_hit=check.incoming_hit,
            required_damage_8hit=check.required_damage_8hit,
            **extra,
        )

    def apply_lightweight_progress(self, state: dict, next_wave: int, coin_payloads: list[Any]) -> dict:
        stats = state.setdefault("stats", {})
        old_wave = int(stats.get("max_wave") or stats.get("current_wave") or 1)
        stats["max_wave"] = max(old_wave, next_wave)
        stats["current_wave"] = next_wave
        for payload in coin_payloads:
            if not isinstance(payload, dict):
                continue
            if isinstance(payload.get("gold_after"), (int, float)):
                stats["gold"] = payload["gold_after"]
            elif isinstance(payload.get("gold"), (int, float)):
                stats["gold"] = payload["gold"]
            for key in ("season_coins", "farm"):
                if isinstance(payload.get(key), (int, float)):
                    stats[key] = payload[key]
            if isinstance(payload.get("coins"), (int, float)) and "season_coins" in stats:
                stats["season_coins"] = int(stats.get("season_coins") or 0) + int(payload["coins"])
        return self.cache_state(state)

    def play_current_wave(self, state: dict, check: CheckResult) -> dict:
        wave = check.wave
        kills = 1 if check.boss else kills_per_wave(wave)
        sleep_s = max(kills * max(1.0, min(check.hits, self.args.max_hits_for_time)) * 0.8, check.expected_seconds)
        sleep_s *= self.args.time_scale
        self.log("playing wave", wave=wave, boss=check.boss, kills=kills, sleep_seconds=round(sleep_s, 1))
        if sleep_s > 0:
            time.sleep(sleep_s)

        coin_payloads: list[Any] = []
        if check.boss:
            status, payload = self.api_post("/api/season/coin-drop", {"kills": 1, "is_boss": True, "boost_active": False}, allow_error=True)
            self.log("boss coin drop", wave=wave, status=status, payload=payload)
            coin_payloads.append(payload)
        else:
            left = kills
            while left > 0:
                n = min(30, left)
                status, payload = self.api_post("/api/season/coin-drop", {"kills": n, "is_boss": False, "boost_active": False}, allow_error=True)
                self.log("coin drop", wave=wave, kills=n, status=status, payload=payload)
                coin_payloads.append(payload)
                left -= n
                time.sleep(0.5)

        next_wave = wave + 1
        status, payload = self.api_post("/api/arena/wave-cleared", {"wave": next_wave}, allow_error=True)
        self.log("wave clear submit", wave=next_wave, status=status, payload=payload)
        if isinstance(payload, dict) and payload.get("error") == "wave_too_fast":
            wait_s = float(payload.get("retryAfterSec") or 2.0) + 0.5
            self.log("wave clear too fast, waiting", wait_s=wait_s)
            time.sleep(wait_s)
            status, payload = self.api_post("/api/arena/wave-cleared", {"wave": next_wave}, allow_error=True)
            self.log("wave clear retry", wave=next_wave, status=status, payload=payload)
        if status >= 400 or not isinstance(payload, dict) or payload.get("error"):
            return self.load_state(f"after_wave_{next_wave}_error", force=True)
        self._waves_since_load += 1
        if self._waves_since_load >= self.args.load_every_waves:
            return self.load_state(f"after_wave_{next_wave}", force=True)
        return self.apply_lightweight_progress(state, next_wave, coin_payloads)

    async def run(self) -> None:
        try:
            await self.auth()
            state = self.load_state("progression_start", force=True)
            self.claim_completed_quests(state)
            self.run_daily_activities_if_due(state)
            while self.current_wave(state) < self.args.target_wave:
                check = self.check_wave(state)
                self.log_check(check, state)
                if check.ok:
                    state = self.play_current_wave(state, check)
                    self.claim_completed_quests(state)
                    self.run_daily_activities_if_due(state)
                    continue

                changed = self.spend_for_bottleneck(state, check.bottleneck)
                state = self.load_state("after_spend", force=True)
                if changed:
                    continue

                state = self.economy_cycle()

            self.report["finished_at"] = ts()
            self.report["final"] = self.stats(state)
            self.run_daily_activities_if_due(state, force_if_urgent=True)
            self.log("target reached", target_wave=self.args.target_wave, current_wave=self.current_wave(state), important=True)
        except BannedAccountError as exc:
            self.report["fatal"] = {"type": "banned", "message": str(exc), "session_stopped": True}
            self.log("account banned", important=True, error=str(exc))
            await self.notify(f"Pixlands: account banned\nsession={self.args.session}\n{exc}")
        except FatalAccountError as exc:
            self.report["fatal"] = {"type": "account", "message": str(exc)}
            self.log("account fatal error", important=True, error=str(exc))
        except KeyboardInterrupt:
            self.report["stopped_at"] = ts()
            self.log("stopped by keyboard", important=True)
        finally:
            self.save_report()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Pixlands UI-less normal progression runner.")
    parser.add_argument("--session", default=str(Path("pixsessions") / "1.session"))
    parser.add_argument("--platform", default="android")
    parser.add_argument("--mode", choices=["app", "url"], default="app")
    parser.add_argument("--auth-modes", default="app,url", help="Comma-separated Telegram WebView methods to try before retrying.")
    parser.add_argument("--short-name", default="pixlands")
    parser.add_argument("--ref-code", default=DEFAULT_REF_CODE)
    parser.add_argument("--target-wave", type=int, default=200)
    parser.add_argument("--notify-chat", type=int, default=DEFAULT_NOTIFY_CHAT)
    parser.add_argument("--out-dir", default=str(REPORT_DIR))
    parser.add_argument("--report-save-interval", type=float, default=60.0)
    parser.add_argument("--max-report-events", type=int, default=200)
    parser.add_argument("--log-payloads", action="store_true", help="Store full API payloads in report; disabled by default to save disk/RAM.")
    parser.add_argument("--load-cache-sec", type=float, default=10.0)
    parser.add_argument("--load-every-waves", type=int, default=5)
    parser.add_argument("--daily-check-interval", type=float, default=30 * 60)
    parser.add_argument("--boss-state-cache-sec", type=float, default=30 * 60)
    parser.add_argument("--sky-state-cache-sec", type=float, default=30 * 60)
    parser.add_argument("--max-hits-normal", type=float, default=8.0)
    parser.add_argument("--max-hits-for-time", type=float, default=8.0)
    parser.add_argument("--min-hp-margin", type=float, default=12.0)
    parser.add_argument("--min-boss-hp-margin", type=float, default=8.0)
    parser.add_argument("--growth-batch", type=int, default=25)
    parser.add_argument("--max-skill-upgrades-per-cycle", type=int, default=4)
    parser.add_argument("--craft-mode", choices=["off", "safe"], default="off")
    parser.add_argument("--max-f-crafts-per-cycle", type=int, default=0)
    parser.add_argument("--wings-upgrade-mode", choices=["off", "safe"], default="off")
    parser.add_argument("--ads-before-afk", type=int, default=2)
    parser.add_argument("--ads-after-afk", type=int, default=2)
    parser.add_argument("--afk-seconds", type=int, default=3 * 3600)
    parser.add_argument("--afk-log-interval", type=int, default=15 * 60)
    parser.add_argument("--server-retry-max-sleep", type=int, default=300)
    parser.add_argument("--time-scale", type=float, default=1.0, help="1.0 = real minimum wave time; use lower only for local dry tests.")
    parser.add_argument("--boss-mode", choices=["off", "auto"], default="auto")
    parser.add_argument("--boss-locations", default="indara,skywind")
    parser.add_argument("--boss-reset-urgency-sec", type=int, default=3600)
    parser.add_argument("--boss-time-limit", type=float, default=90.0)
    parser.add_argument("--boss-time-safety", type=float, default=0.85)
    parser.add_argument("--boss-skill-dps-multiplier", type=float, default=1.15)
    parser.add_argument("--min-boss-sleep", type=float, default=35.0)
    parser.add_argument("--boss-between-sleep", type=float, default=10.0)
    parser.add_argument("--boss-result-sleep-factor", type=float, default=1.08)
    parser.add_argument("--force-daily-when-blocked", action="store_true", default=True)
    parser.add_argument("--sky-mode", choices=["off", "auto"], default="auto")
    parser.add_argument("--sky-kills", type=int, default=600)
    parser.add_argument("--sky-batch-size", type=int, default=25)
    parser.add_argument("--sky-batch-sleep", type=float, default=0.3)
    parser.add_argument("--sky-min-run-seconds", type=float, default=180.0)
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(PixlandsProgressionRunner(parse_args()).run())
