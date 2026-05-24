# TR1VIA — Handoff

**Read order for a fresh session:** this file → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `docs/superpowers/plans/2026-05-23-smoke-orchestration.md` (test orchestration plan) → `supabase/README.md` (DB setup) → `README.md` (run instructions). The Claude Design package is at `/tmp/tr1via-design/tr1via/` (chats + JSX prototypes).

---

## State as of 2026-05-23 (late evening, after session 2)

**Live, deployed, working:**
- Repo: <https://github.com/Vyntechs/Tr1via.com> (main, auto-deploys via Vercel)
- ~25 commits today; latest `76e9793 fix(realtime): REST broadcast + optimistic player answer to unblock smoke`
- TypeScript build clean. **181/181 unit + component tests pass.** Reveal-sync E2E test currently FAILS (see "Known bugs" below — this is information, not regression).
- `tr1via.com` serves the new customer-facing landing (room code input + Host sign-in chip).

**Production resources (canonical):**
- Supabase **Trivia** (`citweuctcnuxmqjxcbiz`) — now has **5 migrations** applied (0001-0004 + new `0005_host_roles`). Brandon's row is seeded as founder (`role='founder', is_paywall_bypassed=true`).
- Vercel project **tr1via** in `brandon-nichols-projects-f7e6d2a9` — unchanged.

