# TR1VIA — Handoff (end of session 20, 2026-05-27 day-of, Heather goes live tonight)

**Next session: read this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → `docs/superpowers/specs/2026-05-27-may-storm-lock-in-magic.md` → `docs/superpowers/plans/2026-05-27-may-storm-lock-in-magic.md` → `tasks/lessons.md` (grep keywords).** Prior session handoffs in git history (session 19 at `6179b0b`).

---

## Critical context

**Heather goes live on tr1via.com TONIGHT, Wednesday 2026-05-27** at Soul Fire Pizza. Real paying patrons. May/Storm theme is active.

Session 20 was a **design session** for the next major feature — the "May/Storm Lock-In Magic." No implementation yet. The next session is **subagent-driven execution** of the implementation plan that was authored this session.

---

## What landed this session (session 20)

| Artifact | Path | Branch | State |
|---|---|---|---|
| **Design spec** | `docs/superpowers/specs/2026-05-27-may-storm-lock-in-magic.md` | `spec/may-storm-lock-in-magic` | Committed, **local only** (not pushed) |
| **Implementation plan** | `docs/superpowers/plans/2026-05-27-may-storm-lock-in-magic.md` | `spec/may-storm-lock-in-magic` | Committed, **local only** |
| `.gitignore` update | `.gitignore` | `spec/may-storm-lock-in-magic` | `.superpowers/` ignored |

The brainstorm artifacts (HTML mockups Brandon clicked through) live at `.superpowers/brainstorm/3614-1779891112/` — gitignored, kept locally for reference.

---

## Feature summary — what the next session is building

When the active theme is **May/Storm**, three coordinated changes ship:

1. **Question timer 20s → 25s** (May only — AI prompt also updates to 25s for May generation)
2. **Auto-scrolling scoreboard marquee** at the bottom of the TV (replaces today's lock-in pile) — sorted by score descending, join-order tiebreak
3. **Per-player lightning ceremony on lock-in** — phone-side mini-bolt + strobe (~700ms), TV-side bolt strikes the player's chip in the marquee (calm/storm mode auto-switches by lock-in rate). Reuses existing `Lightning.tsx` with a new `tint` prop. Every lock-in is guaranteed a full ceremony (no exceptions).

**Locked product decisions** (during brainstorm):
- Speed bonus stays 5s window (easier to earn on 25s clock)
- Theme changes blocked mid-game (server + UI)
- Phone ceremony fires only after server confirm (DB is source of truth)
- Pinned May theme triggers ceremony year-round (theme is trigger, not calendar)
- +SPD badge appears on TV chip during strike (public bragging rights)
- Phones have no audio (haptic + visual only — 30 phones × thunder = noise pollution)

Full decision table is in the spec. Edge cases (stampede, network drops, missed broadcasts, etc.) are fully spec'd.

---

## Next session: execute the plan via subagent-driven development

Brandon's explicit ask: **full agent-driven execution with TDD.** 21 tasks across 8 phases, each task is bite-sized TDD (write failing test → minimal implementation → commit). Plan at `docs/superpowers/plans/2026-05-27-may-storm-lock-in-magic.md`.

**How to start:**
1. `git checkout spec/may-storm-lock-in-magic`
2. Branch off it for implementation: `git checkout -b feat/may-storm-lock-in-magic`
3. Invoke the `superpowers:subagent-driven-development` skill
4. Dispatch one subagent per task. Review the diff between each task before dispatching the next.

**Realistic effort:** 2-4 focused days. NOT a one-session thing.

**Rollout safety:** the entire feature is theme-gated. Non-May themes are unchanged. Heather can stay on May/Storm to get the magic, or any other theme to fall back to current behavior. Emergency override: `?theme=house` URL flag.

---

## OPEN BUGS — still un-fixed from session 19

These were on `fix-regenerate-picks-and-dups` at session 19 end and remain there (WIP stashed and restored multiple times during session 20 but not addressed):

### 1. Regenerate STILL wipes selected picks (REGRESSION/INCOMPLETE in PR #47)

PR #47 added `lib/host/mergePickedAfterRefetch.ts`. Brandon reports the bug is **still happening**: host picks 3 of the initial 20, clicks "Regenerate 20 more", picks vanish, count resets to 0.

Possible causes to investigate first:
- Browser cache — verify the deployed code at tr1via.com actually includes the merge logic
- A different code path during regenerate still calls `setPickedIds(new Set())` directly
- The `regenerating` flag may not be wired through every state transition
- Picks may live in TWO places (client `pickedIds` Set + server `is_picked` rows) — merge might restore one but not the other

Files: `lib/host/mergePickedAfterRefetch.ts`, `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`.

### 2. Duplicate questions across regenerate (NEW)

When host clicks "Regenerate 20 more", **some of the new 20 are duplicates** of the original 20 — exact same prompt + options + correct answer. Server-side issue: `runGenerationJob` in `app/api/categories/[id]/generate/route.ts` calls `generateQuestions({ topic, flavor, difficulty, count: 20 })` without an "already-generated" exclude list.

Fix path: fetch existing question prompts for the category, pass as exclude list to the AI prompt.

**Both bugs are unrelated to the May/Storm work** — they can be fixed on `fix-regenerate-picks-and-dups` in parallel or after.

---

## Working tree state (end of session 20)

- **Active branch:** `fix-regenerate-picks-and-dups` (the regenerate-picks WIP, unfixed)
- **Modified files:** `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx`, `lib/ai/generate-questions.ts`
- **Untracked files:** screenshots, validation scripts, `.superpowers/` (gitignored), `tasks/`, `.claude/`, etc.
- **Local-only branches:** `spec/may-storm-lock-in-magic` (with the spec + plan + .gitignore update)
- **Nothing pushed yet** for session 20 work — the spec/plan PR is queued for review

---

## Push checklist (when ready)

1. `git push -u origin spec/may-storm-lock-in-magic`
2. Open PR: spec + plan + .gitignore. Title: "docs: May/Storm lock-in magic — design + plan." Description should reference the spec doc + note the implementation branch will be `feat/may-storm-lock-in-magic`.
3. After spec PR merges, base `feat/may-storm-lock-in-magic` off `main`, execute the plan.

---

## Key files / pointers

- Spec: `docs/superpowers/specs/2026-05-27-may-storm-lock-in-magic.md`
- Plan: `docs/superpowers/plans/2026-05-27-may-storm-lock-in-magic.md`
- Existing theme registry to mirror: `components/system/Weather.tsx`
- Existing Lightning component (extend with `tint`): `components/system/Lightning.tsx`
- Existing player color palette: `lib/player/playerColor.ts`
- Full-flow prod validator (must pass post-implementation): `scripts/full-flow-prod.mjs`
- Lessons file (grep at session start): `tasks/lessons.md`
