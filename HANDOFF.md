# TR1VIA — Handoff

**Read order for a fresh session:** this file → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `supabase/README.md` (DB setup) → `README.md` (run instructions). The Claude Design package is at `/tmp/tr1via-design/tr1via/` (chats + JSX prototypes).

---

## State as of 2026-05-23

**Live, deployed, working:**
- Repo: <https://github.com/Vyntechs/Tr1via.com> (main branch is canonical)
- 11 commits today; all pushed.
- TypeScript build clean. 105/105 tests pass. 30+ routes registered.

**Live but unverified end-to-end:**
- Supabase project **Trivia** — ref `citweuctcnuxmqjxcbiz`. All 4 migrations applied (schema, RLS, Realtime, storage). 13 tables + `game_scores` view + `resolve_question` proc. Types generated from live schema and committed to `lib/supabase/types.ts`.
- Vercel project **tr1via** — slug `talknndone`, id `prj_dX5YFvxLjt3G1olYFj6rdec2jIr6`, team id `team_X2HCfoLF0Us6hAsVbRfsgH9K`. Env vars set in dashboard: `PEXELS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`. Most recent build artifact: from April 21 — recent "deploys" are all **redeploys of that stale artifact**, not fresh builds from `main`.

**DO NOT TOUCH:**
- Supabase project **Vyntechs Auto** (ref `ynmtszuybeenjbigxdyl`). Different product, off-limits.

---

## Immediate blocker

Vercel's git auto-deploy is NOT triggering on push. As of commit `aaafc35` (pushed 2026-05-23) the API still shows no git-driven deploys — only manual redeploys of the Apr 21 artifact.

**Check:** Vercel dashboard → tr1via → Settings → Git:
- Connected repo must be `Vyntechs/Tr1via.com`
- Production branch must be `main`
- If something is off, click Disconnect → Reconnect → pick `Vyntechs/Tr1via.com` → save

After fixing, push any commit (or run `npx vercel --prod` locally) to verify a fresh build runs. Build logs via MCP: `get_deployment_build_logs(idOrUrl, teamId)`.

Also check Settings → Domains — `tr1via.com` should be attached. The MCP showed only `*.vercel.app` URLs as of the last check.

---

## What's built (you don't need to rebuild any of this)

**Design system foundation:**
- `lib/theme/` — 14 themed palettes (house, daylight, jan-dec), generated to CSS vars by `__build__.ts`
- `components/system/` — Wordmark, Display, Eyebrow, Numeric, Rule, PointTag, AnswerCard (5 states), TimerRing, TVTimerArc, QRBlock (real qrcode), Weather (per-month microclimates), 9 motif glyphs, ParticleField
- `components/shells/` — PhoneScreen, PhoneHeader, TVStage, TVHeader, TVFooter, LaptopShell

**Static screens (all wired to live data via hooks):**
- `components/player/` (9): PlayerJoin, PlayerLobby, PlayerQuestion, PlayerLocked, PlayerRevealCorrect, PlayerRevealWrong, PlayerJoinGame2, PlayerWinnerCard, PlayerRecap
- `components/tv/` (8): TVLobby, TVGrid, TVQuestion (with live lock-in pile), TVReveal, TVRevealStumper, TVLeaderboard, TVIntermission, TVFinaleWinner
- `components/host/` (5 + 9 generation): HostPhoneUpcoming/Live, HostDashboard, HostSetupCategories, HostLiveConsole + 9 HostGen* screens
- `components/onboarding/` (2): OnboardingFirstDashboard, OnboardingFirstNightDone
- `components/tv/lockin/` — LockInBase + LockInPileUp

**Game logic (pure, fully tested):**
- `lib/game/scramble.ts` — deterministic per-(question, player) scramble via FNV-1a + Mulberry32 + Fisher-Yates
- `lib/game/score.ts` — face value + 5-sec speed bonus
- `lib/game/timer.ts` — server-timestamp-driven; client compensates for clock skew via the server's `now`
- `lib/game/room-code.ts` — 6-char ambiguity-free alphabet (31 chars, no 0/O/1/I/L)
- `lib/game/difficulty.ts` — assign 100..700 to 7 picked questions

**Database (Supabase):**
- `supabase/migrations/0001_init.sql` — full schema, view, stored proc
- `supabase/migrations/0002_rls.sql` — row-level security
- `supabase/migrations/0003_realtime.sql` — Postgres Changes publication
- `supabase/migrations/0004_storage.sql` — question-images bucket
- `supabase/seed.sql` — DEMO42 room with 6 categories of 7 real sample questions
- `lib/supabase/{client,server,admin}.ts` — typed clients (browser, server-RLS-aware, service-role)
- `lib/supabase/types.ts` — live-generated types with narrowed aliases for the JSONB columns

