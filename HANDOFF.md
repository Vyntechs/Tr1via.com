# TR1VIA — Handoff (end of session 9, 2026-05-24 late night)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs live in git history (session 7 at `4f889c8`; session 8 was never committed but its content was rolled into this file early in session 9).

---

## Critical context

**Heather (`heatherhmoore@yahoo.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons, not a demo. **3 days out.**

🚨 **PRs #10 and #11 merged but NOT yet validated end-to-end on prod.** Brandon merged at the end of the session and stopped before retesting. Next session's first action should be a full single-player walk-through on tr1via.com to confirm the two bugs actually went away.

---

## What shipped tonight (session 9, all merged to main)

| PR | What | Status |
|---|---|---|
| #9  | `fix(gen)`: every option must be a direct answer to the prompt — explicit "same kind of thing the prompt asks for" rule in `SYSTEM_PROMPT` with the real prod Patronus failure as the negative example | merged |
| #10 | `fix(recap)`: stop rendering "#0" while game_scores loads + null-rank fallback — tri-state `scores`, postgres_changes subscription, `PlayerRecap` renders "Nice run." instead of "#0" when player isn't in the view | merged |
| #11 | `fix(host-reveal)`: keep answers loaded for sticky-reveal frame — host's `answers` subscription was clearing on resolve, causing TV to show "Nobody nailed this one" / "0 of N got it" even when players got it right | merged |
| #13 | `fix(theme)`: swap layout default `house` → `daylight` (this PR also brings these handoff notes) — stopgap for "dark dark dark" default. Real picker work still pending. | this PR |

Brandon's observed bugs that drove the night:
- Host TV at reveal: "0 of 1 got it" / "Nobody nailed this one" when a player HAD answered correctly → PR #11
- Phone post-game wrap-up: "You finished #0" → PR #10 (tested on preview before build deployed; needs prod retest)
- Earlier in night: Claude generating questions whose options weren't actually candidate answers → PR #9

---

## What's still open

### 1. 🚨 P0: Validate PRs #10 + #11 on prod (FIRST thing next session)

Walk through a single-player game on **tr1via.com** (host + one phone in another window) and confirm:

- **Host TV reveal** shows "1 of 1 got it" with the player's name in the fastest-five — NOT "Nobody nailed this one" — when the player answered correctly. This is PR #11.
- **Phone post-game wrap-up** shows a real rank like "#1" — NOT "#0", NOT "Nice run." — when the player is in `game_scores`. This is PR #10.

If either still shows the broken state on a fresh prod build:
- PR #11 broken: dig into `HostLiveConsoleClient.tsx` answer-target effect; `roomToTVSnapshot.ts` already does the right fallback so check the host adapter wiring.
- PR #10 broken: check the recap page's tri-state guard + the postgres_changes subscription. Confirm the Vercel preview build hash matches the merge commit before assuming code fault.

Token-efficient path: extend `scripts/full-flow-prod.mjs` to assert both states via API + Supabase MCP queries.

### 2. 🚨 P0: Dead-state picker between sections — option B chosen, click behavior PENDING

Brandon's complaint: "After there's no more questions in a section, why does it just sit there? Why not either go ahead and bring up the next topic or a selection to select the next topic that's already been generated."

He picked **option B**: panel listing the remaining locked topics. Host taps one → that topic activates.

**Pending product decision Brandon didn't get to answer:** when host taps a topic from the panel, should it…

- **(a)** Auto-start that topic's lowest-points question (one tap → game on)
- **(b)** Reveal the grid focused on that column so host still picks a specific question
- **(c)** Hybrid — auto-start lowest, with a "switch question" override

My recommendation: **(a)** for live-event simplicity. Get Brandon's call before building.

Files likely involved:
- `lib/host/deriveHostMode.ts` — add a "section-ended-picking-next" mode triggered when the just-resolved question was the last in its category and other categories still have un-played questions.
- `components/tv/TVStateMachine.tsx` — new state branch.
- `components/host/HostLiveConsole.tsx` — wires the panel into the host UI.

Last-section completing → existing "End Game →" CTA (PR #3 already builds this).

### 3. 🚨 P0: In-game "#0" rank on every reveal

`app/(player)/room/[code]/page.tsx:687,709` hardcodes `rank={0}` for `PlayerRevealCorrect` and `PlayerRevealWrong` with a `"// Rank deferred until we wire game_scores into the page."` comment. Players see "#0" on their phones after EVERY question, not just at end-of-game.

Fix: mirror the load+subscribe pattern from PR #10's recap fix. Fetch `game_scores` for the current game with a postgres_changes subscription, sort by score desc, compute the player's index + 1 for `rank`. `rankDelta` is bonus — compare to previous rank between reveals; if it's a stretch, ship rank=0 delta for now and polish later.

This was almost started in session 9 but Brandon called for handoff before the first edit.

### 4. P1: Theming — "set and find without instructions" + "why always defaulted"

Two distinct root causes, one shared "themes are painful" symptom:

**Why always defaulted:** `app/layout.tsx` wraps the entire app in `<ThemeProvider themeKey="…">`. Only per-night routes (`/host/setup/[nightId]`, player room, recap) wrap a CHILD `ThemeProvider` with `nights.theme_key` to override. Non-night routes (`/host/library`, `/host/settings`, `/host/themes`, `/host/admin`, etc.) inherit the layout default and never override. There is **no per-host theme storage** — even if you pick a theme on one night, it doesn't carry to non-night routes or to other nights.

**Why the picker is painful to find:** the actual picker is a tiny pill button at the bottom-right of `/host/setup/[nightId]` (`HostSetupOverviewClient.tsx:141-168`, reads "Theme · house") that opens a `PalettePeek` overlay. The dedicated `/host/themes` route is literally a "Coming Soon" stub (`app/host/themes/page.tsx`, 11 lines). Unless you remember the pill exists, you can't change it from anywhere else.

**Done in PR #13 (this PR):** default theme swapped from `house` (warm-dark) → `daylight` (its lighter sibling — paper #F4E6C4, ink #1B130C). One-line stopgap in `app/layout.tsx`; doesn't fix the architecture but immediately lifts the "dark dark dark" first-load feel everywhere the per-night override doesn't kick in.

**Still pending — the real fix:**
- Add `hosts.default_theme_key` column (~30 lines + migration). Wraps `<ThemeProvider>` at the host layout level using this column.
- Convert `/host/themes` from stub into a full theme grid that reuses `components/shared/PalettePeek.tsx` and saves to `hosts.default_theme_key` (~80 lines).
- Optional: thread `tonight?.themeKey` through `app/host/page.tsx` → `HostDashboard` if you want the dashboard to reflect the next night's theme specifically.

Brandon also floated **auto-by-date theming** (e.g. October theme in October). Cute feature. Park past Wednesday.

### 5. 🆕 P1: Player phone needs the question + photo during gameplay

Right now the phone shows only the four tappable option cards. Players have to read the TV for the question text — fine in a venue, awkward when a player is looking at their phone. Brandon's brief verbatim: *"add the question and picture to the user's phone UI as they're playing. Don't just slam it on there. Plan it, make it look nice. It's user-facing. Also maybe a small little window to show that same little picture that was attached to it during the question generation process just as it does on the host side that's plugged into the TV."*

Files involved:
- `components/player/PlayerQuestion.tsx` — current option-card layout; needs a question/photo zone above or alongside.
- `app/(player)/room/[code]/page.tsx:418-559` (`QuestionView`) — already passes `question.options` to PlayerQuestion; needs to also pass `question.prompt` + `question.image_url` (already in the snapshot).
- Same data the TV already renders via `TVQuestion` — `imageUrl`, `prompt`. No new fetches needed.

Design considerations Brandon called out:
- Don't just bolt it on — proper hierarchy with the question text given primary weight; image as a small thumbnail-ish window, not full-bleed.
- Must stay readable under a 20-second timer at the top of the screen.
- Phone real estate is tight; option cards already dominate the lower half. The image probably wants to be ~80-100px square next to the question text rather than its own full row.

**Use the brainstorming skill before building.** This is creative work with multiple valid layouts, and Brandon explicitly asked for a planned design rather than a slam-in.

### 5. P2: Anthropic gen monitoring

If gen failures resurface:
```bash
vercel logs --environment production --since 1d --query "generateQuestions" --json --no-branch
```
Tonight's logs showed normal calls completing in 18-21s under the 60s timeout.

---

## Workflow rules (non-negotiable on this project)

- **PR-first always.** Never push to `main`. Even docs.
- **Validate on PROD or the Vercel PREVIEW, never local.**
- **One step at a time.** Tight single-action instructions. No 4-option questions on obvious calls.
- **Drive the actual flow before claiming "fixed."** Use the `verify` skill or `scripts/full-flow-prod.mjs`.
- **Build without asking when spec + design exist.** Ask only on product/intent ambiguities (e.g. the picker click behavior above).
- **Cross-check log inference.** Don't infer cause from Supabase timing alone; pull Vercel function logs.

---

## Recurring pattern worth remembering: load + subscribe

PRs #10 and #11 both surfaced the same SHAPE of bug — a `useEffect` subscription gated on a state field (`finalGame`, `room.currentQuestion`) that becomes stale during a state transition. Fix in both cases: widen the target with a fallback (tri-state `scores` for "not loaded yet"; `room.currentQuestion ?? room.lastResolvedQuestion` for the sticky-reveal window).

The in-game `#0` rank (open item 3) is the SAME pattern — the player room page never wired up `game_scores` at all. When you fix it, also grep the codebase for other surfaces that display `rank` and audit whether they have the same gap.

---

## Tools confirmed working on this project

- **`vercel logs`** (CLI) with `--no-branch --since 1d --query "<text>" --json` — Vercel MCP returns 403, the CLI is the workaround.
- **Supabase MCP** — `mcp__plugin_supabase_supabase__execute_sql` + `get_logs`. Project id: `citweuctcnuxmqjxcbiz`.
- **Playwright MCP** — works against `tr1via.com` and preview deploys. Vercel SSO disabled.
- **Founder bypass login** — `/login` → `brandon@vyntechs.com` → Send → immediate redirect to `/host`. No email needed.
- **`scripts/full-flow-prod.mjs`** — drives a full 2-game lifecycle in ~80s against tr1via.com.
- **`gh pr create`** / **`gh pr view`** — used for every PR this session.

---

## Working-dir cruft Brandon may want to clean up

These accumulated across sessions but aren't tracked:

- `.playwright-mcp/`, `.tmp-smoke-shots/` — Playwright/scratch dirs (probably `.gitignore` candidates)
- `VERIFY-2026-05-24.md` — earlier session-8 verification notes
- 11x `verify-*.png` — screenshot captures from PR verification runs

None blocking; trim or `.gitignore` next session if it bothers you.

---

## Resumption prompt

Just say "**read HANDOFF.md and continue**" — this file plus auto-loaded memory will have everything needed. If you have a specific bug, lead with the observable symptom (URL + what you see) and let the next session pull logs/code.
