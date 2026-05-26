# StarLoot Release Checklist

Use this checklist before every production release to reduce emergency hotfixes.

## 1) Automated Gate (required)

Run from repo root:

```bash
npm run release:check
```

This runs:
- backend syntax checks
- backend tests (if present, pass when no tests yet)
- admin-panel syntax check
- frontend production build

Optional extra:
- run frontend lint after adding ESLint config

If any step fails, do not release.

## 2) Database Safety (required)

Before release, create DB backup/snapshot.

Minimal checks (run on production-like DB):

```sql
SELECT COUNT(*) AS users_count FROM users;
SELECT COUNT(*) AS active_expeditions FROM expeditions WHERE status = 'in_progress';
SELECT COUNT(*) AS active_quests FROM user_quests WHERE status = 'active';
SELECT COUNT(*) AS game_config_rows FROM game_config;
```

If values look abnormal (0 when expected non-zero, huge spikes), stop and investigate.

## 3) Critical Gameplay Smoke Test (required)

Test with one clean account and one mid-progress account.

1. Login and profile loads without errors.
2. Start expedition -> collect result -> sell and save flow works.
3. Pirate encounter path works (pay/fight path if available).
4. Stars flow: topup/mock-topup path and speedup deduction works.
5. Quests:
- daily and weekly visible with correct labels
- claim works
- reroll/buyout only where expected
6. Shop/upgrades purchase updates user stats correctly.
7. Referral screen and rewards do not throw API errors.
8. Tournament/event banner loads without console errors.

## 4) Admin-Panel Smoke Test (required)

1. Login with admin secret works.
2. Stats page opens without 401/JSON parse errors.
3. Quests modal:
- "Load preset" returns templates (from DB or gameConfig fallback)
- "Save all" persists templates
- "Reset quests for all" succeeds
4. Event create/end works.
5. Tournament list/create/end works.

## 5) Release Process Discipline

1. Release only from a tagged commit.
2. Keep rollback plan ready (previous image/tag + DB snapshot).
3. Monitor first 30-60 min after release:
- backend 5xx
- auth errors
- payment errors
- expedition/quest error spikes

## 6) Fast Rollback Criteria

Rollback immediately if any is true:
- users cannot start or collect expeditions
- stars balance/payment inconsistencies
- mass quest corruption (empty/invalid quests for many users)
- persistent 401/403 for valid users/admin

## 7) Next Improvement (recommended)

Add at least 8-12 API integration tests for:
- expedition start/collect/action
- quest dashboard/claim/reroll/buyout
- stars topup/speedup
- admin quest templates + wipe-refresh

Until then, this checklist is your release safety net.
