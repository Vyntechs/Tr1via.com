// Answer-correctness benchmark — Haiku 4.5 vs Sonnet 4.6 vs Opus 4.8, with an
// independent Opus fact-check judge. Built after Heather's 2026-06-03 live show,
// where Haiku-generated questions shipped factually WRONG marked answers
// (Demi Moore -> Arnold instead of Bruce Willis, etc.).
//
// It answers two questions with real numbers, not vibes:
//   PROBE A (recall): given the EXACT broken questions + hard controls, does each
//     model pick the truly-correct option? Truth is known here, so we score directly.
//   PROBE B (generation + judge): each model generates a real 20-question batch on
//     the genres that failed; Opus then independently fact-checks every marked
//     answer. Metric = factually-wrong + ambiguous "landmines per 20" per model,
//     and how many the Opus judge catches (validates the verification design).
//
// Run: npx tsx --env-file=.env.local scripts/benchmark-answer-correctness.mjs
// READ-ONLY: calls the Anthropic API only. Touches no DB, no prod data.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, userPromptFor } from "../lib/ai/prompts.ts";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("ANTHROPIC_API_KEY not in env. Run with: npx tsx --env-file=.env.local scripts/benchmark-answer-correctness.mjs");
  process.exit(1);
}
const client = new Anthropic({ apiKey: key });

const MODELS = {
  Haiku: "claude-haiku-4-5-20251001",
  Sonnet: "claude-sonnet-4-6",
  Opus: "claude-opus-4-8",
};
const JUDGE_MODEL = "claude-opus-4-8";

// $/MTok (input, output) — current published rates (2026-06).
// Opus 4.8 corrected from the deprecated [15,75] to [5,25]; every cost number
// below was ~3x-inflated on the Opus slice until this fix.
const RATES = { Haiku: [1, 5], Sonnet: [3, 15], Opus: [5, 25] };

// Optional focus, e.g. BENCH_MODELS="Sonnet" runs only the production generator
// for a cheap, targeted A/B. Default: all three for the full comparison.
const ONLY = (process.env.BENCH_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ACTIVE_MODELS = ONLY.length
  ? Object.fromEntries(Object.entries(MODELS).filter(([l]) => ONLY.includes(l)))
  : MODELS;

// ── PROBE A: known-truth recall ───────────────────────────────────────────
// The two clean live-show mis-keys + hard celebrity/film controls with settled answers.
const RECALL = [
  { q: "Demi Moore was married to which of these actors?",
    options: ["Bruce Willis", "Jean-Claude Van Damme", "Steven Seagal", "Arnold Schwarzenegger"],
    truth: "Bruce Willis", note: "LIVE mis-key — Haiku marked Arnold" },
  { q: "In the film One Hour Photo, Robin Williams' character Sy is obsessed with which family?",
    options: ["The Yorkins", "The Nilsons", "The Johnsons", "The Harringtons"],
    truth: "The Yorkins", note: "LIVE mis-key — Haiku marked The Johnsons" },
  { q: "Which actor did Jennifer Aniston marry in 2000?",
    options: ["Brad Pitt", "Justin Theroux", "Vince Vaughn", "John Mayer"],
    truth: "Brad Pitt", note: "control" },
  { q: "Tom Cruise was married to which actress from 2006 to 2012?",
    options: ["Katie Holmes", "Nicole Kidman", "Penélope Cruz", "Mimi Rogers"],
    truth: "Katie Holmes", note: "control (Kidman is the trap — that was 1990–2001)" },
  { q: "In the 1988 film Big, Tom Hanks' character makes a wish on what kind of machine?",
    options: ["A Zoltar fortune-teller machine", "A claw crane game", "A pinball machine", "A photo booth"],
    truth: "A Zoltar fortune-teller machine", note: "control" },
  { q: "Which singer was married to both Whitney Houston and, later, no one else famous — i.e. who was Whitney Houston's husband?",
    options: ["Bobby Brown", "Eddie Murphy", "Ray J", "Babyface"],
    truth: "Bobby Brown", note: "control" },
];

// ── PROBE B: generation topics (echo the genres that failed) ───────────────
const GEN_TOPICS = [
  "Celebrities married multiple times",
  "Robin Williams movies",
  "Famous bridges of the world",
  "One-hit-wonder songs of the 1990s",
];
const COUNT = 20;

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

const PICK_TOOL = {
  name: "pick_answer",
  description: "State which single option is factually correct.",
  input_schema: {
    type: "object",
    properties: { choice: { type: "string", description: "the exact text of the correct option" } },
    required: ["choice"], additionalProperties: false,
  },
};

const JUDGE_TOOL = {
  name: "verdicts",
  description: "Independent fact-check verdicts for each question.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            markedAnswerIsCorrect: { type: "boolean" },
            trueAnswer: { type: "string" },
            ambiguous: { type: "boolean", description: "true if no single option is defensibly correct" },
          },
          required: ["index", "markedAnswerIsCorrect", "trueAnswer", "ambiguous"],
          additionalProperties: false,
        },
      },
    },
    required: ["verdicts"], additionalProperties: false,
  },
};

