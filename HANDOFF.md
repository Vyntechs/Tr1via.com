# TR1VIA — Handoff (end of session 21, 2026-05-27 mid-day, May/Storm PR opened)

**Next session: read this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → `docs/superpowers/specs/2026-05-27-may-storm-lock-in-magic.md` → `docs/superpowers/plans/2026-05-27-may-storm-lock-in-magic.md` → `tasks/lessons.md` (grep keywords).**

Prior session handoffs in git history (session 20 design at `11977c8`, session 19 at `6179b0b`).

---

## Critical context

- **the first host goes live tonight (2026-05-27).** She'll be running on whatever's currently on `main`. The May/Storm feature is in PR #52, NOT yet merged.
- **PR #52 is open and awaiting Brandon's validation:** https://github.com/Vyntechs/Tr1via.com/pull/52
  - Branch: `feat/may-storm-lock-in-magic` (30 commits, 52 files, ~5,800 lines, 429 tests pass)
  - Vercel preview deploys automatically — link appears in the PR comment within ~2 minutes
- **Brandon left this session to manually validate the preview.** He will report any bugs / issues he finds back in the next session.

---

## What landed this session (session 21 — implementation)

Subagent-driven execution of the 21-task plan from session 20. Each task did TDD: failing test → minimal implementation → 2-stage review (spec compliance → code quality) → commit. Several follow-up commits fixed issues caught in per-task review.

Notable commits:
- `ededffc` — theme registry (foundation)
- `25de2f4` — `tint` prop on `Lightning.tsx`
- `07c14e7` — `PlayerLockInBolt` (phone-side bolt)
- `2553251` + `fc90d3a` — `TVScoreboardMarquee` (shell + auto-scroll)
- `0b1ac84` + `5b8c440` — `TVLockInCeremony` (calm/storm orchestrator)
- `ce297c8` + `a6e8199` — `TVStateMachine` plumbing (with `key={liveQuestion.id}` reset)
- `989c109` — `useLockInSync` 3s polling fallback
- `b0c05de` — phone bolt wired onto server confirm
- `47b22c0` — mid-game theme change blocked (server + UI)
- `9b634dc` — reveal pause for ceremony queue
- `8cb53c6` — final fixes (host phone timer themeKey + upcoming label)

Spec doc + plan doc + handoff are also IN this PR (came from `spec/may-storm-lock-in-magic` parent branch).

---

## Pre-merge validation checklist (Brandon's runbook)

These were called out in the PR description. The next session should ask Brandon which ones he completed and which need follow-up:

- [ ] **Vercel preview** — set up a May-themed night, get a few phones on, watch a strike land on the marquee. Look for visual bugs, timing issues, missed ceremonies.
- [ ] **`node scripts/full-flow-prod.mjs`** — extended to validate BOTH May and non-May passes (~90s total). Standing rule before merge.
- [ ] **`npx playwright test tests/e2e/may-lightning-ceremony.spec.ts tests/e2e/non-may-unchanged.spec.ts`** — needs a dev server running with prod Supabase. Couldn't run in the implementation session's environment.
- [ ] **Chromecast / HDMI test** — actual TV hardware. Frame perf only catchable here.

---

## How the next session should handle Brandon's bug reports

