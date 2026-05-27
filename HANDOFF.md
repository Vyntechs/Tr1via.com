# TR1VIA — Handoff (end of session 19, 2026-05-26 night, the first host-eve)

**Next session: read this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → `tasks/lessons.md` (grep for keywords matching task) → `tr1via-plan.md`.** Prior session handoffs in git history (session 18 at `ed0ae8c`, session 17 at `b5e8edf`, session 16 at `b5e8edf`).

---

## Critical context

**the first host goes live on tr1via.com TODAY, Wednesday 2026-05-27** at Soul Fire Pizza. Brandon spent session 19 sitting NEXT TO HER doing live E2E on the preview/prod site, surfacing bugs in real time. Real paying patrons within ~12 hours of this handoff.

Total shipped tonight (session 19): **9 PRs**. All merged.

---

## What landed this session (session 19) — all 9 PRs merged

| PR | What |
|---|---|
| #41 | swap-image edit values persist (orphaned commit from earlier; Brandon merged) |
| #42 | swap-image library renders real Pexels photos, not striped placeholders |
| #43 | in-flight answer survival (localStorage) + WebSocket channel reconnect + 30-phone load scaffold |
| #44 | Magic Welcome moment (3-surface sync, name slide + chime + sparkle + haptic, per-player color) |
| #45 | Real procedural lightning for May storm (jagged bolts, multi-stage flash, scene illumination, thunder) |
| #46 | Remove demo placeholder leak ("Devon"/"Iris"/"Priya" leaking into prod) + useRoom 15s heartbeat |
| #47 | Host setup batch: regenerate-keeps-picks v1, click-to-edit category name, back button on pick page, delete-category trash icon + confirm modal |
| #48 | Player phone question text auto-fit: no more `...` truncation, 18-28px scaling per device |
| #49 | Theme month fallback: brand-new hosts auto-pick current month's theme (May→storm, etc.) |

Also: SQL backfill on prod to set existing hosts + recent nights to `theme_key='may'` so the first host sees lightning immediately, without waiting for #49 to deploy. Non-destructive UPDATE, reversible.

---

## OPEN BUGS — pickup for session 20

These came in DURING Brandon's live E2E after #47 merged. Both still need fixing.

### 1. Regenerate STILL wipes selected picks (REGRESSION/INCOMPLETE in #47)

PR #47 added `lib/host/mergePickedAfterRefetch.ts` + a "your picks stay safe" banner. Brandon reports the bug is **still happening**: host picks 3 of the initial 20, clicks "Regenerate 20 more", picks vanish, count resets to 0.

Possible causes to investigate first session 20:
- Brandon's browser may have been cached — verify the deployed code at tr1via.com actually includes the merge logic
- The merge helper covers REFETCH cases, but maybe a different code path during regenerate still calls `setPickedIds(new Set())` directly
- The `regenerating` flag may not be wired through every state transition
- Picks may live in TWO places — client `pickedIds` Set AND server `is_picked` rows — and the merge might restore one but not the other

Files to look at:
- `lib/host/mergePickedAfterRefetch.ts` (the new helper)
- `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` (the callers, especially `handleRegenerate` and `refetchQuestions`)
- The `regenerating` flag wire-up — search for it

### 2. Duplicate questions across regenerate (NEW)

When host clicks "Regenerate 20 more", **some of the new 20 are duplicates of the original 20** — exact same prompt + options + correct answer. This is a server-side issue: `runGenerationJob` in `app/api/categories/[id]/generate/route.ts` calls `generateQuestions({ topic, flavor, difficulty, count: 20 })` without telling the AI what's already been generated for this category.

Fix path:
- Before calling the AI, fetch existing question prompts for this category from the DB
- Pass them in as an "exclude" list in the prompt: "Do NOT repeat any of these {N} questions: ..."
- Verify with a few regenerates that the new 20 are actually novel

File: `app/api/categories/[id]/generate/route.ts` (the `runGenerationJob` function around line 136-234).

---

## Current state on prod (verified at session-19 close)

