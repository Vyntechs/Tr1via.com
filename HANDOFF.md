# TR1VIA — Handoff (end of session 13, 2026-05-25 late evening)

**Next session: read this → `MEMORY.md` (auto-loaded) → `tr1via-plan.md` → `supabase/README.md` → `README.md`.** Prior session handoffs live in git history (session 12 close at `e3ebb93`, session 11 at `a408275`).

---

## Critical context

**Heather (`heatherhmoore@yahoo.com`) goes live on tr1via.com Wednesday 2026-05-27.** Real paying patrons. **1 day out.**

**Brandon is mid-test-game right now with 3 real-friend players (Brhae, Bnipps360, BennettBloxx)** on Heather's room `YU5JF3` (Soul Fire Pizza, night `52feb7b4-3e3a-4286-839e-74bceea030f0`). The game was unblocked twice tonight — see "What shipped" below. Heather is signed in on her own account with all her Wednesday prep visible.

---

## What shipped this session (session 13)

| PR | What | Status |
|---|---|---|
| #28 | `feat(auth)`: passwordless instant-email-login from session 12 | **merged** by Brandon |
| #30 | `fix(player)`: defer /room/[code] queries until device session ready | **merged** — fixed a real race but didn't fix Heather's actual symptom |
| #31 | `fix(player)`: drop `hosts!inner` join that 406'd every player room load | **mergeable, awaiting Brandon's merge** — this is the real fix |

**Data actions on prod Supabase (Trivia, `citweuctcnuxmqjxcbiz`):**
- Cloned night `655995cb…` (Heather's WIP under Brandon's host_id) → `52feb7b4-3e3a-4286-839e-74bceea030f0` under Heather's host_id (`772f91c9-c7fc-424b-9429-207e4527cad1`). All 159 questions, 42 picks, 2 games, 7 categories preserved. Source untouched. Image URLs reuse the public bucket; verified 200 OK.
- Patched Heather's host row: `is_first_night_complete=true`, `default_venue='Soul Fire Pizza'`. Required because the onboarding view (`OnboardingFirstDashboard`) gates only on `is_first_night_complete=false` and offers no affordance to surface existing drafts — without this fix, every "Set up Wednesday" tap minted a new empty "Heather"-venue night.
- Deleted 4 empty cruft nights under Heather's host_id (validation playwright runs + the brand-new empty one created tonight when Brandon hit the trap). All had 0 picks / 0 players. IDs: `e8f508a1`, `30cbd106`, `b37e7808`, `b92b930d`.
- Removed the test `ClaudeBot` player I created on the preview during PR #31 validation.

---

## 🚨 P0 carry-over: pick up the work parked mid-game

### 1. Merge PR #31 → unblocks every player phone on prod

https://github.com/Vyntechs/Tr1via.com/pull/31. One-file change to `lib/hooks/useRoom.ts` — drops `select="*, hosts!inner(default_theme_key)"` from the night re-fetch and uses the host's default theme from the `/api/nights/by-code` admin response instead. Validated on preview (`tr1via-dcufycnfa…`) by joining as `ClaudeBot` and confirming the lobby rendered ("IN THE ROOM 1 · ClaudeBot · you"). Screenshot: `validate-pr31-player-lobby-fixed.png` in the repo root.

**Why this is real-fix territory:** PR #30 hypothesized a `useDeviceSession` ↔ `useRoom` race. The race was real but the 100%-deterministic fault was deeper: `hosts!inner` requires both rows visible to RLS, the only SELECT policy on `hosts` is `hosts_self_read` (`user_id = auth.uid()`), players auth by device cookie and have **no** `auth.uid()`, so PostgREST silently 406'd every player on every load. Heartbeats kept arriving the whole time because `useHeartbeat` lives above the null-night early-return and `players_self_select` lets a player read their own row — so `me` resolved, lobby never did. See `project_rls_hosts_inner_trap.md` in memory.