1. **Start by reading Brandon's latest message** — he'll have specific findings (which screen, what happened, on which device).
2. **Categorize each finding:**
   - **Implementation bug** (something the plan got wrong) → fix on `feat/may-storm-lock-in-magic` directly, push a new commit. PR auto-updates.
   - **Spec gap** (a behavior wasn't decided in design) → brief brainstorm with Brandon, update the spec, then fix.
   - **Manual-validation-only concern** (e.g., subjective timing) → confirm with Brandon, then tune.
3. **For UI bugs:** spin up the Vercel preview yourself if possible, OR walk Brandon through a quick repro to confirm before fixing.
4. **Test before pushing each fix.** TR1VIA's PR-first + the first host-live posture means broken intermediate states are unacceptable.
5. **If a bug touches the ceremony correctness rule** ("every lock-in gets a ceremony"): treat as Critical — do not let the PR merge until fixed.

---

## OPEN ITEMS (carry-over)

### Two regenerate bugs from session 19 — still un-fixed

These remain on `fix-regenerate-picks-and-dups` (separate branch from this PR's work). They were stashed multiple times during session 21 execution but not touched. Both unblocked the first host's current-night experience because they're on a different branch.

1. **Regenerate STILL wipes selected picks (PR #47 regression / incomplete)** — host picks 3 of 20, taps "Regenerate 20 more", picks vanish. PR #47 added `lib/host/mergePickedAfterRefetch.ts` but the bug persists. Investigation paths in session 20's handoff.
2. **Duplicate questions on regenerate** — second batch contains exact dupes of the first. Server-side: `runGenerationJob` doesn't pass existing prompts as an exclude list to Claude. WIP includes `excludePrompts?: string[]` field on `GenerateQuestionsOptions` (visible in the stash) but never landed cleanly.

Branch state: `fix-regenerate-picks-and-dups` has stashed WIP (stash@{0}). Untouched during May/Storm execution.

### Minor backlog from May/Storm execution

- Task 1 follow-up: `hasCeremony()` export in `lib/theme/lockInCeremony.ts` is untested. Low priority — captured in TodoWrite as the only pending item.
- Per-task review notes flagged minor cleanups (e.g., `decoratedChips` memo location, callback ref pattern in `useEffect`). All non-blocking. The branch passes review for merge.

---

## Lesson learned (worth capturing in tasks/lessons.md)

During Task 10 + Task 15 of the subagent-driven execution, two separate subagents tried to "resolve merge conflicts" they encountered on the feat branch. The conflicts came from unrelated WIP that had been stashed earlier — the subagents accidentally pulled the stashed changes into their commits.

**The rule:** Any subagent dispatched for implementation should NEVER:
- Run `git reset --hard`
- Run `git checkout <other-branch>` (mid-task, even to "look at something")
- Resolve a merge conflict on a feat branch (there shouldn't be one)
- Run `git stash pop` to "restore" changes they didn't make

Every subagent prompt in session 21 from Task 11 onward included the literal warning: "If `git commit` reports any unexpected files in the diff, STOP and report BLOCKED. Don't pull in stashed WIP."

Recovery: `git reflog` is the lifeline. Lost commits were recovered via cherry-pick from the reflog. Future subagent-driven work on dirty trees should include this warning by default.

---

## Working tree state (end of session 21)

- **Active branch:** `feat/may-storm-lock-in-magic` — pushed to origin, PR #52 open
- **Local-only branches:** `spec/may-storm-lock-in-magic` (parent of feat) — still local, not pushed
- **Stashed WIP:** `stash@{0}` on `fix-regenerate-picks-and-dups` — the regenerate-picks-and-dups fixes from session 19 (still un-fixed; needs separate work)
- **Modified files in feat branch:** none uncommitted (clean)
- **Untracked files in working tree:** screenshots, validation scripts, `.superpowers/` (gitignored), `.claude/`, etc.

---

## Key files / pointers

- PR: https://github.com/Vyntechs/Tr1via.com/pull/52
- Spec: `docs/superpowers/specs/2026-05-27-may-storm-lock-in-magic.md`
- Plan: `docs/superpowers/plans/2026-05-27-may-storm-lock-in-magic.md`
- Theme registry (single source of truth): `lib/theme/lockInCeremony.ts`
- Lightning component (extended with `tint`): `components/system/Lightning.tsx`
- Marquee: `components/tv/TVScoreboardMarquee.tsx`
- Ceremony orchestrator: `components/tv/TVLockInCeremony.tsx`
- Phone bolt: `components/player/PlayerLockInBolt.tsx`
- Reveal pause: `lib/tv/revealPause.ts`
- Polling fallback: `lib/hooks/useLockInSync.ts` + `app/api/games/[id]/locks/route.ts`
- Theme guard route: `app/api/nights/[id]/theme/route.ts`
- Full-flow prod (extended): `scripts/full-flow-prod.mjs`
- E2E specs: `tests/e2e/may-lightning-ceremony.spec.ts`, `tests/e2e/non-may-unchanged.spec.ts`

---

## Rollout safety reminder

- Feature is fully theme-gated. Anything weird → switch night's theme away from May, falls back to current behavior.
- Emergency override: `?theme=house` URL flag in-session.
- the first host can stay on May/Storm to get the magic, or pick any other theme.
