# TR1VIA — Handoff

**Read order for a fresh session:** this file → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `supabase/README.md` (DB setup) → `README.md` (run instructions). The Claude Design package is at `/tmp/tr1via-design/tr1via/` (chats + JSX prototypes).

---

## State as of 2026-05-23 (afternoon)

**Live, deployed, working:**
- Repo: <https://github.com/Vyntechs/Tr1via.com> (main branch is canonical)
- 17+ commits today; all pushed.
- TypeScript build clean. **178/178 tests pass.** 30+ routes registered.
- **tr1via.com is live and auto-deploying from `main`** — every push triggers a fresh build (~28s) and serves within ~60s. Verified end-to-end.

**Production resources (canonical, what to use going forward):**
- Supabase project **Trivia** — ref `citweuctcnuxmqjxcbiz`. All 4 migrations applied (schema, RLS, Realtime, storage). 13 tables + `game_scores` view + `resolve_question` proc. Types generated from live schema and committed to `lib/supabase/types.ts`.
- Vercel project **tr1via** — id `prj_dsHB5DhLhWSuBBXDLCVT5JC7INO8`, in Brandon's personal Vercel account `brandon-nichols-projects-f7e6d2a9` (team id `team_pIz2bArnD9WKAfzxYWoPtvSd`). Git auto-deploy IS connected to `Vyntechs/Tr1via.com#main`. All 7 env vars set in dashboard: `PEXELS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SESSION_SECRET`, `NEXT_PUBLIC_SITE_URL`. Domain `tr1via.com` + `www.tr1via.com` attached.

**Two-Vercel-account note:** Brandon has two Vercel logins:
- `brandon-5701` (personal, `brandon.james.nichols@gmail.com`) — **the real account.** Owns tr1via.com + all domains. CLI on his laptop is logged in here. The `tr1via` project lives here. THIS is the source of truth.
- `thebrandonnichols-5376` (a separate team, `thebrandonnichols@gmail.com`, team id `team_X2HCfoLF0Us6hAsVbRfsgH9K`) — old account, MCP token happens to be wired here. Has a stale `talknndone` project from April 12 with env vars but no domain. Earlier HANDOFFs mistakenly documented this project; ignore it.

If you use the Vercel MCP, you'll only see the old `thebrandonnichols-5376` team. For accurate state, use the CLI (`vercel ls`, `vercel inspect`) from this repo — it's already linked to the real `tr1via` project via `.vercel/repo.json`.

**DO NOT TOUCH:**
- Supabase project **Vyntechs Auto** (ref `ynmtszuybeenjbigxdyl`). Different product, off-limits.
- Old/throwaway Vercel projects in the personal account: `talknndone`, `frontend`, `soulfire-trivia`, and ~15 UUID-named projects (all from earlier experiments). Brandon can delete these in the dashboard when convenient; they're not load-bearing.

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

**Phase 9 — Polish:** ✓ DONE
- 9.1 ✓ heightened finale weather
- 9.2 ✓ winner card PNG download
- 9.3 ✓ PalettePeek overlay + first-session auto-trigger + "Made it!" toast (`components/player/PalettePeek.tsx` + `PalettePeekProvider.tsx`)
- 9.4 ✓ keyboard nav 1/2/3/4 (`lib/hooks/useAnswerKeyboard.ts`); aria-live on lock/reveal screens; `usePrefersReducedMotion` honored by ParticleField
- 9.5 ✓ mid-game host edits — `RemovePlayerButton`, `AddLatecomerModal`, `AdjustPointsModal`; soft-delete + add-latecomer API routes

**Phase 10 — Error states + offline:**
- 10.1 ✓ EmptyState + Spinner atoms in `components/system/`; loading.tsx + not-found.tsx across host routes; top-level `app/not-found.tsx`
- 10.2 ✓ `useConnectionStatus` hook + ConnectionRibbon mounted in player layout; `useAnswerSubmit` with exponential-backoff retry replaces inline fetch in PlayerQuestion; visible "tap to retry" CTA after exhausted attempts
- 10.3 ✓ generation failure UI (`HostGenError` + `useGenerationStatus` 60s timeout / DB-polling safety net) wired into `HostSetupPickClient`; manual entry route at `/host/setup/[nightId]/pick/[categoryId]/manual` with `HostGenManualEntry` form (7 rows, order entered = 100..700 point values, source='host-edit'); inline Pexels lookup + upload error banners with retry/upload-alt actions in `HostGenImageSwap` + `HostGenImageUpload`. POST `/api/categories/[id]/manual` accepts 7 questions, wipes prior rows, inserts with `source='host-edit'`, flips category to 'ready'.

**Phase 11 — Deploy:** ✓ Git auto-deploy verified working; `tr1via.com` attached + serving fresh artifacts.

**What's NOT yet done (full smoke checklist):**
- End-to-end host flow: sign up → create night → add category → generate questions → open room → 2+ phones join → reveals → answers → resolve → leaderboard → intermission → game 2 → finale. (The pieces all work in isolation; needs a real-device manual run.)

---

## Memories worth carrying forward (already in `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/`)

- `user_brandon.md` — Brandon is non-technical, owns tr1via.com, builds for one real customer (his showcase project). Plain-English communication; terse; "just build it" style.
- `feedback_build_without_asking.md` — Don't ask Brandon "how should I build this" questions. Make every contextual technical decision yourself based on the design + plan. Only ask about product ambiguities or risky/destructive shared-state actions.

---

## How to resume

1. Phase 10.3 is committed (`feat(host): generation failure UI + manual entry + Pexels/upload error surfacing`). All 178 tests pass; TS clean.
2. Smoke-test the live site on tr1via.com — visit `/join`, `/host/login`, walk through the full host flow on a real laptop + 2 phones.
3. Optional cleanup: delete the throwaway Vercel projects listed under DO NOT TOUCH (Brandon does this in the dashboard).

Don't re-do any of the completed phases. The plan at `docs/superpowers/plans/2026-05-23-tr1via.md` is the authoritative scope.
