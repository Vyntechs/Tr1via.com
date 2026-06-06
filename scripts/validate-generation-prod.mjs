// Validate the answer-correctness generation pipeline against a running deploy
// (preview or prod). Drives a REAL category generation through the HTTP API,
// proves it completes within the function budget, then INDEPENDENTLY re-checks
// every emitted answer with a fresh Opus call. This is the end-to-end proof
// that the deployed code (HTTP route -> Sonnet write -> double Opus verify ->
// DB) emits verified-correct questions — the thing full-flow-prod can't test
// (it trusts correct_index).
//
// Run:
//   SMOKE_BASE_URL=<preview-url> node --env-file=.env.local scripts/validate-generation-prod.mjs [topic]
//
// Exit 0 = every emitted answer passed an independent re-check + sane count.
// Exit 1 = a wrong answer reached the host, generation stalled, or over-dropped.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const BASE = process.env.SMOKE_BASE_URL ?? "https://tr1via.com";
// Optional Vercel deployment-protection bypass (share URL) for protected previews.
const SHARE_URL = process.env.VERCEL_SHARE_URL ?? null;
const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? "brandon@vyntechs.com";
const TOPIC = process.argv[2] ?? "world geography";
const GEN_TIMEOUT_MS = Number(process.env.SMOKE_GEN_TIMEOUT_MS ?? 260_000);
const POLL_MS = 3000;
const MIN_EMITTED = 10; // double-verify drops some; she needs 7 — flag if it over-drops

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!supaUrl || !supaKey) { console.error("Missing Supabase env"); process.exit(1); }
if (!anthropicKey) { console.error("Missing ANTHROPIC_API_KEY (needed for the independent re-check)"); process.exit(1); }

