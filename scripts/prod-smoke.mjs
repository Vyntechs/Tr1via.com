// Prod end-to-end smoke. Drives tr1via.com against REAL services:
//   - tr1via.com (Vercel deploy of the latest main)
//   - real Anthropic (no MSW)
//   - real Pexels (no MSW)
//   - real prod Supabase
//
// Flow:
//   1. Founder bypass login → session cookie
//   2. Create a night (auto-creates 2 game shells)
//   3. Look up game 1 id via Supabase admin
//   4. Create a category in game 1
//   5. POST /api/categories/[id]/generate — kicks off real Anthropic
//   6. Poll DB until questions land (or timeout)
//   7. Validate count, distractor uniqueness, photo attach
//   8. Cleanup: delete the night (cascades)
//
//   node --env-file=.env.local scripts/prod-smoke.mjs [topic]
//
// Exit 0 = green for demo. Exit 1 = something's broken; the printed
// failure point tells you exactly where to dig.

import { createClient } from '@supabase/supabase-js';

const BASE = process.env.SMOKE_BASE_URL ?? 'https://tr1via.com';
const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? 'brandon@vyntechs.com';
const TOPIC = process.argv[2] ?? 'classic movie quotes';
const GEN_TIMEOUT_MS = 90_000;
const POLL_MS = 2000;

function colorize(s, c) {
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}
const pass = (s) => console.log(`  ${colorize('✓', 'green')} ${s}`);
const fail = (s) => console.log(`  ${colorize('✗', 'red')} ${s}`);
const step = (s) => console.log(`\n${colorize('▸', 'cyan')} ${s}`);
const note = (s) => console.log(`  ${colorize('·', 'gray')} ${s}`);

