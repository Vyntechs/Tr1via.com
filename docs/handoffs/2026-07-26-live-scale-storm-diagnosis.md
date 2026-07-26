# Live-scale freeze — the 07-22 "database couldn't keep up" night

**Symptom (Brandon, live):** ~30+ players. Clicks freeze / no response, then the
already-clicked action "finally responds" 30 seconds to 2 minutes later. Feels
like the database is overwhelmed. Happens on the weeks he makes mid-week changes;
calm (unchanged) weeks with the same 30 players are fine.

## Root cause — NAMED + CONFIRMED (not a guess)

The mid-July "phone-first live game" rewrite (shipped **07-18 → 07-20**, PRs
#146–#150 + the resilient answer engine) routed **every** live API call — player
heartbeats, room snapshots, TV snapshots, lock-count polls — through Next
`middleware.ts`, which ran a Supabase Auth `getUser()` on **every request**.

At 30 players that multiplies into **thousands of auth calls per venue**. Auth
saturates → middleware **times out in front of route responses that already
succeeded** → the browser never receives the successful answer → every client
retries at once → a request **storm**.

That is exactly the reported signature: the answer was ready, but the auth gate in
front of it stalled; the client never saw it, retried on backoff
(`fetchWithRetry` / `recoveryBackoff`), and it "landed" 30s–2min later when Auth
recovered. The fix commit's own message says this verbatim
(`middleware.ts`, commit `ad26e49`).

**Key reframe:** player count is the *revealer*, not the *cause*. 30-player nights
are fine when nothing changed. A mid-week change (here: the live-path rewrite)
introduced per-request load that only detonates once the room is full.

## Already patched on `main` (emergency fixes, Wed 07-22 evening)

- `ad26e49` **fix: stop live API auth storms** — `middleware.ts` now returns early
  for `/api/*` (skips the host session-refresh gate). Authed handlers still call
  `requireOwned*` / `getAuthedHost` themselves, so no security regression.
- `7889b8a` **fix: coalesce live snapshot traffic** — `app/api/room/[code]/snapshot`
  rewritten (254 lines) to collapse duplicate snapshot reads.
- `5474f8c` live sync/standings; `bbe568b` live-game release blockers; #162
  prevent-trivia-night-recurrence.

## ⚠️ Two honest caveats

1. **The fixes were authored *during* the 07-22 show window** (18:58 / 19:12). The
   bad night Brandon lived through was *before* they took effect. So the next
   Wednesday is the **first real 30-player test** of whether they hold. Mechanism
   is proven + patched; "holds under load" is NOT yet proven.
2. **Residual DB-level smells (confirmed live via Supabase performance advisor,
   project `citweuctcnuxmqjxcbiz`, 2026-07-26):** none *caused* the storm, but they
   keep the DB closer to its knees at scale and slow recovery. All low-risk,
   mechanical — but each is a migration = **founder-gated**:
   - **30× `multiple_permissive_policies` (WARN)** on the hot tables `answers`,
     `categories`, `games`, `nights`, `players`, `questions` — Postgres evaluates
     *two* permissive policies per row per query on the busiest live tables.
   - **6× `auth_rls_initplan` (WARN)** on `hosts`, `venues`, `nights`,
     `question_generation_reports` — RLS re-runs `auth.uid()` **per row**; fix is to
     wrap as `(select auth.uid())` so it's evaluated once per query.
   - **17× `unindexed_foreign_keys` (INFO)** incl. `answers_player_id_fkey` (hot).
   - 9× `unused_index` (dead weight), 1× `auth_db_connections_absolute` (the
     connection ceiling — relevant to the storm story).

## The durable fix (recommended)

The real gap: a big live-path rewrite reached a live room with 30 real people as
its **first 30-player test**. CI has vitest + build + a small concurrency check but
**no full-room load test**. So changes storm the venue, not the laptop.

1. **Build a 30-player load harness** — simulates a full room hammering the live
   endpoints (join → heartbeat → snapshot poll → answer → lock), runnable on demand
   and in CI. Turns "we find out at the venue" into "we find out before merge."
   Non-destructive.
2. Use it to **prove the 07-22 storm fixes hold** before the next show.
3. Separately, a small reviewed migration to clear the advisor WARNs (consolidate
   duplicate policies + `(select auth.uid())` + add the hot FK index). Founder-gated,
   never near a show.

## BUILT (2026-07-26) — the load harness + proof the storm is guarded

- **Known storm is already auto-guarded + GREEN.** `tests/concurrency/legacy-venue-load-contract.test.ts`
  fires 40 players' live `/api/*` traffic through the REAL `middleware` and asserts
  ZERO Supabase Auth calls — it fails if the July-22 auth gate ever returns. Runs in
  CI on every PR + push (`ci.yml` "40-player traffic guards"). Ran it: **34/34 pass.**
- **New: `scripts/venue-load.mjs`** — a 30-player HTTP load generator you point at a
  running target (local dev or a Vercel PREVIEW — never prod during a show). Fires the
  real player hot-loop (snapshot poll + heartbeat + answer) from N concurrent virtual
  players and reports per-endpoint p50/p95/max + error + "froze" (≥5s) counts, with a
  hard PASS/FAIL SLO (p95 < 1s, zero frozen requests, <1% errors). The froze-≥5s check
  is the direct guard against the 30s–2min freeze.
  - `npm run venue:load -- --base-url <url> --code <ROOM> --players 30 --seconds 20`
  - `npm run venue:load:selftest` — no server needed; spins up a healthy + a *storming*
    server in-process and proves the harness passes the first and FAILS the second.
    **Ran it: healthy p95 ~60ms PASS, storm p95 ~2.5s FAIL, exit 0.** Wired into CI.

## Still open (needs Brandon's go)

1. **Real end-to-end run** against the actual app at 30 players. Blocked here: this
   worktree has **no `app/api/_test` seed routes** and **no running Supabase stack** (no
   `supabase` CLI cached, no `.env.local`). Options: (a) stand up the local stack +
   restore/seed a room, or (b) run `venue:load` against a **Vercel preview deploy** before
   each show. Recommend (b) as the routine pre-show gate.
2. **The advisor WARNs** (duplicate RLS policies on hot tables, per-row `auth.uid()`,
   unindexed `answers.player_id`) — one small reviewed migration. Founder-gated, never
   near a show.

**Status:** diagnosis complete; harness built + self-proven + CI-wired (no prod touch).
Files uncommitted-then-committed on the worktree branch; split to a clean PR branch on
Brandon's go. Do NOT apply any migration without explicit founder approval.
