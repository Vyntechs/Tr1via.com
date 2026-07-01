# All Locked Auto-Reveal v1 Design

## Product Intent

When every eligible player has locked an answer, the timer no longer adds suspense. It creates dead air. All Locked Auto-Reveal v1 removes that dead air by resolving the question shortly after the room is fully locked in.

The goal is pacing, not a new game mode. Heather's familiar gameplay remains intact: players answer, the room sees lock-in progress, then the reveal appears. The only change is that a fully locked room does not wait for the remaining timer.

## User-Facing Rule

During a live question, if every player eligible for the current game has submitted an answer, the host surface waits a short grace window and then reveals the answer automatically.

The grace window should be about 1.0 to 1.5 seconds. It gives the final lock-in animation a moment to land and avoids a jarring instant flip.

The host's manual `End early - reveal` button remains available as a backup. If the app cannot confidently prove that everyone eligible has locked, it should do nothing and let the normal timer continue.

## Definition of Everyone

Everyone means every active player participating in the current game.

This is intentionally narrower than "every player in the night." It avoids breaking cases where:

- A latecomer joined the night after Game 1.
- A player has not opted into Game 2.
- A host removed a player mid-night.
- A stale player row still exists but is not eligible for this game.

Eligibility should be derived from current-game participation plus non-removed player status. The lock numerator should count one answer per eligible player for the current live question.

An eligible count of zero is not complete. In that case, the normal timer remains the only automatic path.

## Recommended Architecture

Implement the feature on the host live surface first.

The host already has:

- The current game and current live question from `useRoom`.
- The live answer rows for the target question.
- Existing `handleEndEarly`, which calls `POST /api/games/:id/end-early`.
- A host-visible lock count in the bottom control strip.

Add a small pure helper that receives:

- Current game id.
- Current question id.
- Active players.
- Current-game participation rows or an equivalent eligible-player count.
- Current live answers.
- A feature-active boolean.

The helper returns a decision shape like:

```ts
{
  eligibleCount: number;
  lockedCount: number;
  complete: boolean;
  reason?: "no_live_question" | "no_current_game" | "no_eligible_players" | "unknown_eligibility" | "not_everyone_locked";
}
```

The host client should use that decision in an effect:

- Only run while a live question is active.
- When `complete` becomes true, start a grace timer.
- If completion becomes false, the question changes, the game changes, or the component unmounts, cancel the timer.
- After the grace timer, call the existing `handleEndEarly`.
- Guard with a per-question latch so the auto-reveal fires once per question.

This keeps scoring, resolving, broadcasting, and anti-cheat behavior on the existing trusted server path.

## Data Flow

1. Host reveals a question.
2. Player phones submit answers through `POST /api/answers`.
3. Answer rows are inserted with server-computed `ms_to_lock`.
4. Host live client receives or refetches live answer rows.
5. The all-locked helper compares eligible players with answer rows for the current question.
6. If all eligible players are locked, host waits the grace window.
7. Host calls `POST /api/games/:id/end-early` with the live question id.
8. The existing route calls `resolve_question`, broadcasts `end-early`, and all surfaces move to reveal.

## Error Handling

The feature must fail quiet and preserve the existing timer.

If eligibility cannot be calculated, do not auto-reveal.

If the auto-reveal request fails:

- Surface the existing host error path.
- Do not retry in a tight loop.
- Let the timer-zero path and manual host button remain fallbacks.

If a race happens with timer-zero resolution, the current RPC is idempotent. The first resolve wins and the second call no-ops.

## UI Behavior

No new configuration is required in v1.

The host control strip can keep showing the existing lock line. A small copy change is acceptable when everyone locks, such as `All locked - revealing...`, but the feature does not require a new modal, setting, or large visual treatment.

Player and TV surfaces should not need new UI. They already transition on the resolve/end-early broadcast and durable snapshot updates.

## Blast Radius

Expected blast radius is confined to host live orchestration and pure lock-count logic.

Final review found a route-level check-then-resolve race that cannot be made fully safe with host-client state alone. The implemented v1 therefore includes one additive migration for a service-role-only guarded resolve RPC. Production rollout must apply that migration through the DB-first release path before app code using the guarded route reaches production.

Do not change:

- Answer validation.
- Scoring rules.
- `resolve_question` semantics.
- Correct-answer visibility.
- Player submit behavior.
- Room Magic behavior.

## Acceptance Criteria

- If all eligible current-game players answer before the timer expires, the reveal happens automatically after the grace window.
- If at least one eligible player has not answered, the question stays live until timer-zero or manual host end-early.
- Removed players and non-participating Game 2 players do not block auto-reveal.
- Auto-reveal fires at most once per question.
- Manual end-early still works.
- Timer-zero resolve still works.
- The additive guarded-resolve migration is applied before production app rollout.

## Verification Plan

Unit tests:

- Pure helper returns incomplete when there is no live question or no current game.
- Pure helper returns incomplete when there are zero eligible players.
- Pure helper returns unknown/incomplete when eligible count cannot be proven.
- Pure helper counts only current-question answers.
- Pure helper deduplicates multiple answer rows by player id defensively.
- Pure helper treats removed or non-participating players as ineligible.
- Pure helper returns complete only when all eligible current-game players have locked.

Component/client tests:

- Host client schedules auto-reveal after all eligible players lock.
- Host client cancels the pending auto-reveal if the question changes or completion becomes false.
- Host client does not fire auto-reveal more than once for the same question.

E2E tests:

- Three players join, host reveals, all three answer, and the reveal appears without calling the test fast-forward helper.
- Control case: only two of three players answer, and the question remains live before timer-zero/manual reveal.

Regression checks:

- `npm test`
- Targeted E2E for the new all-locked flow.
- Existing reveal sync E2E remains green.
- `npm run build`

## Implementation Notes

Implementation should begin from current `main` on a feature branch, not from any detached Room Magic worktree.

If the host client lacks current-game participation rows, add the smallest read needed to prove eligible players. Keep it read-only and avoid production DB changes unless a later implementation pass proves a schema gap.

The safest first implementation is host-driven. A server-driven auto-resolve worker or database trigger is intentionally out of scope for v1 because it increases operational blast radius without being necessary for the pacing win.
