# Answer Correctness — Design (2026-06-05)

> Stops wrong answers from ever reaching a live game. Built after Heather's
> 2026-06-03 show, where AI questions shipped factually-wrong marked answers
> (Demi Moore → Arnold instead of Bruce Willis; One Hour Photo → The Johnsons
> instead of The Yorkins; a Robin Williams death-year of 2015 instead of 2014).
> She hand-corrected 21 scores live in front of paying players.

## What actually went wrong (validated, not assumed)

A read-only validation + a model benchmark (`scripts/benchmark-answer-correctness.mjs`,
run 2026-06-05) established:

1. **It ran on Haiku 4.5**, which writes careless, ambiguous, and occasionally
   mis-keyed questions. Benchmark over 4 topics × 20 questions, Opus fact-checking
   every answer: **Haiku 6.4% flat-wrong + 19/78 ambiguous**; **Sonnet 2.5% (both
   arguable edge-cases) + 10**; **Opus 0% + 2**. Haiku even **reproduced the exact
   live bug** — it marked Robin Williams' death year as 2015 again.
2. **Knowledge was never the gap.** Asked the broken facts directly, *all three*
   models scored 6/6 — Haiku included. Haiku knows Demi Moore married Bruce Willis;
   it just writes a bad question and lets the marked answer drift off the right one.
3. **Nothing verifies the marked answer is correct, anywhere** — not at AI
   generation, host entry, host edit, or scoring (`lib/ai/generate-questions.ts`,
   `app/api/categories/[id]/generate/route.ts`, `app/api/categories/[id]/manual/route.ts`,
   `app/api/questions/[id]/route.ts`, DB `resolve_question`). Whatever is flagged is
   trusted and scored.
4. **The marked answer is a separate stored index** (`correct_index`) that can drift
   from the answer the model actually intends.