### 2. WIP: multi-night planning dashboard (branch `wip-host-multi-night-dashboard`)

Brandon flagged a product hole: the dashboard surfaces a single `tonight` headliner; hosts can't plan many drafts at once; the only "+ Plan a new night" path is to close the current one. A WIP commit on branch `wip-host-multi-night-dashboard` (`9e02540`) has just `app/host/page.tsx` rewired so the onboarding view fires only on `nights.length === 0` and an `inFlight + drafts` slice is computed. **Does not type-check on its own** — needs `fetchPickCountByNight` defined, `hasAnyNight` prop wired through `HostHomeClient`, and the `HostDashboard` UI changes (drafts list + always-visible "+ Plan a new night" button). Design mockup is in the PR #29 proposal I sent during the session (look in session transcript or my memory).

### 3. "Room" → "Game" copy rename across user-visible surfaces

Brandon: *"can we not refer to it as room and just refer to it as game?"* Inventory grep is in the session transcript — ~40 strings. **Don't rename:** the `room_code` DB column, `formatRoomCode` helper, `/api/nights/by-code` route, or any internal type/identifier. **Rename:** every user-visible "ROOM CODE", "in the room", "Join the room", "Room not found", "JOIN A ROOM", "That room isn't open", "Open the room", etc. Keep "the room" untouched when it refers to the *physical* venue room (e.g. `app/page.tsx:126` "make the room feel alive").

---

## Tonight's test game — what Brandon wants to validate as host

