import aiosqlite
import json
import os
import random
from datetime import datetime
from typing import Optional

DB_PATH = os.environ.get("DB_PATH", "data/fishbot.db")


class Database:
    def __init__(self):
        self._conn: Optional[aiosqlite.Connection] = None

    async def init(self):
        import os
        os.makedirs("data", exist_ok=True)
        self._conn = await aiosqlite.connect(DB_PATH)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._create_tables()

    async def _create_tables(self):
        await self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                session_string TEXT NOT NULL,
                chat TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT 'фиш',
                interval_minutes INTEGER NOT NULL DEFAULT 10,
                jitter_minutes INTEGER NOT NULL DEFAULT 2,
                sleep_start TEXT NOT NULL DEFAULT '00:00',
                sleep_end TEXT NOT NULL DEFAULT '00:00',
                timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
                enabled INTEGER NOT NULL DEFAULT 1,
                tg_name TEXT,
                tg_id INTEGER,
                created_at TEXT DEFAULT (datetime('now')),
                next_send_at TEXT,
                captcha_bot TEXT NOT NULL DEFAULT '',
                setup_status TEXT NOT NULL DEFAULT 'working',
                chat_id INTEGER,
                chat_status TEXT NOT NULL DEFAULT 'joined',
                chat_error TEXT NOT NULL DEFAULT '',
                secondary_chat_id INTEGER,
                secondary_chat TEXT NOT NULL DEFAULT '',
                secondary_chat_status TEXT NOT NULL DEFAULT '',
                secondary_chat_error TEXT NOT NULL DEFAULT '',
                secondary_chat_available_at TEXT,
                secondary_chat_manual INTEGER NOT NULL DEFAULT 0,
                assigned_photo TEXT NOT NULL DEFAULT '',
                assigned_bio TEXT NOT NULL DEFAULT '',
                assigned_birthday TEXT NOT NULL DEFAULT '',
                init_data TEXT NOT NULL DEFAULT '',
                dynamite_last_used TEXT,
                net_last_used TEXT,
                net_fast_uses INTEGER NOT NULL DEFAULT 0,
                fish_cast_count INTEGER NOT NULL DEFAULT 0,
                current_location TEXT NOT NULL DEFAULT 'Городской пруд',
                external_dm_sha_sent INTEGER NOT NULL DEFAULT 0,
                suppress_problem_notifications INTEGER NOT NULL DEFAULT 0,
                forest_enabled INTEGER NOT NULL DEFAULT 1,
                forest_chat_status TEXT NOT NULL DEFAULT 'queued',
                forest_chat_error TEXT NOT NULL DEFAULT '',
                forest_available_at TEXT,
                forest_next_fish_at TEXT,
                forest_net_last_used TEXT,
                forest_next_net_at TEXT,
                forest_fish_count INTEGER NOT NULL DEFAULT 0,
                forest_net_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                account_name TEXT,
                event TEXT NOT NULL,
                details TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS proxies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server TEXT NOT NULL,
                port INTEGER NOT NULL,
                secret TEXT NOT NULL,
                source_url TEXT NOT NULL DEFAULT '',
                added_at TEXT DEFAULT (datetime('now')),
                last_used_at TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                fail_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NOT NULL DEFAULT '',
                UNIQUE(server, port, secret)
            );

            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                link TEXT NOT NULL,
                account_limit INTEGER NOT NULL DEFAULT 1,
                join_interval_minutes INTEGER NOT NULL DEFAULT 10,
                avoid_as_secondary INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS external_dm_replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                sender_id INTEGER NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(account_id, sender_id)
            );

            CREATE TABLE IF NOT EXISTS asset_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_type TEXT NOT NULL,
                asset_value TEXT NOT NULL,
                account_id INTEGER,
                used_at TEXT DEFAULT (datetime('now')),
                UNIQUE(asset_type, asset_value, account_id)
            );
        """)
        await self._conn.commit()
        await self._migrate()

    async def _migrate(self):
        for col, definition in [
            ("captcha_bot",        "TEXT NOT NULL DEFAULT ''"),
            ("setup_status",       "TEXT NOT NULL DEFAULT 'working'"),
            ("chat_id",            "INTEGER"),
            ("chat_status",        "TEXT NOT NULL DEFAULT 'joined'"),
            ("chat_error",         "TEXT NOT NULL DEFAULT ''"),
            ("secondary_chat_id",   "INTEGER"),
            ("secondary_chat",      "TEXT NOT NULL DEFAULT ''"),
            ("secondary_chat_status", "TEXT NOT NULL DEFAULT ''"),
            ("secondary_chat_error", "TEXT NOT NULL DEFAULT ''"),
            ("secondary_chat_available_at", "TEXT"),
            ("secondary_chat_manual", "INTEGER NOT NULL DEFAULT 0"),
            ("assigned_photo",     "TEXT NOT NULL DEFAULT ''"),
            ("assigned_bio",       "TEXT NOT NULL DEFAULT ''"),
            ("assigned_birthday",  "TEXT NOT NULL DEFAULT ''"),
            ("init_data",          "TEXT NOT NULL DEFAULT ''"),
            ("dynamite_last_used", "TEXT"),
            ("net_last_used",      "TEXT"),
            ("net_fast_uses",      "INTEGER NOT NULL DEFAULT 0"),
            ("fish_cast_count",    "INTEGER NOT NULL DEFAULT 0"),
            ("current_location",   "TEXT NOT NULL DEFAULT 'Городской пруд'"),
            ("external_dm_sha_sent", "INTEGER NOT NULL DEFAULT 0"),
            ("suppress_problem_notifications", "INTEGER NOT NULL DEFAULT 0"),
            ("proxy_id",           "INTEGER"),
            ("nft_watch_last_check", "TEXT"),
            ("forest_enabled",     "INTEGER NOT NULL DEFAULT 1"),
            ("forest_chat_status", "TEXT NOT NULL DEFAULT 'queued'"),
            ("forest_chat_error",  "TEXT NOT NULL DEFAULT ''"),
            ("forest_available_at", "TEXT"),
            ("forest_next_fish_at", "TEXT"),
            ("forest_net_last_used", "TEXT"),
            ("forest_next_net_at", "TEXT"),
            ("forest_fish_count",  "INTEGER NOT NULL DEFAULT 0"),
            ("forest_net_count",   "INTEGER NOT NULL DEFAULT 0"),
        ]:
            try:
                await self._conn.execute(f"ALTER TABLE accounts ADD COLUMN {col} {definition}")
                await self._conn.commit()
            except Exception:
                pass  # column already exists
        for col, definition in [
            ("title", "TEXT NOT NULL DEFAULT ''"),
            ("link", "TEXT NOT NULL DEFAULT ''"),
            ("account_limit", "INTEGER NOT NULL DEFAULT 1"),
            ("join_interval_minutes", "INTEGER NOT NULL DEFAULT 10"),
            ("avoid_as_secondary", "INTEGER NOT NULL DEFAULT 0"),
            ("next_join_at", "TEXT"),
            ("created_at", "TEXT"),
        ]:
            try:
                await self._conn.execute(f"ALTER TABLE chats ADD COLUMN {col} {definition}")
                await self._conn.commit()
            except Exception:
                pass
        chat_cols = await self._table_columns("chats")
        if "link_or_username" in chat_cols:
            if "link" in chat_cols:
                await self._conn.execute("UPDATE chats SET link=link_or_username WHERE link=''")
            if "title" in chat_cols:
                await self._conn.execute("UPDATE chats SET title=link_or_username WHERE title=''")
            await self._conn.commit()
        cur = await self._conn.execute("SELECT value FROM settings WHERE key='legacy_chat_reset_done'")
        if not await cur.fetchone():
            await self._conn.execute(
                """
                UPDATE accounts
                SET chat_id=NULL, chat='', setup_status='waiting_chat', chat_status='waiting', chat_error=''
                WHERE chat_id IS NULL
                  AND chat<>''
                  AND setup_status='working'
                  AND chat_status='joined'
                """
            )
            await self._conn.execute(
                "INSERT INTO settings (key, value) VALUES ('legacy_chat_reset_done', '1')"
            )
            await self._conn.commit()

    # --- Accounts ---

    async def _table_columns(self, table: str) -> set[str]:
        cur = await self._conn.execute(f"PRAGMA table_info({table})")
        rows = await cur.fetchall()
        return {r["name"] for r in rows}

    async def get_accounts(self) -> list[dict]:
        cur = await self._conn.execute("SELECT * FROM accounts ORDER BY id")
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_account(self, acc_id: int) -> Optional[dict]:
        cur = await self._conn.execute("SELECT * FROM accounts WHERE id=?", (acc_id,))
        row = await cur.fetchone()
        return dict(row) if row else None

    async def create_account(self, **kwargs) -> int:
        fields = ", ".join(kwargs.keys())
        placeholders = ", ".join("?" * len(kwargs))
        values = list(kwargs.values())
        # Convert bool to int
        values = [int(v) if isinstance(v, bool) else v for v in values]
        cur = await self._conn.execute(
            f"INSERT INTO accounts ({fields}) VALUES ({placeholders})", values
        )
        await self._conn.commit()
        return cur.lastrowid

    async def update_account(self, acc_id: int, updates: dict):
        set_clause = ", ".join(f"{k}=?" for k in updates)
        values = [int(v) if isinstance(v, bool) else v for v in updates.values()]
        values.append(acc_id)
        await self._conn.execute(f"UPDATE accounts SET {set_clause} WHERE id=?", values)
        await self._conn.commit()

    async def delete_account(self, acc_id: int):
        await self._conn.execute("DELETE FROM accounts WHERE id=?", (acc_id,))
        await self._conn.commit()

    async def set_next_send(self, acc_id: int, dt: datetime):
        await self._conn.execute(
            "UPDATE accounts SET next_send_at=? WHERE id=?",
            (dt.isoformat(), acc_id)
        )
        await self._conn.commit()

    async def claim_external_dm_sha(self, acc_id: int) -> bool:
        cur = await self._conn.execute(
            "UPDATE accounts SET external_dm_sha_sent=1 WHERE id=? AND external_dm_sha_sent=0",
            (acc_id,)
        )
        await self._conn.commit()
        return cur.rowcount > 0

    async def claim_external_dm_for_sender(self, acc_id: int, sender_id: int) -> bool:
        cur = await self._conn.execute(
            "INSERT OR IGNORE INTO external_dm_replies (account_id, sender_id) VALUES (?,?)",
            (acc_id, sender_id),
        )
        await self._conn.commit()
        return cur.rowcount > 0

    async def allow_external_dm_for_sender(self, acc_id: int, sender_id: int) -> bool:
        cur = await self._conn.execute(
            "DELETE FROM external_dm_replies WHERE account_id=? AND sender_id=?",
            (acc_id, sender_id),
        )
        await self._conn.commit()
        return cur.rowcount > 0

    # --- Logs ---

    async def add_log(self, account_id: int, account_name: str, event: str, details: str = ""):
        await self._conn.execute(
            "INSERT INTO logs (account_id, account_name, event, details) VALUES (?,?,?,?)",
            (account_id, account_name, event, details)
        )
        await self._conn.commit()

    async def get_logs(self, acc_id: Optional[int] = None, limit: int = 100) -> list[dict]:
        if acc_id:
            cur = await self._conn.execute(
                "SELECT * FROM logs WHERE account_id=? ORDER BY id DESC LIMIT ?",
                (acc_id, limit)
            )
        else:
            cur = await self._conn.execute(
                "SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,)
            )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_setting(self, key: str, default: str = "") -> str:
        cur = await self._conn.execute("SELECT value FROM settings WHERE key=?", (key,))
        row = await cur.fetchone()
        return row["value"] if row else default

    async def set_setting(self, key: str, value: str):
        await self._conn.execute(
            "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value)
        )
        await self._conn.commit()

    # --- Proxies ---

    async def add_proxy(self, server: str, port: int, secret: str, source_url: str = "") -> bool:
        """Insert proxy. Returns True if new, False if duplicate."""
        try:
            await self._conn.execute(
                "INSERT INTO proxies (server, port, secret, source_url) VALUES (?,?,?,?)",
                (server, port, secret, source_url),
            )
            await self._conn.commit()
            return True
        except Exception:
            return False

    async def get_proxies(self) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT p.*, COUNT(a.id) as account_count "
            "FROM proxies p LEFT JOIN accounts a ON a.proxy_id=p.id "
            "GROUP BY p.id ORDER BY p.id DESC"
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_proxy(self, proxy_id: int) -> Optional[dict]:
        cur = await self._conn.execute("SELECT * FROM proxies WHERE id=?", (proxy_id,))
        row = await cur.fetchone()
        return dict(row) if row else None

    async def get_active_proxies(self) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM proxies WHERE status='active' ORDER BY fail_count ASC, id DESC"
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_next_proxy(self, max_accounts: int = 3) -> Optional[dict]:
        """Return an active proxy with fewer than max_accounts accounts assigned."""
        cur = await self._conn.execute(
            "SELECT p.*, COUNT(a.id) AS acc_count "
            "FROM proxies p "
            "LEFT JOIN accounts a ON a.proxy_id=p.id AND a.enabled=1 "
            "WHERE p.status='active' "
            "GROUP BY p.id HAVING acc_count < ? "
            "ORDER BY acc_count ASC, p.fail_count ASC LIMIT 1",
            (max_accounts,),
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def mark_proxy_dead(self, proxy_id: int, error: str = ""):
        await self._conn.execute(
            "UPDATE proxies SET status='dead', last_error=?, fail_count=fail_count+1 WHERE id=?",
            (error[:500], proxy_id),
        )
        await self._conn.commit()

    async def mark_proxy_fail(self, proxy_id: int, error: str = ""):
        await self._conn.execute(
            "UPDATE proxies SET fail_count=fail_count+1, last_error=? WHERE id=?",
            (error[:500], proxy_id),
        )
        await self._conn.commit()

    async def assign_proxy(self, acc_id: int, proxy_id: Optional[int]):
        await self._conn.execute(
            "UPDATE accounts SET proxy_id=? WHERE id=?", (proxy_id, acc_id)
        )
        await self._conn.commit()

    async def get_accounts_by_proxy(self, proxy_id: int) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM accounts WHERE proxy_id=?", (proxy_id,)
        )
        return [dict(r) for r in await cur.fetchall()]

    async def reassign_proxy_accounts(self, dead_proxy_id: int):
        """Move all accounts off a dead proxy to the next available ones."""
        cur = await self._conn.execute(
            "SELECT id FROM accounts WHERE proxy_id=?", (dead_proxy_id,)
        )
        acc_ids = [r[0] for r in await cur.fetchall()]
        for acc_id in acc_ids:
            new_proxy = await self.get_next_proxy()
            await self.assign_proxy(acc_id, new_proxy["id"] if new_proxy else None)

    async def update_proxy_status(self, proxy_id: int, status: str):
        await self._conn.execute(
            "UPDATE proxies SET status=? WHERE id=?", (status, proxy_id)
        )
        await self._conn.commit()

    async def reset_proxy(self, proxy_id: int):
        """Reset proxy to active, clear error counter and last_error."""
        await self._conn.execute(
            "UPDATE proxies SET status='active', fail_count=0, last_error='' WHERE id=?",
            (proxy_id,),
        )
        await self._conn.commit()

    async def delete_proxy(self, proxy_id: int):
        await self._conn.execute(
            "UPDATE accounts SET proxy_id=NULL WHERE proxy_id=?", (proxy_id,)
        )
        await self._conn.execute("DELETE FROM proxies WHERE id=?", (proxy_id,))
        await self._conn.commit()

    async def get_accounts_by_chat(self, chat: str) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM accounts WHERE chat=? AND enabled=1 ORDER BY id", (chat,)
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_accounts_by_chat_all(self, chat: str) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM accounts WHERE chat=? ORDER BY id", (chat,)
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def get_accounts_by_chat_id(self, chat_id: int) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM accounts WHERE chat_id=? ORDER BY id", (chat_id,)
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_accounts_by_chat_id_and_statuses(self, chat_id: int, statuses: list[str]) -> list[dict]:
        placeholders = ", ".join("?" * len(statuses))
        cur = await self._conn.execute(
            f"SELECT * FROM accounts WHERE chat_id=? AND chat_status IN ({placeholders}) ORDER BY id",
            [chat_id, *statuses],
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_forest_accounts(self) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM accounts WHERE forest_enabled=1 ORDER BY id"
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_next_forest_queued_account(self) -> Optional[dict]:
        cur = await self._conn.execute(
            """
            SELECT * FROM accounts
            WHERE forest_enabled=1
              AND COALESCE(forest_chat_status, 'queued') IN ('queued', 'error')
              AND COALESCE(forest_chat_status, 'queued') != 'banned'
            ORDER BY id
            LIMIT 1
            """
        )
        row = await cur.fetchone()
        return dict(row) if row else None

    async def get_forest_stats(self) -> dict:
        cur = await self._conn.execute("SELECT COUNT(*) AS total FROM accounts")
        total = (await cur.fetchone())["total"]
        cur = await self._conn.execute("SELECT COUNT(*) AS active FROM accounts WHERE forest_enabled=1")
        active = (await cur.fetchone())["active"]
        cur = await self._conn.execute("SELECT COUNT(*) AS joined FROM accounts WHERE forest_chat_status='joined'")
        joined = (await cur.fetchone())["joined"]
        cur = await self._conn.execute("SELECT COALESCE(SUM(forest_fish_count),0) AS fish FROM accounts")
        fish = (await cur.fetchone())["fish"]
        cur = await self._conn.execute("SELECT COALESCE(SUM(forest_net_count),0) AS nets FROM accounts")
        nets = (await cur.fetchone())["nets"]
        cur = await self._conn.execute(
            "SELECT COUNT(*) AS fish_today FROM logs WHERE event='forest_fish' AND date(created_at)=date('now')"
        )
        fish_today = (await cur.fetchone())["fish_today"]
        return {
            "total_accounts": total,
            "active_accounts": active,
            "joined_accounts": joined,
            "fish_total": fish,
            "fish_today": fish_today,
            "net_total": nets,
        }

    async def get_waiting_chat_accounts(self) -> list[dict]:
        cur = await self._conn.execute(
            "SELECT * FROM accounts WHERE setup_status='waiting_chat' AND chat_status='waiting' ORDER BY id"
        )
        return [dict(r) for r in await cur.fetchall()]

    # --- Chats ---

    async def create_chat(
        self,
        title: str,
        link: str,
        account_limit: int,
        join_interval_minutes: int,
        avoid_as_secondary: bool = False,
    ) -> int:
        fields = ["title", "link", "account_limit", "join_interval_minutes", "avoid_as_secondary"]
        values = [title, link, max(1, account_limit), max(1, join_interval_minutes), int(avoid_as_secondary)]
        if "link_or_username" in await self._table_columns("chats"):
            fields.append("link_or_username")
            values.append(link)
        placeholders = ", ".join("?" * len(fields))
        cur = await self._conn.execute(
            f"INSERT INTO chats ({', '.join(fields)}) VALUES ({placeholders})",
            values,
        )
        await self._conn.commit()
        return cur.lastrowid

    async def get_chats(self) -> list[dict]:
        cur = await self._conn.execute(
            """
            SELECT c.*,
                   COUNT(CASE WHEN a.chat_id=c.id AND a.chat_status IN ('queued','joining','joined') THEN 1 END) AS occupied,
                   COUNT(CASE WHEN a.chat_id=c.id AND a.chat_status='queued' THEN 1 END) AS queued,
                   COUNT(CASE WHEN a.chat_id=c.id AND a.chat_status='joined' THEN 1 END) AS joined
            FROM chats c
            LEFT JOIN accounts a ON a.chat_id=c.id
            GROUP BY c.id
            ORDER BY c.id DESC
            """
        )
        return [dict(r) for r in await cur.fetchall()]

    async def get_chat(self, chat_id: int) -> Optional[dict]:
        cur = await self._conn.execute("SELECT * FROM chats WHERE id=?", (chat_id,))
        row = await cur.fetchone()
        return dict(row) if row else None

    async def update_chat(self, chat_id: int, updates: dict):
        if "link" in updates and "link_or_username" in await self._table_columns("chats"):
            updates = {**updates, "link_or_username": updates["link"]}
        set_clause = ", ".join(f"{k}=?" for k in updates)
        values = [int(v) if isinstance(v, bool) else v for v in updates.values()]
        values.append(chat_id)
        await self._conn.execute(f"UPDATE chats SET {set_clause} WHERE id=?", values)
        await self._conn.commit()

    async def set_chat_next_join(self, chat_id: int, dt: Optional[datetime]):
        await self._conn.execute(
            "UPDATE chats SET next_join_at=? WHERE id=?",
            (dt.isoformat() if dt else None, chat_id),
        )
        await self._conn.commit()

    async def delete_chat(self, chat_id: int):
        await self._conn.execute(
            "UPDATE accounts SET chat_id=NULL, chat='', setup_status='waiting_chat', chat_status='waiting' WHERE chat_id=?",
            (chat_id,),
        )
        await self._conn.execute(
            """
            UPDATE accounts
            SET secondary_chat_id=NULL,
                secondary_chat='',
                secondary_chat_status='',
                secondary_chat_error='',
                secondary_chat_available_at=NULL
            WHERE secondary_chat_id=?
            """,
            (chat_id,),
        )
        await self._conn.execute("DELETE FROM chats WHERE id=?", (chat_id,))
        await self._conn.commit()

    async def clear_secondary_chat_assignments(self, chat_id: int, auto_only: bool = False) -> int:
        auto_filter = " AND COALESCE(secondary_chat_manual, 0)=0" if auto_only else ""
        cur = await self._conn.execute(
            f"""
            UPDATE accounts
            SET secondary_chat_id=NULL,
                secondary_chat='',
                secondary_chat_status='',
                secondary_chat_error='',
                secondary_chat_available_at=NULL,
                secondary_chat_manual=0
            WHERE secondary_chat_id=?
            {auto_filter}
            """,
            (chat_id,),
        )
        await self._conn.commit()
        return cur.rowcount

    async def assign_account_to_chat(self, acc_id: int, chat: dict, status: str = "queued"):
        await self._conn.execute(
            "UPDATE accounts SET chat_id=?, chat=?, setup_status=?, chat_status=?, chat_error='' WHERE id=?",
            (chat["id"], chat["link"], "queued_chat" if status == "queued" else "working", status, acc_id),
        )
        await self._conn.commit()

    async def unassign_account_chat(self, acc_id: int):
        await self._conn.execute(
            "UPDATE accounts SET chat_id=NULL, chat='', setup_status='waiting_chat', chat_status='waiting', chat_error='' WHERE id=?",
            (acc_id,),
        )
        await self._conn.commit()

    async def assign_account_secondary_chat(
        self,
        acc_id: int,
        chat: Optional[dict],
        status: str = "queued",
        manual: bool = False,
    ):
        if not chat:
            await self._conn.execute(
                """
                UPDATE accounts
                SET secondary_chat_id=NULL,
                    secondary_chat='',
                    secondary_chat_status='',
                    secondary_chat_error='',
                    secondary_chat_available_at=NULL,
                    secondary_chat_manual=0
                WHERE id=?
                """,
                (acc_id,),
            )
        else:
            await self._conn.execute(
                """
                UPDATE accounts
                SET secondary_chat_id=?,
                    secondary_chat=?,
                    secondary_chat_status=?,
                    secondary_chat_error='',
                    secondary_chat_available_at=NULL,
                    secondary_chat_manual=?
                WHERE id=?
                """,
                (chat["id"], chat["link"], status, int(manual), acc_id),
            )
        await self._conn.commit()

    async def assign_random_secondary_chats(self) -> int:
        all_chats = await self.get_chats()
        for chat in all_chats:
            if chat.get("avoid_as_secondary"):
                await self.clear_secondary_chat_assignments(chat["id"], auto_only=True)
        chats = [c for c in all_chats if not bool(c.get("avoid_as_secondary"))]
        if not chats:
            return 0
        accounts = await self.get_accounts()
        assigned = 0
        for acc in accounts:
            if acc.get("secondary_chat_id") or not acc.get("chat_id"):
                continue
            choices = [c for c in chats if c["id"] != acc.get("chat_id")]
            if not choices:
                continue
            await self.assign_account_secondary_chat(acc["id"], random.choice(choices), "queued")
            assigned += 1
        return assigned

    async def allocate_waiting_accounts(self) -> int:
        chats = await self.get_chats()
        waiting = await self.get_waiting_chat_accounts()
        assigned = 0
        for acc in waiting:
            free = [
                c for c in chats
                if int(c["account_limit"]) - int(c.get("occupied") or 0) > 0
            ]
            if not free:
                break
            chat = max(free, key=lambda c: int(c["account_limit"]) - int(c.get("occupied") or 0))
            await self.assign_account_to_chat(acc["id"], chat, "queued")
            chat["occupied"] = int(chat.get("occupied") or 0) + 1
            assigned += 1
        return assigned

    # --- Asset usage ---

    async def mark_asset_used(self, asset_type: str, asset_value: str, account_id: int):
        await self._conn.execute(
            "INSERT OR IGNORE INTO asset_usage (asset_type, asset_value, account_id) VALUES (?,?,?)",
            (asset_type, asset_value, account_id),
        )
        await self._conn.commit()

    async def get_asset_usage(self, asset_type: str) -> list[str]:
        cur = await self._conn.execute(
            "SELECT DISTINCT asset_value FROM asset_usage WHERE asset_type=?", (asset_type,)
        )
        return [r["asset_value"] for r in await cur.fetchall()]

    async def reset_profile_asset_usage(self):
        await self._conn.execute("DELETE FROM asset_usage WHERE asset_type IN ('photo', 'bio')")
        await self._conn.commit()

    async def get_stats(self) -> dict:
        cur = await self._conn.execute("SELECT COUNT(*) as total FROM accounts")
        total = (await cur.fetchone())["total"]
        cur = await self._conn.execute("SELECT COUNT(*) as active FROM accounts WHERE enabled=1")
        active = (await cur.fetchone())["active"]
        cur = await self._conn.execute(
            "SELECT COUNT(*) as sent FROM logs WHERE event='sent'"
        )
        sent = (await cur.fetchone())["sent"]
        cur = await self._conn.execute(
            "SELECT COUNT(*) as sent_today FROM logs WHERE event='sent' AND date(created_at)=date('now')"
        )
        sent_today = (await cur.fetchone())["sent_today"]
        return {
            "total_accounts": total,
            "active_accounts": active,
            "total_sent": sent,
            "sent_today": sent_today,
        }


db = Database()
