# TR1VIA — Handoff

**Read order:** this → `MEMORY.md` (auto-memory) → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `supabase/README.md` (DB) → `README.md` (run). Prior handoff (session 5) is preserved in git history at `ca26374` — pull it up if you need pre-session-6 context.

---

## Critical context

**Wednesday 2026-05-27 is the real go-live.** Heather (`heatherhmoore@yahoo.com`) opens it that night to host actual trivia at her venue. NOT a demo — paying patrons. ~3 days from this handoff (Sun 2026-05-24 ~3pm).

**Session 6 (today, ~12pm–3pm) was the first end-to-end green game loop on prod, both via automated driver AND a real live game Brandon played.** PR #1 merged. Two new bugs surfaced from the live test — both P0 for next session.

---

## State as of end of session 6 (2026-05-24 ~3pm)

**Main commit tip:** the merge commit of PR #1 (https://github.com/Vyntechs/Tr1via.com/pull/1). Local main may need a `git pull origin main` to catch up.

**PR shipped + merged this session:** PR #1 — "TV view inline + full-game CI driver + test fixture parity." Three commits:
- `771c831` — `feat(scripts): add full-flow-prod.mjs end-to-end driver`
- `f0db778` — `refactor(tv): render TV view inline in host page, drop iframe`
- `43ffad8` — `fix(tests+ci): seed-night drives real endpoints + full-flow CI step`

**Prod state:** Vercel auto-deployed after merge. tr1via.com is at the merge commit.

**Test count:** 192/192 unit + component passing. TypeScript clean. All 4 Playwright e2e specs green with `--workers=1` (which is how CI runs them). New CI step runs `scripts/full-flow-prod.mjs` on every push to main (~80s, 3-min sub-timeout; job timeout bumped 5→8 min).

### What shipped in session 6

**`scripts/full-flow-prod.mjs`** — a Node fetch-based script that drives a complete 2-game night against tr1via.com over HTTP. 3 simulated phones (Alice/Bob/Carol) join the night, auto-opt into game 1, play 7 cells, end game 1, explicitly join game 2, play 7 more cells, end game 2. Asserts via Supabase admin: every answer row has `is_correct + awarded_points` after resolve, both games hit `state='done'`, cumulative leaderboard sorts Alice > Carol > Bob per the deterministic answer-strategy. ~80s green per run, ~5k tokens. Replaces the ~150k-token MCP browser walks we were doing.

**TV view inline in host page** — yesterday's iframe MVP is gone. New `components/tv/TVStateMachine.tsx` (pure component, takes a `TVSnapshot` prop, renders the right per-state TV view) + `lib/host/roomToTVSnapshot.ts` (pure adapter from `useRoom` data → `TVSnapshot`, no new fetches). `app/tv/[code]/page.tsx` shrunk from 697 to 143 LOC and just delegates to TVStateMachine. HostLiveConsole renders `<TVStateMachine />` inline inside a 16:9 wrapper. Bonus fix in `app/api/tv/[code]/snapshot/route.ts`: the live-question query used `.maybeSingle()` against questions across ALL rooms; switched to `.limit(50) + JS filter` so multi-room concurrency doesn't silently lose the live question.