5. ~~The edit screen doesn't surface which answer is marked correct~~ — **CORRECTED
   after reading the code:** `components/host/gen/HostGenEdit.tsx` already shows the
   marked answer with a colored row + a "✓ CORRECT" pill (header: "CLICK ANY ROW TO
   MARK IT CORRECT"). The edit screen is already honest. The only true residual is that
   any field change (even a point-value swap) stamps `source='host-edit'`, so the stamp
   doesn't *prove* she vetted the answer — but with the verification below, the AI
   questions she edits are already correct before she opens them.

## Decisions

- **Writer model: Claude Sonnet 4.6** (`claude-sonnet-4-6`), replacing the Haiku 4.5
  default. Haiku is removed for generation. (~$0.63/night.)
- **Independent fact-check at generation, on Opus** (`claude-opus-4-8`) — a cold,
  per-question pass that re-derives the answer without seeing what was marked, and
  reports `{ correct, trueAnswer, ambiguous }`. Cheap (~$1.70/night) and the strongest
  judge. Runs **upstream of the host** — she never sees a flagged question.
  - NOTE: Opus 4.8 rejects the `temperature` param ("deprecated for this model") —
    omit it for that model (already handled in the benchmark script).
- **Never surface a wrong OR ambiguous question.** The check keeps only verified,
  single-defensible-answer questions; wrong/ambiguous ones are **regenerated** (bounded
  retries). If a topic can't yield a full clean batch, **emit fewer** (e.g. 18) rather
  than ship a landmine. This makes real the prompt's existing "skip a question rather
  than emit one you're not certain of."
- **Structural anti-drift — DEFERRED (verifier subsumes it).** Emitting the answer
  *text* and deriving the index would prevent index/answer drift, but the verifier
  already catches a drifted answer (reads as "marked answer wrong" → regenerated). Not
  needed for correctness; a future optimization to cut regeneration, not part of this build.
- **Honest edit screen — ALREADY SATISFIED.** `components/host/gen/HostGenEdit.tsx`
  already marks the correct answer with a colored row + "✓ CORRECT" pill. No rebuild,
  no Figma. Her save is already her confirmation.
- **Timing: build time only.** No verification runs during a live game.

## Build pieces (the whole build — backend only)

Scope collapsed after reading the code: the edit screen is already honest, and the
verifier subsumes anti-drift. What's left is two coupled backend changes in the
generation pipeline:

1. **Writer model → Sonnet.** One-line default change in `lib/ai/generate-questions.ts`
   + a test locking the model id.
2. **Opus verification loop, inside the generation job.** New `lib/ai/verify-answers.ts`
   (Opus cold-check, one batch call, no `temperature`); a pure, testable
   `collectVerifiedQuestions` loop (generate → verify → keep clean / regenerate
   wrong+ambiguous, bounded rounds, emit-fewer on exhaustion); wired into
   `runGenerationJob` **between generation and insert**.
   - **The host never sees an unverified question.** The check runs while the category
     is still `generating`; questions are inserted + broadcast only *after* they pass,
     and the category flips to host-visible (`review`) at the end as today. The pick
     screen reads `review`, so nothing unverified can appear. Cost: extra seconds of
     generation — bump the route's `maxDuration` (120 → 300) for headroom.

## Out of scope

- Live-game verification; any host-facing flag/gate (removed by design); re-scoring a
  question after it has already revealed (the make-good `adjustments` ledger stays as
  the post-hoc fix); the future-night planning dashboard (Track B — separate spec).

## How we prove it (before PR)

- Re-run `scripts/benchmark-answer-correctness.mjs` against the new pipeline: the
  wrong-rate reaching "emit" ≈ 0, ambiguous dropped/regenerated.
- Unit tests: verifier verdict handling, index-from-text derivation, regenerate-on-fail,
  emit-fewer-on-exhaustion.
- `node scripts/full-flow-prod.mjs` stays green (it exercises generation).
- `tsc` 0, `eslint` 0, full `vitest` green.

## Cost (verified by benchmark token usage)

~**$2.30/night** total — Sonnet write (~$0.63) + Opus check (~$1.70), for a full
12-category / ~240-question night. Negligible for a paid show.

## Validation update (2026-06-05, after empirical testing — what actually shipped)

Tested against 12 diverse topics (geography, chemistry, WWII, literature, film, Olympics,
marine biology, cuisine, space, 80s pop, ancient Egypt, celebrity marriages) with
independent adversarial re-checks. Three things changed the design:

1. **Verifier reliability — found + fixed (and the end-to-end PR validation caught my
   *first* attempt at it).** The verifier sometimes returns an *incomplete* verdict set on
   a batch. My first fix made it **throw** on incompleteness — but driving a real
   generation through the deployed route showed that turns one Opus hiccup into a **total
   generation failure** (the category rolled back to draft, host gets nothing). Corrected
   contract in `lib/ai/verify-answers.ts`: verify in **chunks of 6**, **retry up to 3× to
   fill gaps**, keep verdicts minimal (dropped the free-text `trueAnswer` field so the
   model reliably returns one per question), and **degrade gracefully** — return whatever
   verdicts came back; the caller drops the unverified few (safe: never emits an unverified
   question, never fails the whole job). Real SDK errors (429/network) still throw and fail
   the job, which is correct.

2. **A single check isn't airtight → double-verify.** One Opus pass has wobble on
   borderline questions: a held-out judge disagreed with ~**5%** of single-checked
   questions across the battery. So each question must now pass **two independent verify
   passes** that both agree it's correct AND unambiguous (`verifyPasses: 2`, run
   concurrently). That halves the slip to ~**2.5%** and drops contestable questions, not
   just clearly-wrong ones. `maxRounds` is **1** (one round of 20 yields plenty after
   double-verify, and keeps the extra checks safely inside the 300s budget).

3. **Honest limit — 0% is not reachable with an AI judge.** The ~2.5% residual is
   *genuinely contestable* questions (concentrated in fuzzy topics like cuisine and
   celebrity marriages — e.g. "is Budapest *or* Bratislava on the Danube?" → both), not
   wrong keys. Clear factual errors (the Demi Moore kind) *are* caught reliably. Most
   topics scored 0 slips. The make-good `adjustments` ledger remains the catch for the
   rare residual. Brandon set the bar at double-check on 2026-06-05.

**Revised cost:** ~**$3–4/night** (two verify passes instead of one). Still negligible.