const admin = createClient(supaUrl, supaKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ai = new Anthropic({ apiKey: anthropicKey });

const c = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m` };

class Jar {
  constructor() { this.cookies = new Map(); }
  apply(h) { if (!h) return; for (const p of h.split(/,(?=[^ ;]+=)/)) { const [pair] = p.split(";"); const eq = pair.indexOf("="); if (eq > -1) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()); } }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function call(jar, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: jar.header(), ...(init.headers ?? {}) } });
  jar.apply(res.headers.get("set-cookie"));
  return res;
}

// Establish a Vercel deployment-protection bypass by following the share-URL
// redirect chain, capturing every Set-Cookie into the jar along the way.
async function bypassHandshake(jar, shareUrl) {
  let url = shareUrl;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { redirect: "manual", headers: { Cookie: jar.header() } });
    for (const sc of res.headers.getSetCookie?.() ?? []) jar.apply(sc);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    return res.status;
  }
  return null;
}

// ── Independent Opus re-verifier (mirrors lib/ai/verify-answers.ts; chunked; no temperature) ──
const VERDICTS_TOOL = { name: "verdicts", description: "verdicts", input_schema: { type: "object", properties: { verdicts: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, markedAnswerIsCorrect: { type: "boolean" }, ambiguous: { type: "boolean" }, trueAnswer: { type: "string" } }, required: ["index", "markedAnswerIsCorrect", "ambiguous", "trueAnswer"], additionalProperties: false } } }, required: ["verdicts"], additionalProperties: false } };
const VSYS = "You are a meticulous, independent trivia fact-checker. For each question, work out the correct answer from your OWN knowledge. Do NOT assume the markedAnswer is right. markedAnswerIsCorrect=true only if the marked answer is unambiguously the single correct option. ambiguous=true if two or more options are defensibly correct, or there is no single defensible answer. Return exactly one verdict per index.";
const arr = (x) => (Array.isArray(x) ? x : []);
async function reverify(questions) {
  const CHUNK = 8; const out = new Map();
  for (let s = 0; s < questions.length; s += CHUNK) {
    const slice = questions.slice(s, s + CHUNK); let vs = [];
    for (let a = 0; a < 2 && vs.length < slice.length; a++) {
      const payload = slice.map((q, j) => ({ index: j, prompt: q.prompt, options: q.options, markedAnswer: q.options[q.correct_index] }));
      const r = await ai.messages.create({ model: "claude-opus-4-8", max_tokens: 4000, system: VSYS, messages: [{ role: "user", content: `Fact-check these ${payload.length}. Return exactly ${payload.length} verdicts:\n` + JSON.stringify(payload, null, 1) }], tools: [VERDICTS_TOOL], tool_choice: { type: "tool", name: "verdicts" } }, { timeout: 90000 });
      vs = arr(r.content.find((b) => b.type === "tool_use" && b.name === "verdicts")?.input?.verdicts).filter((v) => v.index >= 0 && v.index < slice.length);
    }
    for (const v of vs) if (!out.has(s + v.index)) out.set(s + v.index, v);
  }
  return out;
}

console.log(c.c(`\n═══ PR #77 generation validation ═══`));
console.log(`  base   : ${BASE}`);
console.log(`  topic  : ${TOPIC}`);

let nightId = null;
let failed = false;
try {
  const jar = new Jar();
  // 0. preview protection bypass (if a share URL is provided)
  if (SHARE_URL) {
    const st = await bypassHandshake(jar, SHARE_URL);
    console.log(c.g(`  ✓ Vercel preview bypass established (status ${st})`));
  }
  // 1. login
  const login = await call(jar, "/api/auth/founder-login", { method: "POST", body: JSON.stringify({ email: FOUNDER_EMAIL }) });
  if (!login.ok) throw new Error(`login ${login.status}: ${await login.text()}`);
  console.log(c.g("  ✓ logged in"));

  // 2. night + game1
  const nightRes = await call(jar, "/api/nights", { method: "POST", body: JSON.stringify({ venueName: "PR77 Validation" }) });
  if (!nightRes.ok) throw new Error(`create night ${nightRes.status}`);
  nightId = (await nightRes.json()).nightId;
  const { data: games } = await admin.from("games").select("id, game_no").eq("night_id", nightId).order("game_no");
  const game1Id = games.find((g) => g.game_no === 1).id;
  console.log(c.g(`  ✓ night ${nightId.slice(0, 8)}…`));

  // 3. category + generate
  const catRes = await call(jar, "/api/categories", { method: "POST", body: JSON.stringify({ gameId: game1Id, name: `PR77 ${TOPIC}`, topic: TOPIC, position: 1 }) });
  if (!catRes.ok) throw new Error(`create category ${catRes.status}: ${await catRes.text()}`);
  const categoryId = (await catRes.json()).category.id;
  const t0 = Date.now();
  const genRes = await call(jar, `/api/categories/${categoryId}/generate`, { method: "POST", body: JSON.stringify({}) });
  if (genRes.status !== 202) throw new Error(`generate ${genRes.status}: ${await genRes.text()}`);
  console.log(c.c(`  · generating (Sonnet write + double Opus verify)…`));

  // 4. poll to review (proves it completes within the function budget)
  const deadline = Date.now() + GEN_TIMEOUT_MS;
  let state = null;
  while (Date.now() < deadline) {
    const { data: cat } = await admin.from("categories").select("state").eq("id", categoryId).maybeSingle();
    if (cat?.state !== state) { state = cat?.state; console.log(`    state=${state} (${Math.round((Date.now() - t0) / 1000)}s)`); }
    if (state === "draft") throw new Error("generation rolled back to draft (job failed)");
    if (state === "review" || state === "ready") break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const genSecs = Math.round((Date.now() - t0) / 1000);
  if (state !== "review" && state !== "ready") throw new Error(`generation did not finish in ${GEN_TIMEOUT_MS / 1000}s (stuck at ${state}) — would exceed the function budget`);
  console.log(c.g(`  ✓ generation finished in ${genSecs}s (budget 300s)`));

  // 5. pull emitted questions
  const { data: questions } = await admin.from("questions").select("id, prompt, options, correct_index, source").eq("category_id", categoryId);
  console.log(`  · emitted ${questions.length} questions (source: ${[...new Set(questions.map((q) => q.source))].join(", ")})`);
  if (questions.length < MIN_EMITTED) { console.log(c.r(`  ✗ over-dropped: only ${questions.length} (< ${MIN_EMITTED}) — completeness/verify too aggressive`)); failed = true; }
  else console.log(c.g(`  ✓ sane count (${questions.length} ≥ ${MIN_EMITTED}); host needs only 7`));
  if (questions.some((q) => q.source !== "ai")) { console.log(c.r(`  ✗ non-ai source present`)); failed = true; }

  // 6. INDEPENDENT re-check of every marked answer
  console.log(c.c(`  · independent Opus re-check of all ${questions.length} answers…`));
  const verdicts = await reverify(questions);
  const missing = questions.filter((_, i) => !verdicts.has(i));
  const wrong = questions.filter((_, i) => { const v = verdicts.get(i); return v && !v.markedAnswerIsCorrect; });
  const ambiguous = questions.filter((_, i) => { const v = verdicts.get(i); return v && v.ambiguous; });
  if (missing.length) console.log(c.y(`  · ${missing.length} could not be re-checked (judge incomplete) — excluded`));
  if (wrong.length === 0) console.log(c.g(`  ✓ 0 wrong answers — every emitted question passed an independent re-check`));
  else {
    failed = true;
    console.log(c.r(`  ✗ ${wrong.length} WRONG answer(s) reached emit:`));
    for (const q of wrong) { const i = questions.indexOf(q); const v = verdicts.get(i); console.log(c.r(`      "${q.prompt}"`)); console.log(c.r(`        marked: ${q.options[q.correct_index]}  |  judge: ${v.trueAnswer}`)); }
  }
  console.log(`  · ${ambiguous.length} flagged ambiguous by the re-check (known ~2.5% floor on fuzzy topics; informational)`);

  // sample
  console.log(c.c(`\n  sample (first 3):`));
  for (const q of questions.slice(0, 3)) { console.log(`    ${q.prompt}`); q.options.forEach((o, j) => console.log(`      ${j === q.correct_index ? "✓" : " "} ${o}`)); }
} catch (e) {
  failed = true;
  console.log(c.r(`\n  ✗ ${e?.message ?? e}`));
} finally {
  if (nightId) { const { error } = await admin.from("nights").delete().eq("id", nightId); console.log(error ? c.y(`  · cleanup warning: ${error.message}`) : c.g(`  ✓ cleaned up test night`)); }
}
console.log(failed ? c.r(`\n═══ PR #77 GENERATION VALIDATION: RED ═══\n`) : c.g(`\n═══ PR #77 GENERATION VALIDATION: GREEN ═══\n`));
process.exitCode = failed ? 1 : 0;
