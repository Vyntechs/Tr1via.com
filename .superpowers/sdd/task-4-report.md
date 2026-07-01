# Task 4 Report — All-Locked Browser Rehearsal

## Status

DONE_WITH_CONCERNS

## What Changed

- Created `tests/e2e/all-locked-auto-reveal.spec.ts`
- Added two serial Playwright scenarios:
  - all eligible players locking triggers reveal automatically without test fast-forward
  - leaving one eligible player unlocked keeps the question live until explicit timer fast-forward
- Preserved `seed` in the first test so the TV snapshot assertion can check `seed.roomCode`

## Self-Review Against Brief

- Owned write scope respected: only created the new E2E spec plus this report
- No product files changed
- No helper changes were needed
- No production DB migration added
- Test coverage matches both required behaviors from the brief

## Verification

Command run:

```bash
npm run test:e2e -- tests/e2e/all-locked-auto-reveal.spec.ts
```

Result:

- Failed before test flow execution due missing local environment configuration for the Playwright web server

Exact output:

```text
⨯ Error: Missing env: NEXT_PUBLIC_SUPABASE_URL — copy .env.example to .env.local
    at env (lib/supabase/admin.ts:16:17)
    at getSupabaseAdmin (lib/supabase/admin.ts:25:7)
    at POST (app/api/_test/reset/route.ts:18:33)

Error: loginAsHost failed: 500
  at tests/e2e/helpers/host-laptop.ts:33
```

## Concerns

- Verification is blocked locally until the required Supabase env vars are available to the Playwright web server
- Because the app never reached seeded gameplay, I could not complete a green rerun in this environment

Verified by: `npm run test:e2e -- tests/e2e/all-locked-auto-reveal.spec.ts` and self-review against `/.superpowers/sdd/task-4-brief.md`

Skipped/Failed: Green verification rerun could not complete because the local web server failed boot-time env checks for `NEXT_PUBLIC_SUPABASE_URL`
