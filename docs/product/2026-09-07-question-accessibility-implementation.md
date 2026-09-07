# Question accessibility: first implementation

**Branch:** `feat/question-accessibility`

**Scope:** generation, verified candidate refill, and automatic board selection.

**Motivation:** Brandon reports that many lower-placing players are discouraged by unfamiliar questions with no apparent way to know the answer.

The previous prompt discouraged informed elimination and requested only three easy candidates in a pool of twenty. Automatic selection sampled the pool by relative difficulty, which could place difficult questions into the low-point slots.

The implemented behavior is:

- Generation permits familiar knowledge, recognition, and informed elimination. It evaluates difficulty against ordinary venue players and explicitly forbids relabeling a specialist question as easy to satisfy a quota.
- The normal candidate pool targets eight approachable (1–2), nine moderate (3–5), and three stretch (6–7) items. Easy targets 10/8/2; hard targets 6/9/5. All support the same 3/3/1 automatic board.
- Verification continues to use the existing blind and adversarial fact/ambiguity checks. The collector reserves space for each difficulty band; subsequent calls request the missing bands rather than filling those spaces with excess hard questions.
- Automatic selection places three approachable items into 100–300, three moderate items into 400–600, and one stretch item into 700. Automatic assignment ignores stale point overrides; explicit manual picks still honor them.
- A generated pool needs enough coverage to support that board before it becomes ready for review or automatic play. Bounded failure keeps first-run progress resumable. Rerolls retain their atomic replacement behavior and preserve kept questions if generation cannot finish.
- Resuming an older, skewed pool re-verifies its unpicked AI rows, removes surplus rows from overfilled bands through the existing fenced operation, and fills the missing bands. It does not change a live board.

The examples in [the sample category](2026-09-07-question-accessibility-examples.md) illustrate the desired editorial outcome. They were authored and source-checked for review; they are not evidence of live-model compliance.

## Limits and verification

Difficulty remains a model estimate. These changes enforce balance among those estimates; they do not independently certify real audience success rates or prove increased enjoyment. The additional refill requirement can increase generation work, still bounded by the existing four-round limit. There are no new schema migrations or scoring rules. Existing manual selections remain the host's decision.

Verification covers generation-request transport; fact rejection followed by targeted easy-question refill; all-hard input; stable selection and low-point assignments; unique question IDs; resume with an old skewed pool; preservation of kept reroll questions; and resumable failure.

- Full Vitest suite: **275 files passed; 1,847 tests passed, 8 skipped**.
- TypeScript: **`npx tsc --noEmit` passed**.
- Required venue-scale traffic/recovery guards: **34 passed**.
- Production build: **`npm run build` passed**.
- After tightening automatic assignment to ignore stale point overrides, the affected route, manual-persistence, and difficulty tests passed again: **23 passed**. The production build includes this final change.

The route tests execute the actual generation/refill/pick orchestration with model, network, and persistence boundaries mocked. The full suite also includes existing real-Postgres integration tests. No live model-generation benchmark or venue session was run for this change; the sample questions are authored examples, not generated-output validation.

## Release path

This is a reviewable implementation on a feature branch. Production merge and deployment remain founder decisions under [AGENTS.md](../../AGENTS.md), outside live Wednesday shows. The next product work after review is the repeated-miss player experience described in the broader strategy; it should build on a stronger question experience.
