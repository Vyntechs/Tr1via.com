# TR1VIA — Handoff (end of session 14, 2026-05-25 late evening)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs in git history (session 13 close at `94cb045`, session 12 at `e3ebb93`).

---

## Critical context

**Heather (`heatherhmoore@yahoo.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons. **~36 hours out.**

**Brandon is mid-test-game** with 3 real-friend players (Brhae, Bnipps360, BennettBloxx) on Heather's room `YU5JF3`, night `52feb7b4-3e3a-4286-839e-74bceea030f0`. As of session-14 close he was partway through Game 1 (≥ 9 of 42 answered, one full category cleared). PR #33 was opened mid-game to fix the next thing he hit.

---

## What shipped this session (session 14)

| PR | What | Status |
|---|---|---|
| #33 | `feat(host)`: section-end cinematic + restore Jeopardy grid as picker (incl. extended full-flow script) | **awaiting Brandon's merge** |

**The story:** Brandon noticed during his test game that after completing all 7 questions of a topic, the host was being forced into a "Pick the next topic" tile picker that auto-started the lowest-points question in whatever topic was tapped. Heather would have lost her ability to pick a specific question by point value. He flagged it; PR #33 replaces that screen with a brief 1.8-second cinematic overlay that fades into the full Jeopardy grid (the same one she sees at the start of a game), with the just-completed topic's row visually marked cleared. She picks any cell, any topic, any point value — exactly like the start of a game.

**Implementation:**
- New `components/tv/TVSectionComplete.tsx` — full-bleed overlay, topic-color flood, big topic name, 1.8 s animated beat. CSS keyframes only, no new deps. Respects `prefers-reduced-motion`.
- New `lib/hooks/useSectionCompleteCelebration.ts` — fires when the most-recently-finished picked question completes a category AND other categories still have unplayed picked questions. Skipped for the last-category-of-game case (`canEndGame` handles that). 1.8 s self-clearing window, deduped by question id, owns its own timer.
- `components/tv/TVStateMachine.tsx` — post-resolve picking state always renders the Jeopardy grid now. Section-ended branch + helper removed.
- `components/host/HostLiveConsole.tsx` + `app/tv/[code]/page.tsx` — mount the overlay alongside the state machine.
- `lib/host/deriveHostMode.ts` — `inSectionPicker` flag dropped.
- Deleted: `components/tv/TVSectionEndedPicker.tsx`.

**Spec:** `docs/superpowers/specs/2026-05-25-section-end-cinematic.md` (on `feat-section-end-cinematic`, commit `fcdedb5`).

**Unit tests:** 247/247 pass. 8 new on `useSectionCompleteCelebration`. `deriveHostMode.test.ts` updated.

**Validation script extended.** `scripts/full-flow-prod.mjs` now plays **multiple categories per game** by default (configurable via `CATEGORIES_PER_GAME=N`) and asserts the section-complete predicate at every category boundary plus intermission and finale state transitions. The predicate is a JS replica of the React hook's `pickCelebration` logic, so a refactor that silently breaks the trigger surfaces here as a red exit. **Ran green end-to-end against prod in 169 s, every step including both section-complete fires AND the correctly-suppressed end-of-game cases.**

```bash
node --env-file=.env.local scripts/full-flow-prod.mjs           # 2 cats/game, ~3 min runtime + gen
CATEGORIES_PER_GAME=1 node --env-file=.env.local scripts/full-flow-prod.mjs   # 1 cat/game, faster, no section-complete coverage
```

**Run this before every prod merge that touches game flow.** It's the single most-useful tool Brandon has for catching regressions before Heather hits them.

---

## 🚨 P0 for session 15 — Brandon's call: **build the full browser-driven validation pipeline first**

Brandon's framing: "I don't want to be validating this where I'm shooting myself in the foot because it's set up not to work end-to-end. As a host, as player, players — there's got to be a way you can efficiently do this for accuracy to know it's going to work 100%."

The session-14 validator (`scripts/full-flow-prod.mjs`) is **API-level** — it drives the host via HTTP and asserts DB state. It catches a class of regressions but **doesn't render any UI** and doesn't drive players through a real Supabase Realtime WebSocket. Heather's actual experience is browser-rendered, which is where the bugs Brandon has been hitting all session live.

### P0.1 — Browser-driven end-to-end validator

**Build a Playwright-driven harness that runs against prod with isolation:**

- 1 host browser (founder login → mid-game host laptop UI driving real `/api/games/...` calls via the actual buttons).
- 3 player browsers (real device cookies, real WebSocket subscriptions, real `useRoom` snapshot, real answer submissions through the UI).
- Plays a full 2-category × 2-game night.
- Asserts on each surface at every transition: TV shows the right view (lobby/grid/question/reveal/section-complete/intermission/finale), player phones show the right view (lobby/question/lock-in/reveal/standings), scores match the leaderboard.
- Asserts the **section-complete overlay actually renders** on both host laptop and standalone TV after a category clears (the API-level validator only checks the predicate, not the DOM).
- Creates a "Full Flow Driver" night and cleans up via cascade delete on exit.
- Targets: under 10 minutes runtime, exit 0 = green / exit 1 = print the surface + selector + screenshot of the failure.

**Pair with the existing API validator** so Brandon has fast (3 min, no UI) + thorough (~10 min, full browser) modes. Run the browser one before every prod merge, the API one on every commit.

**Implementation notes for whoever builds it:**
- Playwright is already a devDep (`@playwright/test ^1.49.0`) — see `tests/e2e/` if there's anything existing.
- The current `scripts/full-flow-prod.mjs` has the full API protocol mapped out (founder bypass login, session init, players join, reveal, end-early, end-game, game 2, etc.) — port the action sequence, replace API calls with UI clicks.
- Players need separate browser contexts (own cookies) — Playwright `browser.newContext()` per phone.
- Realtime assertions: wait for the TV's `data-testid` to match the expected view after each host action; on a player phone, wait for the question to appear after host reveals.
- Add to `package.json`: `test:e2e:full-flow` script that runs it.
- Add to PR template / pre-merge checklist: "ran `npm run test:e2e:full-flow` against preview/prod, green."

**This unblocks Brandon shipping anything else with confidence.** He stops being the QA.

### P0.2 — Player-side persistence gaps (the 15 from session 14 research)

During session 14 Brandon reported **player phones sometimes lock up** and a hard refresh fixes them, missing 1–2 questions during the refresh. A parallel research agent enumerated 15 concrete gaps in three clusters:

- **A — No refetch on tab focus or network reconnect** (iOS Safari lock-up pattern). Highest-impact. Fix: add `visibilitychange` + `online` listeners that call the existing `bootstrap()` + `refreshLiveState()` in `app/(player)/room/[code]/page.tsx`.
- **B — `postgres_changes` silently dropped for device-cookie players** (the PR #31 family). `answers.is_correct` flips, `game_scores`, `games.state → game-ended`, and `players` kicks all rely on it. Mitigation: hook `.subscribe()` status callbacks in `useRoom.ts` so a dead channel triggers a re-bootstrap, OR route these fields through `/api/nights/by-code`-style server endpoints.
- **C — Ephemeral state lost on refresh** — `useAnswerSubmit` retry chains die with the page (no localStorage queue), `serverNowMs` clock skew resets, optimistic answers lost.

**Plus a missed `hosts!inner` from PR #31:** `lib/hooks/useRoom.ts:188-190` still has it in the initial `nights` bootstrap. One-line follow-up.

**Recommended order once P0.1 is in:** A first (single biggest win), then the `hosts!inner` cleanup, then B's high-traffic events, then C as polish. The browser-driven validator from P0.1 will catch any regression in these fixes.

### P0.3 — Finish Brandon's test game

Mid-flow at session-14 close. After PR #33 merged and prod deployed, friends hard-refresh their phones, Brandon picks the next cell from the restored Jeopardy grid, the cinematic plays when the next section clears.

---

## Open work (after the test game settles)

### P1: Multi-night planning dashboard (branch `wip-host-multi-night-dashboard`)

Brandon's session-13 ask. WIP commit `9e02540`. Doesn't typecheck on its own — needs `fetchPickCountByNight`, `hasAnyNight` prop wired through `HostHomeClient`, and the `HostDashboard` UI changes (drafts list + always-visible "+ Plan a new night" button).

### P1: "Room" → "Game" copy rename (no branch yet)

Brandon: "can we not refer to it as room and just refer to it as game?" ~40 user-visible strings. **Don't rename:** `room_code` column, `formatRoomCode` helper, `/api/nights/by-code` route, or internal types. **Keep "the room" untouched** when it refers to the physical venue. Inventory grep: `grep -rn '"room\|"Room\|"ROOM\|in the room\|Room code\|ROOM CODE\|Open the room\|Join the room\|JOIN A ROOM' app/ components/`.

### P1: PR G2 (rename a locked category) — WIP from session 12

Spec: `docs/superpowers/specs/2026-05-25-pr-g2-rename-category.md` on branch `docs-spec-g2-rename-category`. WIP commit `493307b` on `feat-rename-category`. Mid-edit on `HostGenPick.tsx` (references undefined `EditableTopicEyebrow`, typecheck fails). Heather will hit "I can't rename a locked category" Wednesday if not shipped.

### P2: PR G3 (write your own custom question) — spec only

Spec: `docs/superpowers/specs/2026-05-25-pr-g3-custom-question.md`. Not blocking Wednesday but Heather wanted it.

### P3: Working-dir cleanup

`git status` shows ~50 untracked validation screenshots from sessions 11–14 (`validate-*.png`, `verify-*.png`, `smoke-*.png`, `pr-*.png`, `pr33-section-complete-overlay.png`). Either gitignore the patterns or just `rm` them.

### P4: `npm run lint` broken on main

`next lint` was removed in Next 16. Replace with `eslint .` in a small chore PR.

---

## Auth model — unchanged

Sign-in is `type email → in`. No magic links. `/host/admin → SEND A SIGN-IN LINK` for cross-device. Memory: `project_auth_model_type_email_in.md`, `feedback_no_friction_without_security_gain.md`.

---

## Tools confirmed working (session 14)

- **Extended `scripts/full-flow-prod.mjs`** — multi-category support, section-complete predicate assertions, intermission/finale checks. Creates an isolated test night and cleans up via cascade delete. **The primary validation tool.** Green in 169 s against prod tonight. Run before every prod merge.
- **Parallel `general-purpose` agents for diagnostic research** — used to map the 15 player-persistence gaps + diagnose the section-complete routing in a single round-trip. Brandon endorsed this pattern in session 13.
- **Vercel preview URLs are unauthenticated for this project** — verified by hitting `/dev/tv` on the PR #33 preview directly via Playwright MCP without any token.
- **`/dev/tv` gallery** — frame 7 is now `TVSectionComplete` layered over `TVGrid` with `staticHold`. Designer-friendly preview, used to verify the overlay renders correctly before merge.

---

## Schema state on prod (unchanged from session 13)

```
hosts.default_theme_key  text  NOT NULL  default 'daylight'
nights.theme_key         text  NULL      no default
categories.name          text  NOT NULL  (host-renamable post-G2)
categories.topic         text  NOT NULL  (Claude prompt; immutable post-generation)
questions.point_value    smallint  null allowed
```

No schema changes in session 14.

---

## Workflow rules (non-negotiable, unchanged)

- **PR-first always.** Never push to `main`. Brandon merges; Claude opens.
- **Validate everything contextually possible BEFORE handoff.** Drive the actual user flow on the preview (or via `scripts/full-flow-prod.mjs`) before claiming done. PR #30 shipped without a player-side preview test and missed the bigger bug; session 14 extended the validation script to catch this class of regression automatically.
- **For player-side Supabase failures, pull `get_logs` type `api` first.** Vercel logs lie because the failing request is browser→Supabase direct. See `reference_supabase_api_logs.md`.
- **When a shipped fix doesn't land, dispatch two parallel research agents** (code-search + logs) before re-hypothesizing. See `feedback_parallel_research_agents.md`.
- **Don't ask permission for engineering decisions when a spec + design exist.** Do ask for product/intent ambiguities.
- **Brandon's customer is non-technical.** Plain English in PR descriptions + customer-facing copy. No jargon.
- **Migrations: apply via MCP, don't touch other projects.** Trivia id: `citweuctcnuxmqjxcbiz`. NEVER touch `ynmtszuybeenjbigxdyl` (Vyntechs Auto) or `vggftauiaplktwnwciey` (lurnt-discovery).
- **Never inner-join `hosts` from a player-side query.** See `project_rls_hosts_inner_trap.md`. **One spot still leaks** (`useRoom.ts:188-190`) — listed in P0.

---

## Resumption prompt for session 15

After `/clear`, type:

> **read HANDOFF.md and build the full browser-driven end-to-end validation pipeline. 1 host browser + 3 player browsers, real Supabase Realtime, asserts the UI on every surface at every transition. Pair it with `scripts/full-flow-prod.mjs`. Runs against prod with isolation, under 10 minutes, exit 0 / exit 1 with failure screenshot. Goal: zero manual QA before Heather's Wednesday go-live.**

That plus auto-loaded memory will reorient.

The first move on a clean start: skim `scripts/full-flow-prod.mjs` (the API protocol is mapped out there), check `tests/e2e/` for any existing Playwright scaffold, then plan the browser harness via the brainstorming skill BEFORE writing code. Don't commit anything until the plan is approved.