**Plan (Brandon's words):** "Next session I'm going to run through this game as the host with real players. I have three players right now."

Brandon will drive the host laptop, friends drive player phones. Be ready for bug reports as he progresses through:

1. **Pre-game lobby** — players already joined (Brhae, Bnipps360, BennettBloxx are heartbeating). PR #31 needs to be merged + deployed before they can see the lobby; otherwise direct-link them at `/room/YU5JF3` and have them hard-refresh.
2. **Open the room** — `nights.opened_at` is already set (00:31 UTC), but starting Game 1 from `state=draft` will move it through ready/live.
3. **Start Game 1** — 6 categories all locked (ready state), 42 picks. Watch for the reveal flow, scoring, timer.
4. **Game 1 finishes → intermission → Game 2** — only Prisons is in `review` (0 picks). Heather/Brandon may need to either pick 7 questions for Prisons or skip Game 2.
5. **Close the night, score recap, won/recap pages** — these queries also live in `useRoom`; PR #31 changes them too.

When a bug comes in: lead with what was on the screen + literal text from the screenshot, pull both Vercel logs *and* Supabase API logs (`get_logs` type `"api"`), propose a fix in a feature branch, validate visually on preview before claiming done. See `feedback_parallel_research_agents.md` and `reference_supabase_api_logs.md` in memory.

---

## Open work (after the test game settles)

### P1: Finish multi-night planning (branch `wip-host-multi-night-dashboard`)

Adds drafts list + always-visible "+ Plan a new night" affordance. WIP commit `9e02540`. Type-check fails on its own; needs `HostHomeClient` + `HostDashboard` parts to land alongside.

### P1: "Room" → "Game" rename (no branch yet)

User-visible copy only. Run `grep -rn '"room\|"Room\|"ROOM\|in the room\|Room code\|ROOM CODE\|Open the room\|Join the room\|JOIN A ROOM' app/ components/` to start. Keep physical-room references.

### P1: PR G2 (rename a locked category) — WIP commit from session 12

Spec: `docs/superpowers/specs/2026-05-25-pr-g2-rename-category.md` on branch `docs-spec-g2-rename-category`. **WIP commit `493307b` on branch `feat-rename-category`** — schema + new PATCH route done; mid-edit on `HostGenPick.tsx` (references undefined `EditableTopicEyebrow`, typecheck fails). Resume by reading the spec's §4 + §6 then finishing `EditableTopicEyebrow` inline component + wiring `HostSetupPickClient`. Heather will hit "I can't rename a locked category" Wednesday if not shipped.

### P2: PR G3 (write your own custom question) — spec only

Spec: `docs/superpowers/specs/2026-05-25-pr-g3-custom-question.md` on branch `docs-spec-g3-custom-question`. Not blocking Wednesday but Heather wanted it.

### P3: Working-dir cleanup

`git status` shows ~50 untracked validation screenshots from sessions 11–13 (`validate-*.png`, `verify-*.png`, `smoke-*.png`, `pr-*.png`, etc.). Either gitignore the patterns or just `rm` them.

### P4: `npm run lint` broken on main

`next lint` was removed in Next 16. The `package.json` script errors out. Replace with `eslint .` in a small chore PR.

---

## Auth model — unchanged from session 12

Sign-in is `type email → in`. No magic links. `/host/admin → SEND A SIGN-IN LINK` for cross-device. Memory: `project_auth_model_type_email_in.md` and `feedback_no_friction_without_security_gain.md`.

---

## Tools confirmed working (session 13 additions)

- **`vercel logs`** — `--no-branch --since 1h --query "<text>" --json`. Vercel MCP is 403; CLI is the workaround.
- **Supabase MCP `get_logs`** — types `postgres`, `auth`, `api`, `realtime`. **`api` is the PostgREST log** and catches direct browser→Supabase 4xx that Vercel can't see. Critical for player-side debugging. See `reference_supabase_api_logs.md`.
- **Parallel `general-purpose` agents** for missed root cause — one for code search, one for log pull. See `feedback_parallel_research_agents.md`. Brandon endorsed this pattern explicitly mid-session.
- **Playwright MCP** — drove the PR #31 preview validation. Joined as ClaudeBot, confirmed lobby rendered, then cleaned up the test player row via SQL.

---

## Schema state on prod (unchanged from session 12)

```
hosts.default_theme_key  text  NOT NULL  default 'daylight'
nights.theme_key         text  NULL      no default
categories.name          text  NOT NULL  (host-renamable post-G2)
categories.topic         text  NOT NULL  (Claude prompt; immutable post-generation)
questions.point_value    smallint  null allowed  (respects host edits since PR #21)
```

No schema changes in session 13.

---

## Workflow rules (non-negotiable)

- **PR-first always.** Never push to `main`. Even docs. Brandon merges; Claude opens.
- **Validate everything contextually possible BEFORE handoff.** Drive the real user flow on the preview before claiming done. PR #30 shipped without a player-side preview test and missed the bigger bug. See `feedback_validate_dont_just_claim.md`.
- **For player-side Supabase failures, pull `get_logs` type `api` first.** Vercel logs lie because the failing request is browser→Supabase direct. See `reference_supabase_api_logs.md`.
- **When a shipped fix doesn't land, dispatch two parallel research agents** (code-search + logs) before re-hypothesizing. See `feedback_parallel_research_agents.md`.
- **Don't ask permission for engineering decisions when a spec + design exist.** Do ask for product/intent ambiguities.
- **Brandon's customer is non-technical.** Plain English in PR descriptions + customer-facing copy. No jargon.
- **Migrations: apply via MCP, don't touch other projects.** Trivia id: `citweuctcnuxmqjxcbiz`. NEVER touch `ynmtszuybeenjbigxdyl` (Vyntechs Auto) or `vggftauiaplktwnwciey` (lurnt-discovery).
- **Never inner-join `hosts` from a player-side query.** Hosts have no player-visible SELECT policy. See `project_rls_hosts_inner_trap.md`.

---

## Resumption prompt for session 14

After `/clear`, type:

> **read HANDOFF.md and continue — I'm about to run a real game as the host with my three friends. PR #31 may or may not be merged. If a bug comes in, it'll be a screenshot + literal error text.**

That plus auto-loaded memory will reorient.

The first move on a clean start with no bug report is: confirm PR #31 status (merged → prod has it; not merged → flag it as the immediate unblock). Then settle into bug-watch mode for the live game.
