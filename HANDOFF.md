# TR1VIA — Handoff

**Read order for a fresh session:** this file → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `supabase/README.md` (DB setup) → `README.md` (run instructions). The Claude Design package is at `/tmp/tr1via-design/tr1via/` (chats + JSX prototypes).

---

## State as of 2026-05-23 (evening)

**Live, deployed, working:**
- Repo: <https://github.com/Vyntechs/Tr1via.com> (main branch is canonical)
- 19+ commits today; all pushed.
- TypeScript build clean. **178/178 tests pass.** ~40 routes registered (including the 7 `/dev/*` galleries).
- **tr1via.com is live and auto-deploying from `main`** — every push triggers a fresh build (~28s) and serves within ~60s. Verified end-to-end across 6+ pushes.
- All 11 phases of the build plan are now complete (Phases 0–10 plus the deploy verification in 11). What's left is a real-device smoke run.

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
- Dev galleries: `/dev` (index), `/dev/system`, `/dev/player`, `/dev/tv`, `/dev/host`, `/dev/host/gen`, `/dev/tv/lockin` — note: NOT `/_dev/*`. Next.js treats underscore-prefixed folders as private and excludes them from routing. Earlier HANDOFFs documented `/_dev/*` paths; those never worked.

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

**What's NOT yet done:**

1. **End-to-end smoke check on real devices** (the only material blocker before "launch"):
   - host laptop → /login (magic-link arrives in inbox?)
   - host onboarding → first night row created
   - host setup → pick a category → wait for Claude generation → if it fails, the new failure UI surfaces and the manual-entry route works
   - host opens room → TV shows lobby with QR + room code → 2+ phones scan, type names, see the lobby
   - host reveals → TV shows the question + the lock-in pile fills as phones tap → T+20 reveals correct/wrong on every surface in sync
   - intermission → game 2 → opt-in flow → finale → winner card + recap

2. **Nice-to-haves not in scope but worth flagging:**
   - The host-side "first-night-ever" celebration (`OnboardingFirstNightDone` exists but isn't wired to fire when the host finishes their first night). Player-side "Made it!" toast for the palette egg is done; this is the host counterpart.
   - Junk Vercel projects can be deleted in the dashboard (~15 UUID-named + `talknndone`, `frontend`, `soulfire-trivia`). Pure cleanup.
   - `next lint` is broken (Next 16 dropped `next lint`). Not a regression — would need either ESLint config + script update OR adopting Biome. Skip unless lint is blocking something.

---

## Memories worth carrying forward (already in `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/`)

- `user_brandon.md` — Brandon is non-technical, owns tr1via.com, builds for one real customer (his showcase project). Plain-English communication; terse; "just build it" style.
- `feedback_build_without_asking.md` — Don't ask Brandon "how should I build this" questions. Make every contextual technical decision yourself based on the design + plan. Only ask about product ambiguities or risky/destructive shared-state actions.

---

## How to resume

`git pull` then `npm install`. Then:

1. **Spot-check the live site.** Visit <https://tr1via.com> — should show the placeholder home with links to `/dev/system` (design canvas) and `/dev` (gallery index). Visit `/join` — should render PlayerJoin with the editable name field.
2. **Decide what's next with Brandon.** Likely candidates: the real-device smoke run (highest value, can't be done by Claude alone), the OnboardingFirstNightDone host wiring (small, isolated), or whatever surfaces from the smoke run.
3. **For Claude: don't re-do completed phases.** The build plan at `docs/superpowers/plans/2026-05-23-tr1via.md` is the authoritative scope; Phases 0–10 are all complete and tested. Always check `git log` and `npm test` before assuming anything's broken.

If Vercel feels off again: check `vercel ls tr1via` from the CLI (NOT the Vercel MCP — see Two-Vercel-account note above; the MCP sees the wrong team). The CLI is logged into Brandon's real account.
