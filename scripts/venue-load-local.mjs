// Headless venue-scale load driver. Simulates a full room of phones joining a
// night and answering live questions, against a LOCAL stack only.
//
// Why headless: browser contexts cap out around 20-30 on a laptop, and the
// point of this run is the server path — join, snapshot, answer, resolve — at
// the size a real Wednesday reaches. Tonight's room was 63.
//
// Zero paid API usage: the night is seeded through /api/_test/seed-night, so
// no question is ever generated. Anthropic and Pexels are never called.
//
//   PLAYERS=63 node scripts/venue-load-local.mjs
//
// Refuses to run against anything but localhost.

const BASE = process.env.LOAD_BASE_URL ?? "http://localhost:3020";
const PLAYERS = Number(process.env.PLAYERS ?? 63);
const QUESTIONS = Number(process.env.QUESTIONS ?? 6);
const TEST_SECRET = process.env.TEST_SECRET ?? "local-test-secret";

{
  const u = new URL(BASE);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) {
    throw new Error(`refusing to load-test a non-local target: ${BASE}`);
  }
}

// ─── a cookie jar per simulated device ───────────────────────────────────
function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

async function call(j, method, path, body, extraHeaders = {}) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(j.header() ? { cookie: j.header() } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  j.absorb(res);
  const ms = performance.now() - t0;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { ok: res.ok, status: res.status, ms, json, text: text.slice(0, 300) };
}

function stats(list) {
  if (!list.length) return { n: 0 };
  const s = [...list].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    n: s.length,
    p50: Math.round(at(50)),
    p95: Math.round(at(95)),
    max: Math.round(s[s.length - 1]),
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

const problems = [];
const note = (what, r) => {
  if (!r.ok) problems.push(`${what} → ${r.status} ${r.text}`);
  return r;
};

console.log(`\n=== venue load: ${PLAYERS} phones, ${QUESTIONS} questions, ${BASE} ===\n`);

// ─── host: sign in and seed an AI-free night ─────────────────────────────
const host = jar();
const login = note("host login", await call(host, "POST", "/api/_test/login",
  { email: "load-host@tr1via.test", displayName: "Load Host" },
  { "x-test-secret": TEST_SECRET }));
if (!login.ok) { console.error(problems.join("\n")); process.exit(1); }

const seed = note("seed night", await call(host, "POST", "/api/_test/seed-night",
  { hostId: login.json.hostId, scenario: "happy-path-3-cats-game1" },
  { "x-test-secret": TEST_SECRET }));
if (!seed.ok) { console.error(problems.join("\n")); process.exit(1); }

const { nightId, roomCode, game1, categories } = seed.json;
console.log(`night ${nightId}  room ${roomCode}  game1 ${game1.id}`);

note("open night", await call(host, "POST", `/api/nights/${nightId}/open`));

// ─── the room arrives ────────────────────────────────────────────────────
const joinMs = [];
const phones = [];
const t0Join = performance.now();
await Promise.all(
  Array.from({ length: PLAYERS }, (_, i) => (async () => {
    const j = jar();
    const init = await call(j, "POST", "/api/session/init");
    if (!init.ok) { problems.push(`session/init[${i}] → ${init.status}`); return; }
    const t = performance.now();
    const p = await call(j, "POST", "/api/players", { nightId, displayName: `Load${i + 1}` });
    joinMs.push(performance.now() - t);
    if (!p.ok) { problems.push(`join[${i}] → ${p.status} ${p.text}`); return; }
    phones.push({ j, id: p.json?.player?.id ?? p.json?.id, name: `Load${i + 1}` });
  })()),
);
const joinWall = Math.round(performance.now() - t0Join);
console.log(`joined ${phones.length}/${PLAYERS} in ${joinWall}ms  ${JSON.stringify(stats(joinMs))}`);

note("start game", await call(host, "POST", `/api/games/${game1.id}/start`));

// ─── question loop ───────────────────────────────────────────────────────
const questionIds = categories.flatMap((c) => c.question_ids).slice(0, QUESTIONS);
const snapMs = [];
const answerMs = [];
const revealMs = [];
let answersAccepted = 0;

for (const [qi, questionId] of questionIds.entries()) {
  const rev = note(`reveal[${qi}]`, await call(host, "POST", `/api/games/${game1.id}/reveal`, { questionId }));
  revealMs.push(rev.ms);
  if (!rev.ok) continue;

  // Every phone pulls its own signed snapshot, then answers — the real
  // stampede shape: one broadcast, N simultaneous reads, N simultaneous writes.
  await Promise.all(phones.map(async (ph, i) => {
    const s = await call(ph.j, "GET", `/api/room/${roomCode}/snapshot`);
    snapMs.push(s.ms);
    if (!s.ok) { problems.push(`snapshot[q${qi}/p${i}] → ${s.status}`); return; }
    const q = s.json?.live?.question ?? s.json?.currentQuestion;
    const qid = q?.id ?? questionId;
    // The per-player scramble is the anti-cheat handshake: the server
    // recomputes scrambleFor(questionId, playerId) and rejects anything else,
    // so a real phone answers with the array its own snapshot handed it.
    const scramble = s.json?.questionScrambles?.[qid];
    if (!Array.isArray(scramble)) {
      problems.push(`snapshot[q${qi}/p${i}] carried no scramble for ${qid}`);
      return;
    }
    const a = await call(ph.j, "POST", "/api/answers", {
      questionId: qid,
      slotChosen: (i % 4) + 1,
      scramble,
    });
    answerMs.push(a.ms);
    if (a.ok) answersAccepted++;
    else problems.push(`answer[q${qi}/p${i}] → ${a.status} ${a.text}`);
  }));

  note(`resolve[${qi}]`, await call(host, "POST", "/api/_test/fast-forward",
    { questionId }, { "x-test-secret": TEST_SECRET }));
}

// ─── the venue TV, under the same load ───────────────────────────────────
const tv = jar();
const tvMs = [];
for (let i = 0; i < 10; i++) {
  const r = await call(tv, "GET", `/api/tv/${roomCode}/snapshot`);
  tvMs.push(r.ms);
  if (!r.ok) problems.push(`tv snapshot → ${r.status}`);
}

console.log(`
reveal        ${JSON.stringify(stats(revealMs))}
player snap   ${JSON.stringify(stats(snapMs))}
answer POST   ${JSON.stringify(stats(answerMs))}
tv snapshot   ${JSON.stringify(stats(tvMs))}

answers accepted: ${answersAccepted} / ${phones.length * questionIds.length} expected
problems: ${problems.length}`);

for (const p of problems.slice(0, 15)) console.log("  ! " + p);
if (problems.length > 15) console.log(`  … and ${problems.length - 15} more`);

process.exit(problems.length ? 1 : 0);