- tr1via.com aliased to deploy `l7u26gvqu` (Ready, 34s build) — contains PRs #47 + #48
- Latest deploy `g3i9u4cpq` (PR #49 theme fallback) was building at session close, should be live shortly
- Soul Fire Pizza nights (`HB85QY`, `DKYCSG`) cleaned up where created; the original test night may still exist
- All hosts: `default_theme_key='may'`
- All recent nights: `theme_key='may'`

---

## Architecture additions worth knowing

- **`lib/realtime/channelHealth.ts`** (PR #43) — module-level pub/sub for Realtime channel state. `useChannelHealth()` hook + `setChannelHealth(state)` setter. Bridges useRoom (route-level) to ConnectionRibbonProvider (layout-level).
- **`lib/audio/welcomeChime.ts`** (PR #44) + **`lib/audio/thunder.ts`** (PR #45) — first Web Audio in the codebase. Procedural synthesis (no audio files shipped). Lazy AudioContext, gated on user gesture for iOS.
- **`lib/player/playerColor.ts`** (PR #44) — deterministic FNV-1a hash → 10-color palette. Same algorithm server + client so welcome event color matches roster color.
- **`components/system/Lightning.tsx`** + **`components/system/lightning-bolt.ts`** (PR #45) — procedural bolt geometry (midpoint displacement + branching). Module-level `fireLightningBeat()` event emitter so callsites (TVFinaleWinner, HostLiveConsole, section-complete) can trigger close strikes without prop-drilling. Dev verification at `/dev/system` section 11a.
- **`lib/hooks/useAutoFitText.ts`** (PR #48) — probes candidate font sizes from largest down, picks first that fits. ResizeObserver re-fits on orientation change.

---

## Workflow notes carried forward

- **PR-first always.** Brandon merges. Never push to main directly.
- **Plain English everywhere.** Brandon is non-technical himself.
- **Validate, don't just claim** — drive the user-visible flow, not just unit tests.
- **Build without asking** for engineering decisions when spec exists. Ask only on product/intent ambiguity.
- **Watch deploy state after merge** — session 19 hit a stuck Vercel "Initializing" for 15+ minutes after PR #46 merged. CLI redeploy from main fixed it. Pattern: check `vercel ls --prod` after a merge; if a deploy is stuck, run `vercel --prod --yes` from a clean main checkout.
- **No destructive ops on prod DB without explicit ask.** UPDATE backfills like the May theme one are OK; DELETE/DROP are not.
- **For repeat bug investigation, dispatch parallel research agents** (per memory `feedback_parallel_research_agents`) — don't sit and guess.

---

## Session 19 build agents (background, all completed clean)

Three agents ran in parallel worktrees, each opened its own PR. All merged.
- Magic Welcome agent → #44
- Lightning agent → #45
- Host setup batch agent → #47
- Player phone responsive agent → #48

If session 20 needs to dispatch more agents, use `isolation: "worktree"` to avoid stepping on each other.

---

## Resumption prompt for session 20

After `/clear`, type:

> **read HANDOFF.md — the first host went live last night. Two regenerate bugs need fixing.**

Expected next-session action: investigate why PR #47's regenerate-keeps-picks didn't fully land for Brandon, then ship a follow-up. Then add the AI exclude-list for duplicate prevention. Then capture how the actual go-live went from Brandon's report.

---

## Skipped/Failed (per workflow §7, even when "None")

- **2 regenerate bugs above.** Out of session 19 scope (Brandon called timeout for handoff). Next session.
- **PR #47's incomplete fix.** Already documented above as bug #1.
- **`prod-ui-smoke.spec.ts` still failing** with stale button text from PR #28 (`/send sign-in link/i` vs actual `Sign in →`). Pre-existing, blocks the smoke CI but not deploys. Tiny one-line fix when convenient.
- **Working-tree cleanup** — `.claude/worktrees/agent-*` directories exist from background agents. Not committed (in `.gitignore`-equivalent state). Can be removed via `rm -rf .claude/worktrees/agent-*` whenever.
