# Gen quality + cost — measured results (2026-06-14)

Branch `fix/gen-question-quality`. All numbers measured live on the Anthropic API at corrected prices (Opus $5/$25, Sonnet $3/$15). Generation model = Sonnet 4.6 (production). Benchmark = `scripts/benchmark-answer-correctness.mjs` (price-fixed + robust-judge); cost = `scripts/measure-generation-cost.mjs` (real orchestrator); 2nd-pass = `scripts/measure-second-pass-delta.mjs`.

## 1. Cost — DEFINITIVE (answers "is it crazy high?")

**$0.189 per category** (avg of 2 topics, real pipeline incl. refill rounds), of which **Opus verification = 63%**, Sonnet generation = 37%.

- This **confirms the original ~$0.13/~54% estimate** (slightly higher because refill rounds fire: 2–3 generate calls + 10–12 Opus verify calls per category, not the clean 1+8).
- This **refutes the research synthesis's ~$0.08–0.10 / ~30%** — it assumed the benchmark's single judge-call ≈ real cost; the real verify is 10–12 chunked Opus calls (~$0.11–0.13/category).
- Going forward the real route logs this on every generation: `[generation-cost] … estUsd=…`.

## 2. Quality gate — NO measurable improvement on this sample

| Run (Sonnet, 4 topics, 80 q) | wrong | ambiguous | total landmines | rate |
|---|---|---|---|---|
| BEFORE (gate off) | 3 | 1 | 4 | 5.0% |
| AFTER (gate on) | 1 | 3 | 4 | 5.0% |

Identical landmine count (composition shifted within noise). **Critically, the metric is very noisy:** two runs of the *identical un-gated prompt* gave 5% and ~18% (the "ambiguous" count swung 7→1 on the same topic). A single A/B pair cannot detect a few-point effect against that variance, and the raw base rate (5%) is already low. Proving a small gate effect would need many more runs (poor ROI on an already-working pipeline). **Conclusion: the gate is low-risk and codifies the real documented failure modes, but its quantitative benefit is unproven.**

## 3. Is the 2nd Opus pass redundant? — NO, it earns its cost

Paired measurement (judge the *same* batch twice), 80 questions:
- Adding the 2nd pass drops **2 extra landmines** (2.5% of generated) that a single pass would have shipped.
- (Symmetric: pass 1 caught 3 that pass 2 missed — near-deterministic Opus, so the disagreement ≈ exactly the residual the 2nd pass buys.)
- This **reproduces the code's documented ~5%→~2.5% halving.**

→ Dropping `verifyPasses 2→1` would save ~32% cost (~$0.06/category) **but roughly double the shipped wrong/ambiguous rate (~2.5%→~5%).** Per the brief's gate ("adopt only if shipped rate stays ≤ control"), this **FAILS — keep 2 passes.** The expensive check is not waste; it is the thing keeping wrong answers off Heather's screen.

## Bottom line
There is **no cheap win** to grab here, and that is the honest, useful finding: the pipeline is working as designed, the ~$0.19/category cost is dominated by a fact-check that measurably earns its cost, and the quality is already good (5% raw → ~2.5% shipped). The durable wins from this work are **cost visibility** (real $/category now logged), a **corrected + hardened benchmark**, and **confirmation the system is sound** — not a quality or cost change to the live pipeline.

## What's safe to ship vs. hold
- ✅ SHIP: benchmark price-fix + hardening, `usage-cost.ts` + real cost logging, the two measurement harnesses. Pure wins, no behavior change to generation.
- ❌ DO NOT SHIP: `verifyPasses 2→1` (data says keep 2). Unchanged in code.
- ❓ JUDGMENT CALL (Brandon): the disambiguation gate prompt change — low-risk (can only drop bad questions, refill backfills), codifies real failures, but unproven on this sample.

**Verified by:** live benchmark BEFORE (4/80) vs AFTER (4/80); cost probe ($0.189/cat, 63% Opus); 2nd-pass delta (+2.5% if cut). PROBE A recall 6/6 both runs. tsc clean (2 pre-existing), 25/25 unit tests pass.
**Skipped/Failed:** Did not run a large multi-batch A/B to chase a sub-noise gate effect (poor ROI; flagged). Cost measured on 2 topics; route logging gives the ongoing real number.

---

## Parked: the disambiguation gate (NOT shipped in this PR)

This prompt block was built + applied during the session, then **reverted** so this PR is 100% data-backed (the gate showed no measurable effect on the noisy, already-low landmine rate). It is **low-risk** (it can only *drop* shaky questions; the refill loop backfills) and codifies the real documented failures, so it's a reasonable candidate for the future quality/ROI task — kept here verbatim. It would be inserted in `lib/ai/prompts.ts` immediately before `## Output format`:

```
## Final check before you emit (run this on EVERY question)

Before calling emit_questions, run this gate on each question. If a
question fails any line, FIX it or replace it — never emit it.

1. METRIC NAMED. If the prompt ranks or compares ("most", "biggest",
   "first", "best"), the stem itself must state the exact metric (by
   volume? by population? by year?). If the answer would change under a
   different reasonable metric, rewrite the stem to name the metric — or
   drop the question. (The Eucalyptus failure above is exactly this.)
2. OPTIONS ARE THE RIGHT KIND. All four options are the literal kind of
   thing the prompt asks for — a name for a name, a year for a year. No
   descriptions or hand-waves. (The Patronus failure above is this.)
3. WRONG OPTIONS ARE PROVABLY WRONG. For each of the three wrong options,
   you can say in a few words why it is false. If you can't say why a
   distractor is wrong, it may secretly be defensible — replace it.
4. ONE DEFENSIBLE ANSWER. No two options are both correct under any
   reasonable reading. The marked answer is the single clear winner.
5. PREMISE TRUE AND YOU KNOW IT. The question's premise is factually
   sound (don't assert someone married four times if it was twice) and
   the answer is a settled fact you actually know — not a guess, not a
   "probably", not something that may have changed recently.

A short clean batch beats a full dirty one. When in doubt, drop it — the
host's reputation in front of paying players rides on every question.
```

**If revisited:** prove it with a multi-batch A/B (the single-pair signal is buried in run-to-run variance), and pair it with the real ROI levers — generate fewer candidates (~40% cheaper, no quality loss; needs the "does Heather browse all 20?" answer) and cap rerolls.