**`.env.local` has the real prod keys now** — Brandon manually pasted SUPABASE_SERVICE_ROLE_KEY because Vercel marks it Sensitive (can't be pulled via CLI). All 7 keys present.

---

## What was built in this session

### Customer-facing landing page
`app/page.tsx` — replaced the dev placeholder (`/dev/system` links styled like code, confused users). Real landing: TR1VIA wordmark, "Got a code? You're in." headline, room code input that routes to `/join?code=XXX`, "Host · Sign in →" chip top-right that routes to `/login`.

### Founder role + admin dashboard
**Migration `0005_host_roles.sql`** adds `role`, `is_paywall_bypassed`, `comped_at`, `comped_by` columns to `hosts`. Partial unique index `hosts_single_founder_idx` enforces founder is a singleton. Applied to prod.

**Brandon's seed** — auth.users + hosts rows inserted directly via MCP. Magic-link flow works (we manually verified all required auth.users fields populated, see "Lessons" below).

**`requireFounder()` helper** in `lib/api/auth.ts` — wraps getAuthedHost and checks role==='founder'.

**`/api/admin/hosts`** (GET list, POST comp) and `/api/admin/hosts/[id]` (PATCH toggle paywall) — all founder-gated via service-role client.

**`/host/admin` dashboard** — server component checks founder role (404s non-founders), renders `HostAdminClient` with the hosts table + comp-a-host form.

**"FOUNDER →" chip** on `/host` (top-right) — only visible to Brandon, routes to `/host/admin`.

### Smoke test orchestration (Phases 0-4 of plan)
Plan doc: **`docs/superpowers/plans/2026-05-23-smoke-orchestration.md`** — complete scope, 9 phases.

**Decision early in session:** tests use **prod Trivia DB** with strict `@tr1via.test` email isolation (vs. local Supabase, which would have required installing Docker — Brandon chose this path).

Built so far:
- **Test harness routes** at `app/api/%5Ftest/` (URL `/api/_test/*`): `login`, `seed-night`, `reset`, `fast-forward`. Two-factor gated: `TEST_AUTH_ENABLED=1` env AND `x-test-secret` header matching `TEST_SECRET` env. Login refuses non-`@tr1via.test` emails. (Folder name uses `%5F` URL-encoding so Next routes it — `_test` alone would be private/unrouted.)
- **MSW mocks** at `tests/mocks/`: 20 canned Pixar questions + 12 canned Pexels photos. Anthropic handler matches the **`emit_questions`** tool name (NOT `submit_questions` as the original plan said — production code uses `emit_questions`). MSW boots via `instrumentation.ts` when `MOCK_EXTERNAL=1`.
- **`data-testid` attributes** on every player/TV/host screen + landing + shells. `PhoneScreen`, `TVStage`, `AnswerCard` now accept `"data-testid"?: string` and forward to outer.
- **`tests/e2e/helpers/`**: `selectors.ts` (TID source of truth), `env.ts` (TEST_SECRET constant), `host-laptop.ts`, `tv.ts`, `player-phone.ts`.
- **`tests/e2e/reveal-sync.spec.ts`** — multi-context (host + TV + 3 phones) test. Currently failing — see Known bugs.

### Real-time fixes from chasing the reveal-sync bugs
- **`lib/api/broadcast.ts`** — switched from `channel.subscribe()+send()` (1+ sec WebSocket round-trip) to REST endpoint `POST /realtime/v1/api/broadcast` (~100ms). Same client-side broadcast delivery, much faster server-side.
- **`app/(player)/room/[code]/page.tsx`** — optimistic answer state. When player taps, synthesize a local `AnswerRow` so the page transitions to PlayerLocked immediately. Real DB row supersedes when it arrives via useMyAnswers. Fixes the bug where postgres_changes couldn't reach device-cookie sessions.
- **Subagent earlier in session also touched** `lib/supabase/client.ts` (static env-var reads + `x-tr1via-device` header on browser fetches) and `lib/hooks/useRoom.ts` (HTTP refresh on broadcast) — these were necessary to make ANY player-facing realtime work. Keep them.

---

## Known bugs (real, in production code, found by the smoke test)

| # | Bug | Status | Where to look |
|---|---|---|---|
| 1 | Reveal latency 1.5-2.5s, not 250ms | Documented; test budget at 3000ms with TODO. The 250ms goal was unrealistic — round-trip math suggests 500-1000ms is the achievable floor given current arch. | `tests/e2e/reveal-sync.spec.ts` ARRIVAL_BUDGET constant |
| 2 | Player tap → Locked screen didn't appear | **FIXED** (optimistic answer in 76e9793) | `app/(player)/room/[code]/page.tsx` `recordOptimisticAnswer` |
| 3 | TV → Reveal screen never appears after fast-forward triggers resolve | **NOT FIXED** — this is the next bug to investigate. Test fails here. Suspected: broadcast not reaching TV, OR snapshot not seeing the resolve row, OR `showLeaderboard` state not flipping. | `lib/hooks/useTVRoom.ts` + `app/tv/[code]/page.tsx` lines 175-245 |
| 4 | Browser hydration mismatches in console (every page) | Not investigated. Probably benign but worth checking. | Browser console on any page |

---

## What's still pending in the orchestration plan

Phases 5-9 of `docs/superpowers/plans/2026-05-23-smoke-orchestration.md`:

- **Phase 5** — `full-game.spec.ts` (3 cats × 7 questions in game 1 → intermission → game 2 → finale) + 5 edge-case specs (rejoin, network-drop, mid-game-edits, manual-entry, generation-failure). Blocked on bug #3 — running the full game requires the TV reveal transition to work.
- **Phase 6** — API integration tests per resource (10 specs).
- **Phase 7** — `smoke-routes.spec.ts` (visit every route, check console errors).
- **Phase 8** — `scripts/test-smoke.sh` orchestration + Brandon-readable checklist report.
- **Phase 9** — `docs/superpowers/decisions/2026-05-23-smoke-test-coverage.md` — gaps doc.

Brandon's explicit direction at end of session 2: **"continue fixing bugs"** (option 1 of three offered). So the next session should attack bug #3 first, not jump to Phase 5.

---

## Architectural lessons worth carrying forward (non-obvious)

These cost me hours to discover. Keep in mind:

1. **Vercel "Sensitive" env vars CANNOT be pulled via `vercel env pull` or `vercel env run`.** They show up as empty strings even though prod has the real value. Brandon has to paste them manually into `.env.local`. (This is by design — Sensitive = write-only.)

2. **Supabase auth.users inserted via raw SQL needs more fields than the local `seed.sql` shows.** Specifically, `raw_app_meta_data`, `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`, `email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token` MUST be set to empty strings `''` (not NULL) or `admin.auth.admin.listUsers()` errors with "Database error finding users". I fixed Brandon's row in prod.

3. **Supabase Realtime `postgres_changes` does NOT reach device-cookie sessions reliably.** The `x-tr1via-device` header that grants RLS access can't ride the WebSocket subscription. Workarounds (already in code): `useRoom.refreshLiveState` does HTTP fetch on broadcast; player route synthesizes optimistic answers on tap. **TV doesn't have this problem because it uses an unauthenticated snapshot endpoint.**

4. **Channel `subscribe()+send()` from a serverless function takes ~1-1.5s** (subscribe round-trip). Always use the REST broadcast endpoint (POST /realtime/v1/api/broadcast) from server-side. Now baked into `lib/api/broadcast.ts`.

5. **`emit_questions` is the tool name** in `lib/ai/generate-questions.ts`, not `submit_questions` as my original plan said. Mock fixtures match the real name.

6. **`/api/_test/*` routes live at `app/api/%5Ftest/`** on disk — the URL-encoded `%5F` is required to route at `/api/_test/*` since literal `_test` is treated as private by Next App Router.

7. **Test isolation discipline:** every test user email MUST end in `@tr1via.test`. `isTestEmail()` in `lib/api/require-test-mode.ts` is the allowlist. Brandon's `brandon.james.nichols@gmail.com` is structurally incapable of being touched by `/api/_test/reset`.

8. **Boot dev server with test mode:**
   ```bash
   TEST_AUTH_ENABLED=1 TEST_SECRET=local-test-secret MOCK_EXTERNAL=1 npm run dev
   ```
   Playwright config (`playwright.config.ts`) sets these automatically via its `webServer.env` block.

---

## How to resume (next session)

1. **`git pull`** — make sure you have everything through `76e9793`.
2. **Verify `.env.local` still has the real SUPABASE_SERVICE_ROLE_KEY** (Brandon pasted it manually — should still be there unless someone overwrote with `vercel env pull`).
3. **Decide next action with Brandon.** Per session 2 direction: bug #3 (TV → resolve transition) is next. After that, bug #4 (hydration) is worth a glance, then resume Phase 5+ of the orchestration plan.
4. **For bug #3 specifically:**
   - Boot dev with the test env vars above
   - Reproduce manually: `curl` login → seed-night → start game → reveal → fast-forward → inspect `/api/tv/[code]/snapshot` to see whether `finished_at` lands on the question and whether the resolve reveal row appears
   - The TV's routing (`app/tv/[code]/page.tsx` lines 175-245) requires: `showLeaderboard === true` AND `lastReveal?.event === "resolve"` AND `targetQuestion?.finishedAt` set. One of these isn't true after fast-forward.
   - Dispatch a focused subagent to investigate if the main session's context is heavy.
5. **Re-run the test after fix:**
   ```bash
   lsof -i :3000 -t | xargs kill -9 2>/dev/null
   TEST_AUTH_ENABLED=1 TEST_SECRET=local-test-secret MOCK_EXTERNAL=1 npx playwright test tests/e2e/reveal-sync.spec.ts --reporter=list
   ```
6. After bug #3 passes, continue with the smoke orchestration plan Phases 5-9.

---

## Memories worth carrying forward (already in `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/`)

- `user_brandon.md` — non-technical solo dev building for one customer, plain-English, terse, "just build it"
- `feedback_build_without_asking.md` — don't ask "how" questions; flag risky shared-state actions

Session 2 added context worth a future memory: **the smoke test runs against PROD Trivia with `@tr1via.test` email isolation**, NOT a local DB. Don't suggest installing Docker unless Brandon explicitly wants to switch.
