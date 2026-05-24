// Multi-topic head-to-head: Sonnet 4.6 vs Haiku 4.5.
// Runs all (topic × model) calls in parallel. Reports a comparison
// table and shows one Haiku sample per topic so a human can eyeball
// distractor quality without scrolling.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, userPromptFor } from '../lib/ai/prompts.ts';

const TOPICS = [
  '90s hip-hop',
  'world capitals',
  'kitchen science',
  'classic rock albums',
];
const COUNT = 20;
const DIFFICULTY = 'normal';

const MODELS = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

const TOOL = {
  name: 'emit_questions',
  description: 'Emit the batch of generated trivia questions for TR1VIA. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            prompt: { type: 'string', minLength: 8, maxLength: 400 },
            options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 160 } },
            correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
            difficulty: { type: 'integer', minimum: 1, maximum: 7 },
            factBlurb: { type: 'string', minLength: 8, maxLength: 280 },
            photoQuery: { type: 'string', minLength: 2, maxLength: 80 },
          },
          required: ['prompt', 'options', 'correctIndex', 'difficulty', 'factBlurb', 'photoQuery'],
          additionalProperties: false,
        },
      },
    },
    required: ['questions'],
    additionalProperties: false,
  },
};

function validate(q) {
  if (!q || typeof q !== 'object') return false;
  if (typeof q.prompt !== 'string' || q.prompt.trim().length < 8) return false;
  if (!Array.isArray(q.options) || q.options.length !== 4) return false;
  if (new Set(q.options.map((o) => String(o).toLowerCase())).size !== 4) return false;
  if (![0, 1, 2, 3].includes(q.correctIndex)) return false;
  if (![1, 2, 3, 4, 5, 6, 7].includes(q.difficulty)) return false;
  if (typeof q.factBlurb !== 'string' || q.factBlurb.trim().length < 8) return false;
  if (typeof q.photoQuery !== 'string' || q.photoQuery.trim().length < 2) return false;
  return true;
}

async function callOne(topic, modelLabel, modelId) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  try {
    const response = await client.messages.create(
      {
        model: modelId,
        max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: userPromptFor({ topic, count: COUNT, difficulty: DIFFICULTY }) }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'emit_questions' },
        temperature: 0.7,
      },
      { timeout: 90_000 },
    );
    const ms = Date.now() - t0;
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    const questions = toolBlock?.input?.questions ?? [];
    const valid = questions.filter(validate);
    const spread = {};
    for (const q of valid) spread[q.difficulty] = (spread[q.difficulty] ?? 0) + 1;
    return { topic, modelLabel, ms, total: questions.length, valid: valid.length, spread, questions: valid, usage: response.usage };
  } catch (e) {
    return { topic, modelLabel, error: String(e?.message ?? e), ms: Date.now() - t0 };
  }
}

console.log(`\nBenchmark: ${TOPICS.length} topics × 2 models, in parallel. Count=${COUNT}, difficulty=${DIFFICULTY}\n`);

const jobs = [];
for (const topic of TOPICS) {
  jobs.push(callOne(topic, 'Sonnet', MODELS.sonnet));
  jobs.push(callOne(topic, 'Haiku', MODELS.haiku));
}
const results = await Promise.all(jobs);

function fmtSpread(spread) {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => `${spread[d] ?? 0}`).join('·');
}

// Table
console.log('═══ Per-topic results ═══\n');
console.log('Topic                  Model    Latency   Valid    Diff(1..7)    in    out');
console.log('─'.repeat(78));
for (const r of results) {
  if (r.error) {
    console.log(`${r.topic.padEnd(22)} ${r.modelLabel.padEnd(8)} ERR ${r.ms}ms  ${r.error.slice(0, 30)}`);
    continue;
  }
  console.log(
    `${r.topic.padEnd(22)} ${r.modelLabel.padEnd(8)} ${String(r.ms + 'ms').padStart(7)}  ${String(r.valid).padStart(2)}/${r.total} ${fmtSpread(r.spread).padStart(15)}   ${String(r.usage?.input_tokens ?? 0).padStart(4)}  ${String(r.usage?.output_tokens ?? 0).padStart(4)}`,
  );
}

// Aggregates
function agg(label) {
  const rows = results.filter((r) => r.modelLabel === label && !r.error);
  if (rows.length === 0) return null;
  const avgMs = Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length);
  const totalValid = rows.reduce((s, r) => s + r.valid, 0);
  const totalReturned = rows.reduce((s, r) => s + r.total, 0);
  const totalIn = rows.reduce((s, r) => s + (r.usage?.input_tokens ?? 0), 0);
  const totalOut = rows.reduce((s, r) => s + (r.usage?.output_tokens ?? 0), 0);
  return { avgMs, totalValid, totalReturned, totalIn, totalOut };
}
const aggS = agg('Sonnet');
const aggH = agg('Haiku');

console.log('\n═══ Aggregate ═══');
if (aggS && aggH) {
  console.log(`Sonnet avg latency: ${aggS.avgMs}ms   valid: ${aggS.totalValid}/${aggS.totalReturned}   tokens in/out: ${aggS.totalIn}/${aggS.totalOut}`);
  console.log(`Haiku  avg latency: ${aggH.avgMs}ms   valid: ${aggH.totalValid}/${aggH.totalReturned}   tokens in/out: ${aggH.totalIn}/${aggH.totalOut}`);
  const sCost = (aggS.totalIn / 1e6) * 3 + (aggS.totalOut / 1e6) * 15;
  const hCost = (aggH.totalIn / 1e6) * 1 + (aggH.totalOut / 1e6) * 5;
  console.log(`Sonnet total cost (${TOPICS.length} calls): $${sCost.toFixed(4)}`);
  console.log(`Haiku  total cost (${TOPICS.length} calls): $${hCost.toFixed(4)}   (${(sCost / hCost).toFixed(1)}× cheaper)`);
}

// Eye test — first question from Haiku per topic
console.log('\n═══ Haiku eye test (one question per topic) ═══');
for (const topic of TOPICS) {
  const r = results.find((x) => x.topic === topic && x.modelLabel === 'Haiku');
  if (!r || r.error || !r.questions.length) continue;
  const q = r.questions[0];
  console.log(`\n${topic} (diff ${q.difficulty}): ${q.prompt}`);
  for (let j = 0; j < q.options.length; j++) {
    const marker = j === q.correctIndex ? '✓' : ' ';
    console.log(`  ${marker} ${j + 1}. ${q.options[j]}`);
  }
  console.log(`  blurb: ${q.factBlurb}`);
}

console.log('\n═══ Sonnet eye test (same topic, same Q index, for comparison) ═══');
for (const topic of TOPICS) {
  const r = results.find((x) => x.topic === topic && x.modelLabel === 'Sonnet');
  if (!r || r.error || !r.questions.length) continue;
  const q = r.questions[0];
  console.log(`\n${topic} (diff ${q.difficulty}): ${q.prompt}`);
  for (let j = 0; j < q.options.length; j++) {
    const marker = j === q.correctIndex ? '✓' : ' ';
    console.log(`  ${marker} ${j + 1}. ${q.options[j]}`);
  }
  console.log(`  blurb: ${q.factBlurb}`);
}
