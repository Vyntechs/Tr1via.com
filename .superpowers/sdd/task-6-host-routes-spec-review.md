# Task 6 final host/atomic specification review

Commits reviewed: `c629701`, `90d7b45`, `83d3433`, and repair `538ae0d`.

## Verdict: PASS

No P0-P2 specification, correctness, security, or regression finding remains in
the reviewed Task 6 host/atomic slice.

## Contract assessment

- **Atomic open and lock safety: PASS.** The receipt's direct night and expected-game
  ancestry checks are deferred until commit, removing the receipt-first `KEY SHARE`
  lock inversions. Night ownership still cascades, while the composite night/run FK
  remains immediate and cascading.
- **Real concurrency: PASS.** Two independent PostgreSQL connections opening one
  night returned one fresh `night_opened` winner and one nonfresh `already_open`.
  Two independent connections starting the same game returned one fresh
  `game_started` winner and one typed nonfresh `stale`; both completed inside the
  five-second statement timeout with no deadlock, one durable event, two terminal
  receipts, and no pending receipt.
- **Lifecycle authority: PASS.** Open plus Start, Reveal, Show Answer, Undo, End,
  and Reset route through the stored immutable latch. Resilient branches accept
  strict bodies, call the matching single RPC, parse strict nested canonical
  results, reject wrong command kinds/targets, and return only the nested result.
  Legacy branches retain their prior request and mutation paths.
- **Fresh delivery: PASS.** Only a transaction winner can project or broadcast.
  Replays, stale/nonwinner outcomes, malformed envelopes, wrong kinds, and archived
  reset retries suppress projection and fan-out. Open now explicitly requires
  `night_opened`.
- **Cosmetics: PASS.** Finale fireworks and immediate Show Answer
  `play_resolved` salvos require a fresh exact projection; replay does not repeat
  either effect. Broadcast failures remain bounded/best-effort and do not turn a
  committed mutation into an API failure.
- **Host preference: PASS.** GET/POST require the authenticated host and the
  server-owned release gate, accept only `legacy` or `resilient_v1`, and update only
  that host's future-night preference. They cannot alter release authority or an
  already-opened night's latch.

## Verification

- Focused/extended host, open, schema, reset, parser, projection, request-schema,
  preference, and broadcast suites: **12 files, 142/142 tests passed**.
- Independent real-PostgreSQL open race: **PASS**, one fresh winner plus one
  nonfresh already-open result; cascade cleanup left zero receipts/events/runs.
- Independent real-PostgreSQL lifecycle race: the pre-repair schema reproduced
  `40P01`; the repaired schema completed both calls with one fresh winner and one
  typed stale result, **no deadlock**.
- Production build at repair HEAD: **PASS**, including 36/36 static pages.
- Direct ESLint over every repair TypeScript file: **PASS**.
- Controller post-repair full suite: **219 files passed; 1330 passed, 8 skipped**.
- `git diff --check` for the reviewed/repair deltas: **PASS**.
- `npx tsc --noEmit`: only the seven documented unrelated test-fixture errors;
  no reviewed file appears.

Verified by: focused and extended Vitest suites, two real two-connection PostgreSQL
races, production build, direct ESLint, typecheck-baseline comparison, full-suite
controller evidence, and commit-specific diff inspection.

Skipped/Failed: No production deploy, migration, push, merge, or rollout was
performed. The repository-wide standalone typecheck remains baseline-red on seven
unrelated test-fixture diagnostics. No product file was edited by this review.