// Opus 4.8 rejects the `temperature` param ("deprecated for this model"); omit it there.
const noTemp = (model) => model.includes("opus-4-8");
const toolInput = (resp, name) => resp.content.find((b) => b.type === "tool_use" && b.name === name)?.input;
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/^(a|an|the)\s+/, "");
const usageCost = (label, u) => {
  const [ci, co] = RATES[label] ?? RATES[label.split(" ")[0]] ?? [0, 0];
  return ((u?.input_tokens ?? 0) / 1e6) * ci + ((u?.output_tokens ?? 0) / 1e6) * co;
};
// Opus occasionally double-encodes the verdicts array as a JSON string inside
// the tool input (the same quirk lib/ai/verify-answers.ts handles). Coerce to
// an array so the caller's .map never throws and a topic isn't lost to an ERR.
function asVerdictArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.verdicts)) return p.verdicts;
    } catch {
      /* fall through to [] */
    }
  }
  return [];
}

// ── PROBE A ────────────────────────────────────────────────────────────────
async function recallProbe() {
  console.log("\n════════ PROBE A — known-truth recall (temp 0) ════════");
  const score = Object.fromEntries(Object.keys(ACTIVE_MODELS).map((l) => [l, 0]));
  for (const item of RECALL) {
    const line = [];
    for (const [label, model] of Object.entries(ACTIVE_MODELS)) {
      try {
        const r = await client.messages.create({
          model, max_tokens: 200, ...(noTemp(model) ? {} : { temperature: 0 }),
          messages: [{ role: "user", content:
            `Question: ${item.q}\nOptions:\n${item.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}\n\nWhich option is factually correct? Call pick_answer with the exact option text.` }],
          tools: [PICK_TOOL], tool_choice: { type: "tool", name: "pick_answer" },
        });
        const choice = toolInput(r, "pick_answer")?.choice ?? "";
        const ok = norm(choice) === norm(item.truth);
        if (ok) score[label]++;
        line.push(`${label}:${ok ? "✓" : `✗(${choice.slice(0, 18)})`}`);
      } catch (e) {
        line.push(`${label}:ERR(${String(e?.message ?? e).slice(0, 30)})`);
      }
    }
    console.log(`\n  ${item.q}`);
    console.log(`    truth: ${item.truth}  [${item.note}]`);
    console.log(`    ${line.join("   ")}`);
  }
  console.log(`\n  RECALL SCORE (of ${RECALL.length}):  ` +
    Object.entries(score).map(([k, v]) => `${k} ${v}/${RECALL.length}`).join("   "));
}

// ── PROBE B ────────────────────────────────────────────────────────────────
async function generate(label, model, topic) {
  const r = await client.messages.create({
    model, max_tokens: 8000, ...(noTemp(model) ? {} : { temperature: 0.7 }),
    system: [{ type: "text", text: SYSTEM_PROMPT }],
    messages: [{ role: "user", content: userPromptFor({ topic, count: COUNT, difficulty: "normal" }) }],
    tools: [EMIT_TOOL], tool_choice: { type: "tool", name: "emit_questions" },
  }, { timeout: 120_000 });
  return { questions: toolInput(r, "emit_questions")?.questions ?? [], usage: r.usage };
}

