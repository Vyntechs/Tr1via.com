# Root-fix research: making AI trivia answers right without checking them so many times

_Research-only report (no code changed). 12-agent web-grounded study, adversarially verified, then reconciled by hand against the actual repo. 2026-06-14._

## The 3 lines
- **What we hoped:** "build each answer from a real source so it's right by construction → stop checking." It is **not** the root fix here.
- **Why:** source-grounding is **costlier** (a fixed web-search fee that doesn't shrink), works **backwards** (strong on mainstream topics the model already nails, thin/empty on the niche/local on-demand topics that are your whole product), still misgrounds ~17–33% in practice, and only helps ONE of your TWO error types. Pre-made question banks can't serve arbitrary host topics at all (live probe: 15/17 topics returned nothing).
- **The real root fix:** make the **writer** stop producing ambiguous questions (the cheap "name the metric / justify each wrong option" self-check), **keep one strong fact-check** (your existing Opus pass is already a different, stronger model re-deriving the answer cold — don't downgrade it), and only then consider dropping the redundant **second** check. Net: fewer bad questions + a modest cost trim — **not** "never check again."

— stop reading here unless you want the detail —

## Your two real error classes (both are documented live mis-keys)
1. **Ambiguous / malformed questions** (prompt-documented, `lib/ai/prompts.ts:97–174`):
   - *Patronus:* the 4 options weren't spell names — they were descriptions. Structural.
   - *Eucalyptus:* "most commonly harvested tree" is metric-ambiguous (by volume = Pine; by plantation count = Eucalyptus). No single defensible answer.
2. **Confident-wrong facts** (`scripts/benchmark-answer-correctness.mjs:39–45`):
   - *Demi Moore* married → marked **Arnold**, truth is **Bruce Willis** (live mis-key).
   - *One Hour Photo* family → marked **The Johnsons**, truth is **The Yorkins** (live mis-key).

The disambiguation self-check fixes class 1. The kept Opus check guards class 2. **Source-grounding would only have helped class 2** — and even there it's the costlier, less reliable path for your topic mix.

## Why source-grounding / "build from a citation" is not the root fix
- **Cost:** Claude's web-search tool is a **fixed $10 per 1,000 searches** on top of tokens — it doesn't get cheaper as models do. Grounded generation lands ~**$0.18–0.22/category** vs today's ~dime. Cost-neutral-to-higher, not a saving.
- **Inverse to need:** retrieval is rich on mainstream subjects (which the model already gets right) and **thin/SEO-spam/absent on the niche, local, on-demand topics** a host invents — exactly where errors happen — and there it silently degrades back to ungrounded memory.
- **Not actually "by construction":** authoritative-retrieval RAG still hallucinates **17–33%** via misgrounding (Stanford legal-RAG study). The citation makes it *auditable*, not *correct*.
- **Arbitrary topics break the cheap variant:** the fetch tool can't construct URLs, so without a discovery search there's no cheap fetch-only path for open topics.
- **Question banks are out:** can't serve arbitrary host topics (live probe: 15/17 common topics returned NONE; one API silently served off-topic rows).
- **Calibration/abstention is out:** it *withholds* errors, doesn't correct them, and is same-model (weaker than your existing cross-model Opus check).

## The recommended root fix (reconciled hybrid)
1. **Disambiguation + distractor self-check at write time** (highest value, lowest risk). Extend the Sonnet writer so every stem must name its metric (the prompt's own "pick a metric" fix) and the model asserts why each wrong option is wrong. No DB change, no new key. Directly kills the ambiguity class and *raises clean-yield* (fewer rejects → fewer expensive re-checks).
2. **Keep ONE strong Opus cold cross-model check** for the confident-wrong-fact class. Today Sonnet writes and Opus re-derives the answer *from scratch* ("do NOT assume the marked answer is right") — that's already an independent, stronger second opinion. Do **not** swap it for a cheaper same-model check. _(This corrects my earlier-session "Sonnet-first checker" idea — that would be weaker, because your check is already cross-model.)_
3. **Optionally drop the redundant SECOND Opus pass (2→1)** for a modest cost trim — **only if** a re-run benchmark shows the wrong-answer rate doesn't rise. This is the one real tradeoff.
4. **Fix the benchmark's stale Opus price first** (`scripts/benchmark-answer-correctness.mjs:35` → `[5,25]`) and re-measure, so every cost/accuracy decision rests on real numbers.

## Projected cost & accuracy vs today (honest — these are estimates, not measured)
- **Cost today:** unsettled. My earlier token estimate said ~$0.13/category with Opus ~54%; the research argues ~$0.08–0.10 with Opus ~25–35%. **The two disagree and neither is measured** — and the tool that would settle it is mis-priced. Treat it as **"roughly a dime, Opus a meaningful-but-not-dominant slice."**
- **Cost after fix:** roughly **flat to slightly lower** (a penny or two saved if the 2nd pass is dropped; the self-check adds ~a penny but partly pays for itself by cutting rejects/refills). **The dollar win is small.** The bigger win is question *quality*.
- **Wrong-answer rate:** ~2.5% today → projected **~1.5–2.0%**. A real but modest drop. **Explicitly NOT 0% and NOT "correct by construction"** — no from-memory generator on arbitrary topics reaches zero, and I won't claim it does.
- **Checking eliminated:** at most **half** (the redundant 2nd Opus pass), gated on measurement. You cannot safely remove checking entirely here.

## Migration path (only after you approve direction — PR-first, no deploy near the Wed show)
0. Fix the benchmark's stale Opus rate (~1 hr).
1. Re-run the benchmark for the TRUE baseline $/category + wrong-rate (becomes the A/B control).
2. Add the disambiguation/distractor self-check to `lib/ai/generate-questions.ts`; benchmark vs control.
3. (Gated) Drop `verifyPasses: 2 → 1` in the generate route; adopt **only if** residual error stays ≤ control, else keep 2 and ship Step 2 alone.
4. Compose with the safety net (surface the tightened question + single Opus verdict for host confirm; re-verify edits; cap rerolls). **No new stored column → does not reopen the PR #106 `correct_index` leak surface.**

## Composes with the already-decided safety net
Strengthens it: the host reviews a tighter artifact (metric named, distractors justified-false, one Opus verdict). Edits re-run the same single Opus check. Reroll cap unchanged — and the self-check *reduces* reroll pressure. No new DB column, so the RLS answer-leak fix (migration 0014) stays intact.

## The one decision for Brandon
**Approve dropping the SECOND Opus check (2→1)** in exchange for a modest cost cut — accepting the random-error component may tick up slightly while the ambiguity component drops, with the net **proven by the re-run benchmark before that change ships.** If the benchmark shows error rising, we keep both passes and ship only the (low-risk) disambiguation lever. Everything else (fixing the benchmark price, the disambiguation self-check) is low-risk and reversible.

## Sources
- Repo: `lib/ai/prompts.ts:97–174` (both documented ambiguity failures + "pick a metric" fix); `scripts/benchmark-answer-correctness.mjs:35,39–45` (stale Opus price; live fact-recall mis-keys); `lib/ai/verify-answers.ts` (Opus cold cross-model check); `lib/ai/collect-verified-questions.ts` (verifyPasses=2 only halves wobble, "cannot reach 0%"); `app/api/categories/[id]/generate/route.ts` (async background job, 300s budget — latency is slack); `tasks/pr106-validation-report.md` (the leak surface a citation column would reopen).
- External: Anthropic pricing + web-search tool docs (fixed $10/1k search fee; fetch can't construct URLs); Stanford legal-RAG study (17–33% misgrounding); I-CALM abstention paper (abstention withholds, doesn't correct); arXiv 2404.02124 (LLM distractor passes can hallucinate — the self-check needs the same fact-discipline as the answer).

**Verified by:** read `benchmark-answer-correctness.mjs:20–54` and `prompts.ts:85–179` directly to confirm/correct the agents' two load-bearing claims; cross-checked the cost claim against the prior token-level cost diagnosis (the two estimates disagree → flagged as unsettled, not asserted).
**Skipped/Failed:** Did NOT re-run the live benchmark (research-only; it needs the price fix first). Cost split (Opus 30% vs 54%) remains unresolved until that re-run. No code changed.
