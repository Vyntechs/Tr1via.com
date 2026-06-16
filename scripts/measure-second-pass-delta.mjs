// Does the SECOND Opus verify pass earn its cost?
//
// Production keeps a question only if EVERY verify pass agrees it's clean, so a
// bad question ships only if ALL passes miss it. The 2nd pass's marginal value =
// landmines that pass 1 marks clean but pass 2 catches (those would ship under a
// single pass). This is a PAIRED measurement (same questions, two judge draws),
// so it dodges the big run-to-run variance of comparing fresh batches — the right
// signal for the verifyPasses 2→1 decision.
//
// Run: npx tsx --env-file=.env.local scripts/measure-second-pass-delta.mjs
// READ-ONLY: Anthropic API only. Real spend (~$0.10–0.15/topic).

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, userPromptFor } from "../lib/ai/prompts.ts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GEN_MODEL = "claude-sonnet-4-6";
const VERIFY_MODEL = "claude-opus-4-8";
const CHUNK = 6;
const TOPICS = ["Celebrities married multiple times", "Robin Williams movies", "Famous bridges of the world", "One-hit-wonder songs of the 1990s"];

const EMIT_TOOL = { name: "emit_questions", description: "Emit trivia questions. Call once.", input_schema: { type: "object", properties: { questions: { type: "array", minItems: 1, items: { type: "object", properties: { prompt: { type: "string", minLength: 8, maxLength: 400 }, options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 160 } }, correctIndex: { type: "integer", minimum: 0, maximum: 3 }, difficulty: { type: "integer", minimum: 1, maximum: 7 }, factBlurb: { type: "string", minLength: 8, maxLength: 280 }, photoQuery: { type: "string", minLength: 2, maxLength: 80 } }, required: ["prompt", "options", "correctIndex", "difficulty", "factBlurb", "photoQuery"], additionalProperties: false } } }, required: ["questions"], additionalProperties: false } };
const VERDICTS_TOOL = { name: "verdicts", description: "One verdict per index.", input_schema: { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, markedAnswerIsCorrect: { type: "boolean" }, ambiguous: { type: "boolean" } }, required: ["index", "markedAnswerIsCorrect", "ambiguous"], additionalProperties: false } } }, required: ["verdicts"], additionalProperties: false } };
const VERIFIER_SYSTEM = "You are a meticulous, independent trivia fact-checker. For each question, work out the correct answer from your OWN knowledge. Do NOT assume the markedAnswer is right. Set markedAnswerIsCorrect=true only if the marked answer is unambiguously the single correct option. Set ambiguous=true if two or more options are defensibly correct, or the question has no single defensible answer. Return exactly one verdict for every question index. Output only the verdicts — no explanations.";

const toolInput = (resp, name) => resp.content.find((b) => b.type === "tool_use" && b.name === name)?.input;
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : (Array.isArray(p?.verdicts) ? p.verdicts : []); } catch { return []; } })() : []);
const isClean = (v) => v && v.markedAnswerIsCorrect && !v.ambiguous; // ships only if clean

async function generate(topic) {
  const r = await client.beta.promptCaching.messages.create({ model: GEN_MODEL, max_tokens: 8000, temperature: 0.7, system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: userPromptFor({ topic, count: 20, difficulty: "normal" }) }], tools: [EMIT_TOOL], tool_choice: { type: "tool", name: "emit_questions" } }, { timeout: 120_000 });
  return toolInput(r, "emit_questions")?.questions ?? [];
}
async function judgeOnce(questions) {
  const chunks = [];
  for (let s = 0; s < questions.length; s += CHUNK) chunks.push({ start: s, items: questions.slice(s, s + CHUNK) });
  const all = await Promise.all(chunks.map(async (c) => {
    const payload = c.items.map((q, i) => ({ index: i, prompt: q.prompt, options: q.options, markedAnswer: q.options[q.correctIndex] }));
    const r = await client.messages.create({ model: VERIFY_MODEL, max_tokens: 2000, system: VERIFIER_SYSTEM, messages: [{ role: "user", content: `Fact-check these ${payload.length} questions. Return exactly ${payload.length} verdicts:\n${JSON.stringify(payload, null, 0)}` }], tools: [VERDICTS_TOOL], tool_choice: { type: "tool", name: "verdicts" } }, { timeout: 60_000 });
    return asArray(toolInput(r, "verdicts")?.verdicts).map((v) => ({ ...v, index: c.start + v.index }));
  }));
  const map = new Map(); for (const v of all.flat()) map.set(v.index, v); return map;
}

console.log("2nd-pass delta — would a single Opus pass ship more landmines? (paired, same questions)\n");
let totalQ = 0, shipBad1 = 0, shipBad2 = 0, p2CatchesP1Misses = 0, p1CatchesP2Misses = 0;
for (const topic of TOPICS) {
  const qs = await generate(topic);
  const [p1, p2] = await Promise.all([judgeOnce(qs), judgeOnce(qs)]);
  let b1 = 0, b2 = 0, only2 = 0, only1 = 0;
  qs.forEach((_, i) => {
    const c1 = isClean(p1.get(i)), c2 = isClean(p2.get(i));
    // 1-pass gate uses pass1 only: a bad Q ships if pass1 says clean but the other (truth proxy = union of flags) flagged it.
    if (c1 && !c2) { b1++; only2++; }      // ships under 1-pass, caught by adding pass2
    if (c2 && !c1) { only1++; }            // pass2 missed, pass1 caught (symmetric noise)
    if (!c1 && !c2) { /* both flag — dropped by either */ }
  });
  totalQ += qs.length; shipBad1 += b1; shipBad2 += b2; p2CatchesP1Misses += only2; p1CatchesP2Misses += only1;
  console.log(`  ${topic.padEnd(34)} ${String(qs.length).padStart(2)}q  pass2-catches-pass1-misses:${only2}  pass1-catches-pass2-misses:${only1}`);
}
console.log(`\n  Across ${totalQ} questions:`);
console.log(`    Adding the 2nd pass drops ${p2CatchesP1Misses} extra question(s) that a single pass would have shipped.`);
console.log(`    (Symmetric check — pass1 caught ${p1CatchesP2Misses} that pass2 missed; the two passes are near-deterministic Opus, so disagreement ≈ the only thing the 2nd pass buys.)`);
console.log(`    Single-pass marginal landmine rate vs two-pass: +${((p2CatchesP1Misses / totalQ) * 100).toFixed(2)}% of generated questions.`);
console.log("\nDone.\n");
