// Benchmark Sonnet 4.6 vs Haiku 4.5 for question generation.
// Same prompt, same topic, parallel calls. Reports latency, validity,
// difficulty spread, and shows a sample for eye-test on distractor quality.
//
//   node --env-file=.env.local scripts/compare-models.mjs [topic]

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, userPromptFor } from '../lib/ai/prompts.ts';

const topic = process.argv[2] ?? 'Movie actors';
const count = 20;
const difficulty = 'normal';

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
  const errs = [];
  if (!q || typeof q !== 'object') return ['not an object'];
  if (typeof q.prompt !== 'string' || q.prompt.trim().length < 8) errs.push('prompt');
  if (!Array.isArray(q.options) || q.options.length !== 4) errs.push('options-shape');
  else if (new Set(q.options.map((o) => String(o).toLowerCase())).size !== 4) errs.push('options-duplicate');
  if (![0, 1, 2, 3].includes(q.correctIndex)) errs.push('correctIndex');
  if (![1, 2, 3, 4, 5, 6, 7].includes(q.difficulty)) errs.push('difficulty');
  if (typeof q.factBlurb !== 'string' || q.factBlurb.trim().length < 8) errs.push('factBlurb');
  if (typeof q.photoQuery !== 'string' || q.photoQuery.trim().length < 2) errs.push('photoQuery');
  return errs;
}

async function callOne(label, modelId) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let response;
  try {
    response = await client.messages.create(
      {
        model: modelId,
        max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: userPromptFor({ topic, count, difficulty }) }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'emit_questions' },
        temperature: 0.7,
      },
      { timeout: 90_000 },
    );
  } catch (e) {
    return { label, modelId, error: String(e?.message ?? e), ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  const questions = toolBlock?.input?.questions ?? [];
  const validCount = questions.filter((q) => validate(q).length === 0).length;
  const invalidReasons = questions
    .map((q) => validate(q))
    .filter((e) => e.length > 0)
    .flat();
  const diffSpread = {};
  for (const q of questions) {
    if (validate(q).length === 0) {
      diffSpread[q.difficulty] = (diffSpread[q.difficulty] ?? 0) + 1;
    }
  }
  return {
    label,
    modelId,
    ms,
    total: questions.length,
    valid: validCount,
    invalid: questions.length - validCount,
    invalidReasons: [...new Set(invalidReasons)],
    diffSpread,
    questions,
    usage: response.usage,
  };
}

console.log(`\nTopic: "${topic}"   Count: ${count}   Difficulty: ${difficulty}\n`);
console.log('Calling Sonnet 4.6 and Haiku 4.5 in parallel...\n');

const [sonnet, haiku] = await Promise.all([
  callOne('Sonnet 4.6', MODELS.sonnet),
  callOne('Haiku 4.5', MODELS.haiku),
]);

function summarize(r) {
  if (r.error) {
    return `${r.label.padEnd(12)} ERROR after ${r.ms}ms: ${r.error}`;
  }
  return [
    `${r.label.padEnd(12)} ${String(r.ms).padStart(5)}ms`,
    `valid ${r.valid}/${r.total}`,
    `diff ${Object.entries(r.diffSpread).map(([k, v]) => `${k}:${v}`).join(' ')}`,
    `in=${r.usage?.input_tokens} out=${r.usage?.output_tokens}`,
    r.invalidReasons.length ? `bad: ${r.invalidReasons.join(',')}` : '',
  ].join('   ');
}

console.log('═══ Summary ═══');
console.log(summarize(sonnet));
console.log(summarize(haiku));

function showSample(r, n = 3) {
  if (r.error || !r.questions.length) return;
  console.log(`\n── ${r.label} · first ${n} questions ──`);
  for (let i = 0; i < Math.min(n, r.questions.length); i++) {
    const q = r.questions[i];
    console.log(`\n  Q${i + 1} (diff ${q.difficulty}): ${q.prompt}`);
    for (let j = 0; j < q.options.length; j++) {
      const marker = j === q.correctIndex ? '✓' : ' ';
      console.log(`    ${marker} ${j + 1}. ${q.options[j]}`);
    }
    console.log(`    blurb: ${q.factBlurb}`);
    console.log(`    photo: ${q.photoQuery}`);
  }
}

showSample(sonnet, 3);
showSample(haiku, 3);

// Cost rough estimate (May 2026 list prices, approximate)
// Sonnet 4.6: ~$3/MTok input, ~$15/MTok output
// Haiku 4.5:  ~$1/MTok input, ~$5/MTok output
function cost(usage, inRate, outRate) {
  if (!usage) return null;
  return ((usage.input_tokens / 1e6) * inRate + (usage.output_tokens / 1e6) * outRate);
}
const sCost = cost(sonnet.usage, 3, 15);
const hCost = cost(haiku.usage, 1, 5);
if (sCost != null && hCost != null) {
  console.log(`\n── Approx cost per 20-question call ──`);
  console.log(`  Sonnet:  $${sCost.toFixed(4)}`);
  console.log(`  Haiku:   $${hCost.toFixed(4)}  (${(sCost / hCost).toFixed(1)}× cheaper)`);
}
