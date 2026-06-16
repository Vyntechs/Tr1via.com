// TRUE per-category cost probe.
//
// The answer-correctness benchmark measures landmine RATES well, but its single
// Opus judge-call over 20 questions does NOT reflect the real pipeline's verify
// cost (production runs 2 passes × ceil(N/6) chunked Opus calls + refill rounds).
// This probe drives the REAL orchestrator (lib/ai/collect-verified-questions —
// pure, type-only imports, so it loads under tsx) with generate/verify closures
// that mirror the production lib (generate-questions + verify-answers, which are
// `server-only` and can't import here) and accumulates real token usage at the
// canonical prices (lib/ai/usage-cost). Output is the measured $/category split
// into Sonnet generation vs Opus verification.
//
// Run: npx tsx --env-file=.env.local scripts/measure-generation-cost.mjs
// READ-ONLY: Anthropic API only, no DB. Real spend (~$0.10–0.15/topic).

import Anthropic from "@anthropic-ai/sdk";
import { collectVerifiedQuestions } from "../lib/ai/collect-verified-questions.ts";
import { SYSTEM_PROMPT, userPromptFor } from "../lib/ai/prompts.ts";
import { costUsd } from "../lib/ai/usage-cost.ts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GEN_MODEL = "claude-sonnet-4-6";
const VERIFY_MODEL = "claude-opus-4-8";
const VERIFY_CHUNK_SIZE = 6; // mirrors lib/ai/verify-answers.ts
const TOPICS = ["Famous bridges of the world", "Robin Williams movies"];

const EMIT_TOOL = {
  name: "emit_questions",
  description: "Emit the batch of generated trivia questions for TR1VIA. Call exactly once.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array", minItems: 1,
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", minLength: 8, maxLength: 400 },
            options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string", minLength: 1, maxLength: 160 } },
            correctIndex: { type: "integer", minimum: 0, maximum: 3 },
            difficulty: { type: "integer", minimum: 1, maximum: 7 },
            factBlurb: { type: "string", minLength: 8, maxLength: 280 },
            photoQuery: { type: "string", minLength: 2, maxLength: 80 },
          },
          required: ["prompt", "options", "correctIndex", "difficulty", "factBlurb", "photoQuery"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"], additionalProperties: false,
  },
};

const VERDICTS_TOOL = {
  name: "verdicts",
  description: "Fact-check verdicts — exactly one per question index.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, markedAnswerIsCorrect: { type: "boolean" }, ambiguous: { type: "boolean" } },
          required: ["index", "markedAnswerIsCorrect", "ambiguous"], additionalProperties: false,
        },
      },
    },
    required: ["verdicts"], additionalProperties: false,
  },
};

const VERIFIER_SYSTEM =
  "You are a meticulous, independent trivia fact-checker. For each question, work out the correct answer from your OWN knowledge. Do NOT assume the markedAnswer is right. Set markedAnswerIsCorrect=true only if the marked answer is unambiguously the single correct option. Set ambiguous=true if two or more options are defensibly correct, or the question has no single defensible answer. Return exactly one verdict for every question index. Output only the verdicts — no explanations.";

const toolInput = (resp, name) => resp.content.find((b) => b.type === "tool_use" && b.name === name)?.input;
const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : (Array.isArray(p?.verdicts) ? p.verdicts : []); } catch { return []; } })() : []);

const cost = { gen: 0, verify: 0, genCalls: 0, verifyCalls: 0 };

async function generate(avoidPrompts, need) {
  const r = await client.beta.promptCaching.messages.create({
    model: GEN_MODEL, max_tokens: 8000, temperature: 0.7,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPromptFor({ topic: TOPIC, count: Math.min(20, need + 1), difficulty: "normal", avoidPrompts }) }],
    tools: [EMIT_TOOL], tool_choice: { type: "tool", name: "emit_questions" },
  }, { timeout: 120_000 });
  cost.gen += costUsd(GEN_MODEL, r.usage); cost.genCalls += 1;
  return toolInput(r, "emit_questions")?.questions ?? [];
}

async function verify(questions) {
  const chunks = [];
  for (let s = 0; s < questions.length; s += VERIFY_CHUNK_SIZE) chunks.push({ start: s, items: questions.slice(s, s + VERIFY_CHUNK_SIZE) });
  const results = await Promise.all(chunks.map(async (chunk) => {
    const payload = chunk.items.map((q, i) => ({ index: i, prompt: q.prompt, options: q.options, markedAnswer: q.options[q.correctIndex] }));
    const r = await client.messages.create({
      model: VERIFY_MODEL, max_tokens: 2000, system: VERIFIER_SYSTEM,
      messages: [{ role: "user", content: `Fact-check these ${payload.length} questions. Return exactly ${payload.length} verdicts:\n${JSON.stringify(payload, null, 0)}` }],
      tools: [VERDICTS_TOOL], tool_choice: { type: "tool", name: "verdicts" },
    }, { timeout: 60_000 });
    cost.verify += costUsd(VERIFY_MODEL, r.usage); cost.verifyCalls += 1;
    return asArray(toolInput(r, "verdicts")?.verdicts).map((v) => ({ ...v, index: chunk.start + v.index }));
  }));
  return results.flat();
}

let TOPIC = "";
console.log("TRUE per-category cost probe (real orchestrator, 2 passes, corrected prices)\n");
const perTopic = [];
for (const topic of TOPICS) {
  TOPIC = topic;
  const before = { gen: cost.gen, verify: cost.verify, gc: cost.genCalls, vc: cost.verifyCalls };
  const kept = await collectVerifiedQuestions({ target: 20, maxRounds: 4, verifyPasses: 2, generate, verify });
  const g = cost.gen - before.gen, v = cost.verify - before.verify;
  const total = g + v;
  perTopic.push({ topic, kept: kept.length, g, v, total, gc: cost.genCalls - before.gc, vc: cost.verifyCalls - before.vc });
  console.log(`  ${topic.padEnd(34)} kept ${String(kept.length).padStart(2)}  genCalls ${cost.genCalls - before.gc} verifyCalls ${cost.verifyCalls - before.vc}  gen $${g.toFixed(4)}  verify(Opus) $${v.toFixed(4)}  total $${total.toFixed(4)}`);
}
const avg = perTopic.reduce((a, t) => a + t.total, 0) / perTopic.length;
const avgV = perTopic.reduce((a, t) => a + t.v, 0) / perTopic.length;
console.log(`\n  AVG per category: $${avg.toFixed(4)}  (Opus verify share: ${((avgV / avg) * 100).toFixed(0)}%)`);
console.log("\nDone.\n");