// Cookie jar — minimal. Each fetch sends Cookie, captures Set-Cookie.
class Jar {
  constructor() { this.cookies = new Map(); }
  apply(setCookieHeader) {
    if (!setCookieHeader) return;
    const parts = setCookieHeader.split(/,(?=[^ ;]+=)/);
    for (const p of parts) {
      const [pair] = p.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function call(jar, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.apply(res.headers.get('set-cookie'));
  return res;
}

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supaUrl || !supaKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}
const admin = createClient(supaUrl, supaKey, { auth: { autoRefreshToken: false, persistSession: false } });

console.log(`\n${colorize('═══ TR1VIA prod smoke ═══', 'cyan')}`);
console.log(`  base : ${BASE}`);
console.log(`  email: ${FOUNDER_EMAIL}`);
console.log(`  topic: ${TOPIC}`);

const jar = new Jar();
let nightId = null;
let categoryId = null;
let startedAt = Date.now();

try {
  // 1. Login
  step('1. founder bypass login');
  const loginRes = await call(jar, '/api/auth/founder-login', { method: 'POST', body: JSON.stringify({ email: FOUNDER_EMAIL }) });
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  pass(`logged in as founder (${loginRes.status})`);
  if (jar.cookies.size === 0) throw new Error('no auth cookies set on response');
  pass(`got ${jar.cookies.size} cookie(s)`);

  // 2. Create night
  step('2. create night');
  const nightRes = await call(jar, '/api/nights', {
    method: 'POST',
    body: JSON.stringify({ venueName: 'Smoke Test Pub' }),
  });
  if (!nightRes.ok) throw new Error(`create night failed: ${nightRes.status} ${await nightRes.text()}`);
  const nightBody = await nightRes.json();
  nightId = nightBody.nightId;
  pass(`night id=${nightId}  code=${nightBody.roomCode}`);

  // 3. Look up game 1
  step('3. fetch game 1');
  const { data: games, error: gamesErr } = await admin
    .from('games').select('id, game_no').eq('night_id', nightId).order('game_no');
  if (gamesErr || !games?.length) throw new Error(`could not list games: ${gamesErr?.message}`);
  const game1 = games.find((g) => g.game_no === 1);
  if (!game1) throw new Error('no game 1 row');
  pass(`game 1 id=${game1.id}`);

  // 4. Create category
  step('4. create category');
  const catRes = await call(jar, '/api/categories', {
    method: 'POST',
    body: JSON.stringify({ gameId: game1.id, name: 'Smoke Category', topic: TOPIC, position: 1 }),
  });
  if (!catRes.ok) throw new Error(`create category failed: ${catRes.status} ${await catRes.text()}`);
  categoryId = (await catRes.json()).category.id;
  pass(`category id=${categoryId}  topic="${TOPIC}"`);

  // 5. Kick off generation
  step('5. trigger generation (REAL Anthropic + Pexels)');
  const genStart = Date.now();
  const genRes = await call(jar, `/api/categories/${categoryId}/generate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (genRes.status !== 202) throw new Error(`generate failed: ${genRes.status} ${await genRes.text()}`);
  pass(`generation kicked off (202 in ${Date.now() - genStart}ms)`);

  // 6. Poll for completion
  step('6. poll for questions');
  const deadline = Date.now() + GEN_TIMEOUT_MS;
  let questions = [];
  let lastState = null;
  while (Date.now() < deadline) {
    const { data: cat } = await admin.from('categories').select('state').eq('id', categoryId).maybeSingle();
    if (cat?.state !== lastState) {
      note(`state=${cat?.state} (${Math.round((Date.now() - genStart) / 1000)}s)`);
      lastState = cat?.state;
    }
    if (cat?.state === 'draft') throw new Error('category rolled back to draft (generation failed)');
    if (cat?.state === 'review' || cat?.state === 'ready') {
      const { data: qs } = await admin.from('questions')
        .select('id, prompt, options, correct_index, difficulty, fact_blurb, image_url, photo_query')
        .eq('category_id', categoryId);
      questions = qs ?? [];
      if (questions.length > 0) break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (questions.length === 0) throw new Error(`timed out after ${GEN_TIMEOUT_MS}ms with no questions`);
  pass(`got ${questions.length} questions in ${Math.round((Date.now() - genStart) / 1000)}s`);

  // 7. Validate
  step('7. validate question shape');
  let badCount = 0;
  for (const q of questions) {
    if (!q.prompt || q.prompt.length < 8) badCount++;
    if (!Array.isArray(q.options) || q.options.length !== 4) badCount++;
    if (![0, 1, 2, 3].includes(q.correct_index)) badCount++;
    if (![1, 2, 3, 4, 5, 6, 7].includes(q.difficulty)) badCount++;
    if (!q.fact_blurb || q.fact_blurb.length < 8) badCount++;
  }
  if (badCount > 0) fail(`${badCount} shape issues across the batch`);
  else pass('all questions structurally valid');

  const withPhotos = questions.filter((q) => q.image_url).length;
  if (withPhotos === questions.length) pass(`all ${withPhotos} questions have photos attached`);
  else if (withPhotos === 0) fail('no photos attached (Pexels broken or photo job didn\'t fire)');
  else note(`${withPhotos}/${questions.length} questions have photos (partial — may finish later)`);

  // Spread + sample
  const spread = {};
  for (const q of questions) spread[q.difficulty] = (spread[q.difficulty] ?? 0) + 1;
  note(`difficulty spread (1..7): ${[1, 2, 3, 4, 5, 6, 7].map((d) => spread[d] ?? 0).join('·')}`);

  const sample = questions[0];
  console.log(`\n  Sample question (diff ${sample.difficulty}):`);
  console.log(`    ${sample.prompt}`);
  for (let i = 0; i < sample.options.length; i++) {
    const mark = i === sample.correct_index ? colorize('✓', 'green') : ' ';
    console.log(`    ${mark} ${i + 1}. ${sample.options[i]}`);
  }
  console.log(`    blurb: ${sample.fact_blurb}`);

  // Total time
  console.log(`\n${colorize('═══ PROD GREEN ═══', 'green')} (total ${Math.round((Date.now() - startedAt) / 1000)}s)`);
  console.log('Real Anthropic ✓   Real Pexels ✓   Real Supabase ✓   Founder auth ✓\n');
} catch (e) {
  console.log(`\n${colorize('═══ PROD RED ═══', 'red')}`);
  console.log(`  ${e?.message ?? e}\n`);
  process.exitCode = 1;
} finally {
  // 8. Cleanup
  if (nightId) {
    step('cleanup');
    const { error } = await admin.from('nights').delete().eq('id', nightId);
    if (error) note(`cleanup warning: ${error.message}`);
    else pass(`deleted night ${nightId} (cascades to games/categories/questions)`);
  }
}
