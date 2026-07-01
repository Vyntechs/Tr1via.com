# Final Review Fix Report — All Locked Auto-Reveal v1

## Scope

Implement the final-review fixes for:

1. Critical: stale browser eligibility could auto-reveal before a newly eligible current-game participant locked.
2. Important: auto timer/manual resolve races could surface a false host error on 409 conflicts.
3. Minor: add regression coverage for late participant/current-game participation changes during the 1200ms grace window.

## What Changed

### 1. Server-side auto guard for `/api/games/[id]/end-early`

- Extended `EndEarlySchema` with optional `requireAllLocked`.
- Added an auto-only server guard in [`app/api/games/[id]/end-early/route.ts`](app/api/games/[id]/end-early/route.ts):
  - Reads active non-removed night players from `players`.
  - Reads current-game participant rows from `game_scores`.
  - Reads current-question answers from `answers`.
  - Reuses `deriveAllLockedAutoRevealDecision(...)`.
  - Returns `409 not all eligible players are locked` if completion cannot be proven.
- Manual host end-early remains unchanged because the guard only runs when `requireAllLocked === true`.

### 2. Auto client no-op behavior for guarded conflicts

- Updated [`app/host/live/[nightId]/HostLiveConsoleClient.tsx`](app/host/live/%5BnightId%5D/HostLiveConsoleClient.tsx) so:
  - auto-reveal posts `requireAllLocked: true`
  - manual end-early does not
  - auto-path `409` responses return `false` instead of surfacing an error toast
  - non-conflict failures still use the existing host error path

### 3. Hook retry contract for guarded auto attempts

- Updated [`lib/hooks/useAllLockedAutoReveal.ts`](lib/hooks/useAllLockedAutoReveal.ts) so `onAutoReveal` may return `false`.
- `false` now means:
  - do not mark the question as fired
  - retry only after another grace window
  - cancel cleanly if the question changes or completion becomes false
- Success / existing truthy-or-void behavior still marks the question fired once.

### 4. Host eligibility freshness tightening

- Tightened host-side readiness in [`app/host/live/[nightId]/HostLiveConsoleClient.tsx`](app/host/live/%5BnightId%5D/HostLiveConsoleClient.tsx):
  - readiness key now includes `currentGame.id + activePlayerIdSignature`
  - score-derived eligibility is treated as unknown until the current readiness key has reloaded
  - direct score reload now also subscribes to `game_participations` changes for the current game
  - `game_participations` changes explicitly mark eligibility stale before reloading

## Regression Coverage Added

- [`tests/unit/useAllLockedAutoReveal.test.tsx`](tests/unit/useAllLockedAutoReveal.test.tsx)
  - covers `false` return -> not fired -> retries after the next grace window
- [`tests/unit/api-end-early-route.test.ts`](tests/unit/api-end-early-route.test.ts)
  - guarded auto route rejects incomplete current-game locks
  - manual end-early still resolves without the guard flag
- [`tests/e2e/all-locked-auto-reveal.spec.ts`](tests/e2e/all-locked-auto-reveal.spec.ts)
  - adds latecomer-during-grace-window coverage

## Verification

### Passed

- `npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx tests/unit/api-end-early-route.test.ts`
- `npm run build`

### Lint

- Ran:
  - `npx eslint 'app/host/live/[nightId]/HostLiveConsoleClient.tsx' 'app/api/games/[id]/end-early/route.ts' lib/api/schemas.ts lib/hooks/useAllLockedAutoReveal.ts lib/game/allLockedAutoReveal.ts tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx tests/unit/api-end-early-route.test.ts tests/e2e/all-locked-auto-reveal.spec.ts`
- Result:
  - route/schema/hook/test files passed
  - `app/host/live/[nightId]/HostLiveConsoleClient.tsx` still reports the known pre-existing React 19 `react-hooks/set-state-in-effect` / `react-hooks/purity` failures already called out in task guidance

### E2E Attempted But Blocked By Local Env

- Attempted:
  - `npm run test:e2e -- tests/e2e/all-locked-auto-reveal.spec.ts tests/e2e/reveal-sync.spec.ts`
- Blocker:
  - local dev server failed test routes with `Missing env: NEXT_PUBLIC_SUPABASE_URL — copy .env.example to .env.local`
- Exact local-only setup needed before rerunning:
  1. `supabase start`
  2. `cp .env.example .env.local`
  3. fill local Supabase envs at minimum:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
  4. if needed for fresh local state: `supabase db reset`
  5. rerun `npm run test:e2e -- tests/e2e/all-locked-auto-reveal.spec.ts tests/e2e/reveal-sync.spec.ts`

## Self-Review Against Findings

- Critical stale-eligibility bug: fixed by server-side `requireAllLocked` guard, host stale-readiness gating, and `game_participations` resubscribe/reload.
- Important benign-race bug: fixed by treating auto-path `409` conflicts as `false` no-ops instead of host errors.
- Minor grace-window regression coverage: added unit + E2E coverage.

## Commit

- Included in commit: `fix: harden all-locked auto reveal final review`

Verified by: `npx vitest run tests/unit/all-locked-auto-reveal.test.ts tests/unit/useAllLockedAutoReveal.test.tsx tests/unit/api-end-early-route.test.ts`; `npm run build`; direct ESLint command above; manual diff/self-review against final-review findings.
Skipped/Failed: Playwright E2E could not complete locally because `.env.local` is missing Supabase env values in this workspace; direct ESLint still reports known pre-existing `HostLiveConsoleClient` React 19 hook/purity errors.