**Test fixture parity** — `app/api/_test/seed-night/route.ts` no longer short-circuits. It now drives the real `/api/nights` + `/api/categories` + `/api/categories/[id]/manual` endpoints with a cookie jar threaded for auth (so refresh tokens don't break mid-sequence). Games stay in `'draft'` — same state a real host sees. `tests/e2e/auto-start-on-reveal.spec.ts` updated to match.

### What Brandon validated live in prod (post-merge)

- Played a 7-question game on tr1via.com via a real browser session.
- A second phone joined via QR — both phones sat at 2 LIVE in the players panel for at least part of the game.
- Game loop worked end-to-end on the happy path: reveals arrived on both surfaces, answers tapped, resolves landed, scoring tallied (Brandon's `Bnipps360` finished at 1,070 pts — 38% of max, with the 10% speed bonus applied).
- **Two real bugs surfaced** — see P0.32 + P0.33 below. Screenshot worth grabbing for the layout discussion.

---

## What is still broken — P0 for session 7

### P0.32 — Inline TV panel letterboxes + clips content

**Symptom (from Brandon's screenshot, taken on a Mac laptop running Safari):**
- TV panel is centered with ~25–30% of host-console width wasted on black bars left + right.
- TVQuestion's answer card (`"Cherry liqueur"`) is clipped at the bottom edge of the panel.
- Net effect: the surface that's supposed to be the audience focus is the most cramped element on the screen.

**Root cause:** today's `f0db778` wraps the inline TV in:
```css
width: min(100%, calc(62vh * 16/9));
maxHeight: 62vh;
aspect-ratio: 16/9;
```

On a 1080p host laptop, `62vh ≈ 670px`, and `62vh × 16/9 ≈ 1188px`. The host console is wider than 1188px, so the calc dominates and caps the TV stage at 1188×670. TVQuestion's layout was originally designed for a 100vw × 100vh stage; packed into 1188×670 the answer-card overflows vertically.

Two coupled problems: (a) panel is too narrow for the host page, (b) panel is too short for what the TV components want to render. Fixing only one won't get you there.

**Brandon's direction (quote):** "If you need more room, you can take it from other areas that aren't as important. Weigh the pros and cons."

**Fix options (ranked from least to most ambitious):**

a. **Raise the height cap** — `maxHeight: 80vh` or remove. Lets the TV grow taller, calc → wider TV. Risk: board below the fold; host has to scroll to tap the next cell.

b. **Drop `aspect-ratio` inside the panel, let it fill 100% width, letterbox internally.** TV components see a wider viewport, content scales up. Risk: components designed for 16:9 may misposition (e.g. the "TR1VIA · GAME 1 · COCKTAILS" header bar).

c. **(Recommended start)** **Collapse the QR + players sidebar.** Once players have joined, the QR code is mostly visual noise; the players list could become a collapsible side button or move to a bottom strip. Frees ~25–30% horizontal width for the TV panel — the same amount currently lost to black bars — and probably fixes the cropping without touching TV component internals.

d. **State-dependent TV panel size.** During an active reveal, the TV panel takes more of the screen (Brandon doesn't need to see the board mid-question); during `BOARD_READY` waiting, it shrinks and the board takes prominence. Most polished; arguably the right long-term answer. Higher implementation cost.

My recommendation: ship (c) first (small, mostly mechanical), then layer (d) on top if Brandon wants the polish. (a) is a quick try if you want to throw a one-line tweak at it before either.

### P0.33 — End-of-game has no winner / no leaderboard / no animation

**Symptom:** when the host plays all 7 cells of the only category in a game, the last question resolves, and then the screen says `"BOARD READY · WAITING / Tap a cell to reveal the next question"` — but every cell is spent. No winner card, no leaderboard transition, no animation. The host is stuck staring at an exhausted board.

**Root cause hypothesis (unverified — investigate first):**
- The host-page state machine doesn't watch for `questions.every(q => q.finished_at)` and trigger the game-end transition.
- OR the system relies on the host clicking an "End Game" button that doesn't auto-appear when the board is exhausted.
- `scripts/full-flow-prod.mjs` succeeds because IT calls `POST /api/games/[id]/end` explicitly after the loop. Real hosts have no script.

**Fix shape:**
1. Detect "all picked questions in all categories of this game are finished" in `useRoom` or `HostLiveConsoleClient`.
2. When true, either auto-call `/api/games/[id]/end` OR surface a prominent "End Game" CTA (probably the latter — auto-end without host control could feel jarring if they wanted to recap).
3. Trigger the TV state machine's leaderboard / winner / intermission state on game-end.
4. **Extend `scripts/full-flow-prod.mjs`** to remove the explicit `/end` call and instead poll for `game.state === 'done'` on its own — that's the regression test. Without this step, the same bug class can re-emerge.

---

## Carryover from prior session (still applicable)

### Closed in session 6
- ✅ **P0.26** — Proper TV extraction (shipped in `f0db778`).
- ✅ **P0.27** — Test fixture / prod divergence + full-flow CI step (shipped in `43ffad8`).
- ✅ **Game-2 + intermission coverage in driver** (shipped in `771c831`).

### Still open (from session 5 HANDOFF)
- **P1.28** — 10 deferred small items: pick-tier tie-break disagrees client↔server (lock query has no ORDER BY); `HostGenEdit` / `HostGenImageSwap` / `HostGenImageUpload` / `HostGenFlavor` show placeholder StockImage; `TVReveal` doesn't show the image (only `TVQuestion` got it); 1/20 generated cards doesn't render on pick screen; `default_venue` null → "Soul Fire Pizza" leak in `app/host/page.tsx:121`; `auto-start-on-reveal.spec.ts` should land in CI smoke pipeline; theme broadcast for live repaint; "Open audience vote" + "Suggested by the room" tiles may be dead UI.
- **P1.29** — Venue-condition hardening: 10–30 phones on real wifi, iOS Safari quirks (visibilitychange, touch coverage, viewport).
- **P1.30** — Ties / no-leader / all-zeros leaderboard.
- **P2.31** — Polish: phone-side fold/send animation, TVReveal image, lock-in pile-up polish.

### Untested by a real human (driver tests these, Brandon hasn't)
- Game 1 → intermission → game 2 → finale on real phones.
- Multi-category in one game (today's live test was 1 category).
- 3+ phones simultaneously (today's live test was effectively 1-2).
- Theme change mid-game.

---

## How to resume — IMPORTANT

### Step 1: align with Brandon on the P0.32 layout option

This is product/UX territory, not pure engineering. Show him the 4 options above (or open Brandon's screenshot and walk through them). Likely answer: (c) collapse the QR/players sidebar.

### Step 2: ship P0.32

Mostly mechanical once the option is picked. Verify by running `npm run dev`, opening a host session, getting to a live question, confirming the TV panel fills the freed space without clipping.

### Step 3: ship P0.33

Trace `useRoom` for the "all questions done" signal. Add detection + surface End Game CTA + trigger TV leaderboard state. Extend `scripts/full-flow-prod.mjs` to drop the explicit `/end` call — that locks the regression. Re-run driver; should still go green via auto-end.

### Step 4: PR

PR-first workflow per [[feedback-pr-workflow]]. Plain English, pre-validated checklist, one explicit "please put your eyes on this" item.

### Step 5: re-validate live

Brandon does the same 2-phone test he did today. Confirm both fixes. If green, merge. Heather goes live in 2 days from then.

### Resumption prompt to paste into the next session

```
Read HANDOFF.md and /Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/MEMORY.md.

Heather (heatherhmoore@yahoo.com) goes live on tr1via.com Wednesday 2026-05-27.

Last session shipped PR #1 (TV view inline + full-game CI driver + test fixture parity). All merged. Brandon validated with a real game and two P0 bugs surfaced:

1. P0.32 — Inline TV panel clips content. CSS aspect-ratio + 62vh height cap leaves ~30% black bars on a 1080p host laptop and clips TVQuestion's answer card at the bottom. 4 options ranked in HANDOFF; (c) — collapse the QR/players sidebar — is the recommended start. Needs a Brandon decision before coding.

2. P0.33 — When all cells of the only category in a game resolve, the screen says "tap a cell to reveal the next question" but every cell is spent. No winner / leaderboard / animation. Auto-end detection is missing. Driver succeeds today because it calls /api/games/[id]/end explicitly. Fix: detect questions.every(q => q.finished_at), surface End Game CTA, trigger TV leaderboard state. THEN extend scripts/full-flow-prod.mjs to remove the explicit /end call — that's the regression lock.

Workflow:
- PR-first; never push to main directly ([[feedback-pr-workflow]]).
- Plain-English PR descriptions for Brandon (non-technical).
- Pre-validate everything you can before opening; list the one human-eye check.
- Use scripts/full-flow-prod.mjs ([[project-full-flow-driver]]) for repeat validation; extend rather than replace.
- Brandon's screenshot from session 6 documents the bugs visually — reference it.

Start by reading HANDOFF "P0.32" + "P0.33" sections in full, then ask Brandon to pick a P0.32 layout option.
```

---

## Architectural lessons added this session

26. **CSS `aspect-ratio` + `max-height` is a width trap.** `width: min(100%, calc(62vh * 16/9))` looks right on paper but on a viewport that's wider than ~110vh, it shrinks the surface below the available space. Picking the largest 16:9 rect that fits a 62vh height ceiling is NOT the same as picking the largest 16:9 rect the user can see. When embedding a fixed-ratio surface in a fluid layout, decide which axis is the binding constraint and bias toward filling THAT — don't try to satisfy both ratio + height cap simultaneously.

27. **End-of-game state must be data-driven, not host-action-driven.** The full-flow driver passed because it called `/end` explicitly. Real hosts have no script — they reveal the last question, see it resolve, and... wait. The host page needs to detect `questions.every(q => q.finished_at)` and surface (or trigger) the end-of-game action. Driver-as-truth tests can hide host-UX gaps because the driver always knows what to do next; a real human doesn't.

28. **2 humans found 2 bugs in 7 minutes that 14 automated reveals across 2 games did not.** The driver validates plumbing; it does NOT validate UX. Going forward, every UI-changing PR needs the 5-minute human-eye check that PR #1 deferred to merge time. Brandon's screenshot is a model of how to surface UI bugs in <10 seconds of attention — keep that as the regression-reporting format.

---

## Files / artifacts from session 6 worth keeping

- `scripts/full-flow-prod.mjs` — extend, don't replace.
- `lib/host/roomToTVSnapshot.ts` — pure adapter; reusable pattern for any other place that needs to convert host-side room state into TV-side snapshot shape.
- `components/tv/TVStateMachine.tsx` — pure state-machine component; the single source of truth for "which TV view should render right now."
- Brandon's screenshot showing both P0 bugs (worth attaching to the P0.32 design discussion if you can re-grab it).

---

## Memories (auto-memory) — current snapshot

All in `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/`:

- `user_brandon.md` — non-technical solo dev; terse; "build without asking" style.
- `feedback_build_without_asking.md` — commit to engineering decisions; only ask about product intent.
- `feedback_validate_dont_just_claim.md` — drive the actual user-visible flow before claiming fixed.
- `feedback_token_efficiency.md` — scripts over MCP for repeat E2E.
- `feedback_heather_real_customer.md` — Wednesday is a real go-live.
- `feedback_pr_workflow.md` — PR-first; plain-English description; pre-validate; one explicit human-eye check (added session 6).
- `project_test_isolation.md` — smoke against PROD Supabase with @tr1via.test allowlist.
- `project_realtime_anon_key.md` — JWT env var newline trap.
- `project_full_flow_driver.md` — `scripts/full-flow-prod.mjs` is the canonical prod E2E driver (added session 6).