async function judge(questions) {
  const payload = questions.map((q, i) => ({
    index: i, prompt: q.prompt, options: q.options, markedAnswer: q.options[q.correctIndex],
  }));
  const r = await client.messages.create({
    model: JUDGE_MODEL, max_tokens: 4000, ...(noTemp(JUDGE_MODEL) ? {} : { temperature: 0 }),
    system: [{ type: "text", text:
      "You are a meticulous, independent trivia fact-checker. For each question, work out the correct answer from your own knowledge. Do NOT assume the markedAnswer is right. markedAnswerIsCorrect=true only if the marked answer is unambiguously the single correct option. Set ambiguous=true if two or more options are defensibly correct or the question has no single right answer." }],
    messages: [{ role: "user", content: `Fact-check these ${payload.length} questions:\n${JSON.stringify(payload, null, 1)}` }],
    tools: [JUDGE_TOOL], tool_choice: { type: "tool", name: "verdicts" },
  }, { timeout: 120_000 });
  return { verdicts: asVerdictArray(toolInput(r, "verdicts")?.verdicts), usage: r.usage };
}

async function genProbe() {
  console.log("\n\n════════ PROBE B — generate then Opus-fact-check (landmines per 20) ════════");
  const totals = {};
  for (const label of Object.keys(ACTIVE_MODELS)) totals[label] = { wrong: 0, ambiguous: 0, total: 0, genCost: 0, judgeCost: 0 };
  const samples = [];

  for (const topic of GEN_TOPICS) {
    for (const [label, model] of Object.entries(ACTIVE_MODELS)) {
      try {
        const g = await generate(label, model, topic);
        const j = await judge(g.questions);
        const vByIdx = new Map(j.verdicts.map((v) => [v.index, v]));
        let wrong = 0, ambiguous = 0;
        const badOnes = [];
        g.questions.forEach((q, i) => {
          const v = vByIdx.get(i);
          if (!v) return;
          if (v.ambiguous) ambiguous++;
          else if (!v.markedAnswerIsCorrect) { wrong++; badOnes.push({ q, v }); }
        });
        totals[label].wrong += wrong;
        totals[label].ambiguous += ambiguous;
        totals[label].total += g.questions.length;
        totals[label].genCost += usageCost(label, g.usage);
        totals[label].judgeCost += usageCost("Opus", j.usage);
        console.log(`  ${topic.padEnd(34)} ${label.padEnd(7)} ${String(g.questions.length).padStart(2)}q  wrong:${wrong}  ambiguous:${ambiguous}`);
        if (badOnes.length) samples.push({ topic, label, badOnes });
      } catch (e) {
        console.log(`  ${topic.padEnd(34)} ${label.padEnd(7)} ERR ${String(e?.message ?? e).slice(0, 40)}`);
      }
    }
  }

  console.log("\n──────── PROBE B totals ────────");
  for (const [label, t] of Object.entries(totals)) {
    const rate = t.total ? ((t.wrong / t.total) * 100).toFixed(1) : "—";
    console.log(`  ${label.padEnd(7)} wrong ${t.wrong}/${t.total} (${rate}%)  ambiguous ${t.ambiguous}   gen $${t.genCost.toFixed(3)}  judge(Opus) $${t.judgeCost.toFixed(3)}`);
  }

  console.log("\n──────── Sample landmines the judge caught (model marked these WRONG) ────────");
  for (const s of samples.slice(0, 8)) {
    for (const { q, v } of s.badOnes.slice(0, 2)) {
      console.log(`\n  [${s.label} · ${s.topic}] ${q.prompt}`);
      q.options.forEach((o, i) => console.log(`    ${i === q.correctIndex ? "✗marked" : "       "} ${o}`));
      console.log(`    judge says correct: ${v.trueAnswer}`);
    }
  }
}

console.log("TR1VIA answer-correctness benchmark — Haiku vs Sonnet vs Opus, Opus judge.");
await recallProbe();
await genProbe();
console.log("\nDone.\n");
