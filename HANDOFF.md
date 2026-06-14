# TR1VIA — Handoff (2026-06-14 — #105 scoring MERGED; #106 RLS answer-leak fix OPEN, pre-merge validation queued)

**Next session, read in order: this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → grep `tasks/lessons.md` → `tasks/todo.md`.**

---

## ⭐ Where we are
This session: (1) **merged PR #105** (scoring per-game isolation) to `main` (squash `9de0f51`); (2) built + opened **PR #106**, the anti-cheat RLS fix that stops players reading the live answer; (3) Brandon queued a **pre-merge validation** task for next session to drive #106's merge risk to ~none.

- **PR #106 (`fix/rls-correct-index-leak`)** — **OPEN + MERGEABLE. NOT merged.** Brandon merges (PR-first). Fix commit `3bbfaf5`, branched off merged `main`.
- **PR #105** — **MERGED this session** (`9de0f51`). ⚠️ migration `0013` is **NOT yet applied to prod** — prod scoring still double-counts until applied by hand.
- **Two prod migrations now pending a manual apply:** `0013` (scoring) + `0014` (RLS answer-lock). Batch them in ONE safe window, **outside the Wed 2026-06-17 show**. `0014` is **deploy-before-migrate** (see constraints).

## ⭐ Immediate next step (Brandon's queued brief): PRE-MERGE validation of #106 to make merge risk ~none
Validate #106 on a **throwaway Supabase copy** (preview branch — NOT prod, NOT Heather's data), proving the parts the local pglite tests could NOT cover. Exact first actions a fresh agent runs:
1. `gh pr view 106` + read memory `anti-cheat-sweep-2026-06-13-open-siblings` + grep `tasks/lessons.md` for `rls-is-column-blind-revoke-the-column`, `revoke-migration-deploy-client-before-migrate`, `verdict-ui-must-hold-when-both-signals-absent`.
2. Stand up a Supabase **preview branch** (confirm the small cost with Brandon FIRST), apply migration `0014` to it. **Never prod.**
3. Prove on the real stack (as `anon` player + `authenticated` host), via BOTH raw SQL AND the PostgREST web API: player is DENIED `correct_index` (live + resolved) but reads the safe columns; host still reads it.
4. Prove the **realtime** feed never delivers `correct_index` to a player (pglite couldn't test this).
5. Prove the **browser reveal flow** on a preview deploy pointed at the throwaway DB: correct player sees CORRECT (never a "WRONG"/blank flash), fresh-join-mid-reveal sees the highlighted answer, and a hand-written anon answer query during the live window is DENIED. (This step moves risk "low → none".)
6. Confirm + write the **deploy-before-migrate** rollout sequence (batched with `0013`). Tear down the throwaway copy. Produce a validation report: each area PROVEN (with evidence) or "DO NOT MERGE" + the defect.
Full brief is in `tasks/todo.md`.

## What shipped in PR #106 (verified locally this session)
- `supabase/migrations/0014_questions_withhold_correct_index_from_players.sql` — column-level fix: `revoke select on questions from anon; grant select (<14 cols, all EXCEPT correct_index>) to anon`. Host (`authenticated`) + `service_role` untouched. Instant, no rewrite/backfill, reversible.
- `tests/integration/questions-correct-index-rls.test.ts` — **real Postgres via pglite**, reproduces the `anon` player role (device header + RLS membership). **RED on 0002** (player reads `correct_index: 2` on the live question), **GREEN on 0014** (denied live + resolved; safe cols still read; `authenticated` host still reads it).
- `lib/hooks/useRoom.ts` — players can't read `correct_index` off the row anymore, so: `readLastResolved` dropped `select('*')` → `PLAYER_QUESTION_COLUMNS`; new `readResolvedAnswer()` sources the answer from the `resolve` reveal metadata; `refreshLiveState` no-hint fallback uses it; merged into bootstrap.
- `app/api/games/[id]/end-early/route.ts` — now broadcasts `correctIndex` like `resolve` already does.
- `app/(player)/room/[code]/page.tsx` — `RevealView` holds a neutral "revealing…" frame (`RevealPendingView`) when `correct_index` hasn't landed, so a correct player is never flashed "WRONG" with a blank answer (review-driven hardening; also fixes a latent pre-existing edge).

**Verified by:** `npx vitest run` → 123 files, **745 passed** / 8 skipped (was 741; +4). `npx tsc --noEmit` clean except pre-existing `HostHomeClient-founder-build` errors. RED→GREEN watched directly. Two adversarial reviews (correctness + silent-failure); the silent-failure pass caught the "correct player shown WRONG" regression → hardened (above).

## ⚠️ Honest verification gap (what the queued validation closes)
The DB security fix is rigorously proven on real Postgres. The **client reveal flow** (realtime leg, PostgREST `select` behavior, on-phone reveal in a browser) is review-checked + suite-green + type-clean, but its authoritative behavioral check needs a **real Supabase instance** — `useRoom` is a realtime hook with no unit harness, and pglite can't exercise Realtime/PostgREST. That is exactly the queued pre-merge validation. Do NOT claim the reveal flow is "verified on a real instance" yet — it isn't.

## Hard constraints
- **PR-first; Brandon merges.** Don't merge #106; don't apply `0013`/`0014` to prod without his go.
- **`0014` is DEPLOY-BEFORE-MIGRATE** (inverts `merge-is-not-migrated`): it REMOVES a privilege the old client relies on. Apply `0014` only AFTER #106's merge has deployed (new client live). If applied first, old client's `select('*')` 401s (degrades to the admin route, not catastrophic). Lesson `revoke-migration-deploy-client-before-migrate`.
- **Migrations don't auto-apply on deploy.** Apply `0013` + `0014` by hand, batched, **outside / not near the Wed 2026-06-17 show.**
- **Validate on a throwaway Supabase copy, never prod; never touch Heather's data.**
- Fan out via internal subagents/Workflow, never a second human-driven session.

## Still open — verified, separate tracks (lower priority)
- **#2 HIGH (client, no migration):** in-game reveal total + `/won`/`/recap` *secondary* stats sum both games (`app/(player)/room/[code]/page.tsx` `sumAwarded`; `useMyAnswers` night-wide). Headline score already correct.
- **#3 HIGH (client, no migration):** host console board shows earlier-resolved cells re-clickable ~15s after resolve (`HostLiveConsoleClient.tsx` `allQuestions` keyed on `[room.games]`); also delays End-Game ~15s. `/tv/[code]` not affected.
- **#4 MED (client):** dropped Game-2 category realtime event can strand a player on "Waiting…"; self-heals in ≤15s.
- **Lower-priority anti-cheat:** unauth `/api/games/[id]/locks` (roster+timing). `/api/questions/[id]/resolve` griefing is **self-defeating** (resolving closes answering room-wide) AND legitimately player-called on timer-zero — can't just add an owner guard.
- **BROAD pre-customer (BWW) readiness pass** — GATED: only meaningful after #106 + #2 + #3 ship.

## Git state (2026-06-14)
- `origin/main` = **`9de0f51`** (PR #105) — live on prod (but `0013` not yet applied to prod DB).
- **PR #106 OPEN** from `fix/rls-correct-index-leak` (`3bbfaf5`), mergeable, CI green (GitGuardian + Vercel). The 5 fix files are the only code in the PR; session docs (HANDOFF/lessons/todo) are committed separately on the branch by `/done`.

## Lessons logged this session
`rls-is-column-blind-revoke-the-column`, `revoke-migration-deploy-client-before-migrate`, `verdict-ui-must-hold-when-both-signals-absent`.

## Skipped/Failed
None failed. By design not done: didn't merge #106 (Brandon's), didn't apply `0013`/`0014` to prod (post-merge, batched, outside the show), didn't run the real-instance reveal smoke (that IS the queued pre-merge validation).

## Resume prompt
Read HANDOFF.md in full and tell me where we left off.