**Auth:**
- `app/(host)/login` — magic-link form
- `app/auth/callback` — OAuth code → session exchange
- `app/(host)/auth/onboarding-complete` — host row insert
- `middleware.ts` — protects `/host/*`
- `lib/auth/device-cookie.ts` — signed cookie helpers + 14 unit tests
- `app/api/session/init` — mints player device cookie

**Backend API (16+ routes):**
- `/api/nights/{[id]/open, [id]/close, by-code/[code]}` — host creates + manages a night
- `/api/games/[id]/{start, end, reveal, undo, end-early}` — the live-game state machine; reveal broadcasts on `room:{code}`
- `/api/players/{[id]/heartbeat, [id]/join-game}` — player presence + per-game opt-in
- `/api/answers` — submit with scramble anti-tamper check
- `/api/questions/[id]/{resolve, photo, photos}` — T+20 resolver + image swap
- `/api/categories/[id]/{generate, pick}` — Claude question generation (background job via `after()`) + assign 100..700
- `/api/questions/[id]` PATCH — host edits a question
- `/api/images/upload` — multipart upload to Supabase Storage
- `/api/adjustments`, `/api/topic-suggestions`, `/api/tv/[code]/snapshot`

**Routes:**
- Player: `/(player)/join`, `/(player)/room/[code]`, `/room/[code]/{won, recap}`
- TV: `/tv/[code]`
- Host laptop: `/host`, `/host/onboarding`, `/host/setup/[nightId]`, `/host/setup/[nightId]/topic`, `/host/setup/[nightId]/pick/[categoryId]`, `/host/live/[nightId]`
- Host phone: `/host/phone/[nightId]`
- Auth: `/login`, `/auth/callback`, `/auth/onboarding-complete`
- Dev galleries: `/_dev/system`, `/_dev/player`, `/_dev/tv`, `/_dev/host`, `/_dev/host/gen`, `/_dev/tv/lockin`

---

## What's still pending

**Phase 9 — Polish** (not done — agents were partly rejected mid-run):
- 9.1 ✓ heightened finale weather (verified)
- 9.2 ✓ winner card PNG download (html-to-image dep added; `PlayerWinnerCard` extended)
- 9.3 partial: `lib/hooks/useFiveTapEgg.ts` exists; still need PalettePeek overlay, first-night-ever trigger wiring, "Made it!" toast
- 9.4 not started: keyboard nav for AnswerCards (keys 1/2/3/4), aria-live announcer, reduced-motion audit
- 9.5 not started: mid-game host edits (remove player, add latecomer, expanded adjust-points modal)

**Phase 10 — Error states + offline** (not started):
- 10.1 EmptyState + Spinner atoms; audit every route's loading + not-found state
- 10.2 `useConnectionStatus` hook + ConnectionRibbon component; mount on player/TV/host-live; optimistic answer submit with exponential backoff retry
- 10.3 Generation failure UI + manual entry route at `/host/setup/[nightId]/pick/[categoryId]/manual`; Pexels/upload error surfacing

**Phase 11 — Deploy:**
- Verify the git auto-deploy actually works (CURRENT BLOCKER — see above)
- Verify `tr1via.com` domain is attached to the Vercel project
- Smoke checklist: host signs up → creates night → adds category → generates questions → opens room → 2+ phones join → reveals → answers → resolve → leaderboard → intermission → game 2 → finale

---

## Memories worth carrying forward (already in `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/`)

- `user_brandon.md` — Brandon is non-technical, owns tr1via.com, builds for one real customer (his showcase project). Plain-English communication; terse; "just build it" style.
- `feedback_build_without_asking.md` — Don't ask Brandon "how should I build this" questions. Make every contextual technical decision yourself based on the design + plan. Only ask about product ambiguities or risky/destructive shared-state actions.

---

## How to resume

1. Verify the git auto-deploy is working (push something, watch for a build from `main` in the Vercel deployments).
2. Once the auto-deploy works and `tr1via.com` serves a fresh build: smoke-test the host login flow on the live site.
3. Then knock out Phase 9 → 10 → final smoke checklist.

Don't re-do any of the completed phases. The plan at `docs/superpowers/plans/2026-05-23-tr1via.md` is the authoritative scope.
