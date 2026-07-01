## What I implemented

- Integrated `deriveAllLockedAutoRevealDecision` into `app/host/live/[nightId]/HostLiveConsoleClient.tsx`.
- Integrated `useAllLockedAutoReveal` so the host client schedules `handleEndEarly()` when every eligible active player has locked for the live question.
- Added `directScoresReadyForGameId` tracking so direct `game_scores` rows are treated as unknown eligibility until the current game's rows are confirmed loaded.
- Derived eligibility from loaded `game_scores` rows intersected with active `room.players`.
- Updated the host live strip so, while a question is live, `playersTotal` uses the eligible denominator when known and `lockedCount` uses the eligible locked count.

## What I tested and test results

- Ran:
  - `npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx`
- Result:
  - PASS
  - `2` test files passed
  - `14` tests passed

- Ran:
  - `npx eslint app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- Result:
  - FAIL
  - File has existing `react-hooks/set-state-in-effect` and `react-hooks/purity` errors in multiple pre-existing sections.

## Files changed

- `app/host/live/[nightId]/HostLiveConsoleClient.tsx`
- `.superpowers/sdd/task-3-report.md`

## Self-review findings

- Scope stayed within the owned host client file for implementation.
- Auto-reveal only becomes eligible when the current game's score rows are known loaded; unloaded direct scores remain `null` eligibility.
- Backup mode continues to treat fallback payload scores as ready for the current game.
- Existing `handleEndEarly` semantics remain unchanged; the new hook only schedules that existing action.

## Concerns

- `npx eslint` does not pass on this file because of pre-existing React hook lint rules already violated elsewhere in the file. I did not broaden scope beyond Task 3 to refactor those patterns.

Verified by: `npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx`; `npx eslint app/host/live/[nightId]/HostLiveConsoleClient.tsx`

Skipped/Failed: ESLint remains failing on existing file-level React hook/purity rules.

## Fix follow-up

- Fixed the `TS2345` review issue in `HostLiveConsoleClient.tsx` by rebinding the narrowed `gameId` to a non-null `currentGameId` before the nested `load()` closure uses it.
- This preserves the existing runtime behavior and only addresses the TypeScript narrowing gap across the closure boundary.

### Fix verification

- Ran:
  - `npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx`
- Result:
  - PASS

- Ran:
  - `npx tsc --noEmit --pretty false`
- Result:
  - `HostLiveConsoleClient.tsx` is no longer mentioned.
  - Remaining output:
    - `tests/unit/HostHomeClient-founder-build.test.tsx(30,19): error TS2739` missing `previousGames`, `inSetup`
    - `tests/unit/HostHomeClient-founder-build.test.tsx(44,19): error TS2739` missing `previousGames`, `inSetup`
