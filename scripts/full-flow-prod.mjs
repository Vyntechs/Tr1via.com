// Full prod end-to-end driver. Plays an entire 2-game night against
// tr1via.com, HTTP-only, no browser, no MCP. The point of this script is
// to find the next gameplay bug before Heather does — 2026-05-27 go-live.
//
// Flow:
//   1.  Founder bypass login.
//   2.  Create a night (auto-creates 2 game shells).
//   3.  Resolve game 1 + game 2 ids via Supabase admin.
//   4.  Set up game 1 category (create, generate, pick 7 — which also
//       "locks" the category by flipping state to 'ready'; there is NO
//       separate lock endpoint).
//   5.  Open the room.
//   6.  Spawn 3 simulated phones (own cookie jars), each calls
//       /api/session/init then /api/players to join the night
//       (auto-opts into game 1).
//   7.  Play game 1 (start → 7 cells of reveal/answer/end-early/assert).
//   8.  End game 1.
//   9.  Phones explicitly join game 2 (the real "Join Game 2" button).
//   10. Set up game 2 category and play it.
//   11. End game 2.
//   12. Assert cumulative leaderboard across both games.
//   13. Cleanup: delete the night (cascade).
//
// Answer strategy:
//   Alice — always correct.       Game 1 + Game 2: full slate.
//   Bob   — wrong in game 1, alternates correct/wrong in game 2 (proves
//           game-2 scoring is independent and accumulates).
//   Carol — alternates correct/wrong in both.
//
// Usage:
//   node --env-file=.env.local scripts/full-flow-prod.mjs [topic1] [topic2]
//
// Exit 0 = green. Exit 1 = the bug Heather would have hit; the printout
// names the step, the game, the question, and DB state at the failure.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SMOKE_BASE_URL ?? "https://tr1via.com";
const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? "brandon@vyntechs.com";
const TOPIC_GAME1 = process.argv[2] ?? "classic movie quotes";
const TOPIC_GAME2 = process.argv[3] ?? "world geography";
const GEN_TIMEOUT_MS = 90_000;
const POLL_MS = 2000;
const PHONE_NAMES = ["Alice", "Bob", "Carol"];

function colorize(s, c) {
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}
const pass = (s) => console.log(`  ${colorize("✓", "green")} ${s}`);
const fail = (s) => console.log(`  ${colorize("✗", "red")} ${s}`);
const step = (s) => console.log(`\n${colorize("▸", "cyan")} ${s}`);
const note = (s) => console.log(`  ${colorize("·", "gray")} ${s}`);

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  apply(setCookieHeader) {
    if (!setCookieHeader) return;
    const parts = setCookieHeader.split(/,(?=[^ ;]+=)/);
    for (const p of parts) {
      const [pair] = p.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function call(jar, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: jar.header(),
      ...(init.headers ?? {}),
    },
  });
  jar.apply(res.headers.get("set-cookie"));
  return res;
}

// ── scrambleFor: port of lib/game/scramble.ts. Pure 32-bit integer math,
// identical output on Node / browser / edge. Server validates exact match.
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function scrambleFor(questionId, playerId) {
  const seed = fnv1a(questionId + ":" + playerId);
  const rng = mulberry32(seed);
  const arr = [0, 1, 2, 3];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function correctSlot(scramble, correctIndex) {
  return scramble.indexOf(correctIndex) + 1;
}

class Phone {
  constructor(name) {
    this.name = name;
    this.jar = new Jar();
    this.deviceId = null;
    this.playerId = null;
  }
  async init() {
    const res = await call(this.jar, "/api/session/init", {
      method: "POST",
      body: "{}",
    });
    if (!res.ok) throw new Error(`session init failed: ${res.status}`);
    this.deviceId = (await res.json()).deviceId;
  }
  async joinNight(nightId) {
    const res = await call(this.jar, "/api/players", {
      method: "POST",
      body: JSON.stringify({ nightId, displayName: this.name }),
    });
    if (!res.ok) {
      throw new Error(`${this.name} join night failed: ${res.status} ${await res.text()}`);
    }
    this.playerId = (await res.json()).player.id;
  }
  // Explicit opt-in for game 2 (game 1 is auto-opted on joinNight).
  async joinGame(gameNo) {
    const res = await call(
      this.jar,
      `/api/players/${this.playerId}/join-game`,
      { method: "POST", body: JSON.stringify({ gameNo }) },
    );
    if (!res.ok) {
      throw new Error(`${this.name} join game ${gameNo} failed: ${res.status} ${await res.text()}`);
    }
  }
  async submitAnswer(questionId, slotChosen) {
    const scramble = scrambleFor(questionId, this.playerId);
    const res = await call(this.jar, "/api/answers", {
      method: "POST",
      body: JSON.stringify({ questionId, slotChosen, scramble }),
    });
    if (res.status !== 204) {
      throw new Error(
        `${this.name} answer failed: ${res.status} ${await res.text()}`,
      );
    }
  }
}

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supaUrl || !supaKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(supaUrl, supaKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`\n${colorize("═══ TR1VIA full-flow prod driver (2 games) ═══", "cyan")}`);
console.log(`  base    : ${BASE}`);
console.log(`  email   : ${FOUNDER_EMAIL}`);
console.log(`  topics  : 1=${TOPIC_GAME1}  2=${TOPIC_GAME2}`);

const founderJar = new Jar();
const phones = PHONE_NAMES.map((n) => new Phone(n));
let nightId = null;
let roomCode = null;
let game1Id = null;
let game2Id = null;
// Per-game category IDs and picked-question rows for later assertions.
const categoryIds = [null, null]; // [game1, game2]
const startedAt = Date.now();

// ── Helpers used by both games ────────────────────────────────────────

async function setupCategory(gameId, topic, position) {
  // create
  const createRes = await call(founderJar, "/api/categories", {
    method: "POST",
    body: JSON.stringify({ gameId, name: `Driver ${topic}`, topic, position }),
  });
  if (!createRes.ok) {
    throw new Error(`create category (${topic}): ${createRes.status} ${await createRes.text()}`);
  }
  const categoryId = (await createRes.json()).category.id;

  // trigger generation (real Anthropic + Pexels)
  const genStart = Date.now();
  const genRes = await call(founderJar, `/api/categories/${categoryId}/generate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (genRes.status !== 202) {
    throw new Error(`generate (${topic}): ${genRes.status} ${await genRes.text()}`);
  }

  // poll for >= 7 candidate questions
  const deadline = Date.now() + GEN_TIMEOUT_MS;
  let candidates = [];
  let lastState = null;
  while (Date.now() < deadline) {
    const { data: cat } = await admin
      .from("categories")
      .select("state")
      .eq("id", categoryId)
      .maybeSingle();
    if (cat?.state !== lastState) {
      note(`(${topic}) state=${cat?.state} (${Math.round((Date.now() - genStart) / 1000)}s)`);
      lastState = cat?.state;
    }
    if (cat?.state === "draft") {
      throw new Error(`(${topic}) category rolled back to draft`);
    }
    if (cat?.state === "review" || cat?.state === "ready") {
      const { data: qs } = await admin
        .from("questions")
        .select("id")
        .eq("category_id", categoryId);
      if ((qs?.length ?? 0) >= 7) {
        candidates = qs;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (candidates.length < 7) {
    throw new Error(`(${topic}) only ${candidates.length} questions after ${GEN_TIMEOUT_MS}ms`);
  }

  // pick first 7 — server assigns 100..700 point values + flips state to 'ready'
  const pickRes = await call(founderJar, `/api/categories/${categoryId}/pick`, {
    method: "POST",
    body: JSON.stringify({ questionIds: candidates.slice(0, 7).map((q) => q.id) }),
  });
  if (!pickRes.ok) throw new Error(`pick (${topic}): ${pickRes.status} ${await pickRes.text()}`);

  // fetch the picked questions in board order
  const { data: picked, error: fetchErr } = await admin
    .from("questions")
    .select("id, correct_index, point_value")
    .eq("category_id", categoryId)
    .eq("is_picked", true)
    .order("point_value", { ascending: true });
  if (fetchErr) throw new Error(`fetch picked (${topic}): ${fetchErr.message}`);
  if ((picked?.length ?? 0) !== 7) {
    throw new Error(`(${topic}) expected 7 picked, got ${picked?.length ?? 0}`);
  }
  return { categoryId, picked };
}

// Strategy: per (phone index, cell index, game no) → 'correct' | 'wrong'.
//   Alice (0): always correct.
//   Bob   (1): wrong in g1, alternates in g2.
//   Carol (2): alternates in both games.
function decide(phoneIndex, cellIndex, gameNo) {
  if (phoneIndex === 0) return "correct";
  if (phoneIndex === 1) {
    return gameNo === 1 ? "wrong" : cellIndex % 2 === 0 ? "correct" : "wrong";
  }
  return cellIndex % 2 === 0 ? "correct" : "wrong";
}

async function playCategory(gameId, gameNo, picked) {
  // Start (idempotent).
  const startRes = await call(founderJar, `/api/games/${gameId}/start`, {
    method: "POST",
  });
  if (!startRes.ok) throw new Error(`start game ${gameNo}: ${startRes.status} ${await startRes.text()}`);

  for (let i = 0; i < picked.length; i++) {
    const q = picked[i];
    const tag = `G${gameNo} Q${i + 1} (${q.point_value}pt)`;

    // Reveal
    {
      const res = await call(founderJar, `/api/games/${gameId}/reveal`, {
        method: "POST",
        body: JSON.stringify({ questionId: q.id }),
      });
      if (!res.ok) throw new Error(`reveal ${tag}: ${res.status} ${await res.text()}`);
    }

    // 3 phones answer per strategy.
    for (let pi = 0; pi < phones.length; pi++) {
      const phone = phones[pi];
      const scramble = scrambleFor(q.id, phone.playerId);
      const correct1 = correctSlot(scramble, q.correct_index);
      const slot =
        decide(pi, i, gameNo) === "correct" ? correct1 : (correct1 % 4) + 1;
      await phone.submitAnswer(q.id, slot);
    }

    // Host ends early → resolve_question RPC + broadcast.
    {
      const res = await call(founderJar, `/api/games/${gameId}/end-early`, {
        method: "POST",
        body: JSON.stringify({ questionId: q.id }),
      });
      if (!res.ok) throw new Error(`end-early ${tag}: ${res.status} ${await res.text()}`);
    }

    // Assert: finished_at set + every answer has is_correct + awarded_points.
    const { data: qRow } = await admin
      .from("questions")
      .select("finished_at")
      .eq("id", q.id)
      .maybeSingle();
    if (!qRow?.finished_at) throw new Error(`${tag}: finished_at not set after end-early`);

    const { data: answers } = await admin
      .from("answers")
      .select("player_id, is_correct, awarded_points")
      .eq("question_id", q.id);
    if ((answers?.length ?? 0) !== 3) {
      throw new Error(`${tag}: expected 3 answers, got ${answers?.length ?? 0}`);
    }
    const ungraded = answers.filter(
      (a) => a.is_correct === null || a.awarded_points === null,
    );
    if (ungraded.length) {
      throw new Error(`${tag}: ${ungraded.length} answers left ungraded by resolve_question`);
    }
    pass(`${tag} revealed → 3 answered → resolved → graded`);
  }
}

async function endGame(gameId, gameNo) {
  const res = await call(founderJar, `/api/games/${gameId}/end`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`end game ${gameNo}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.state !== "done") {
    throw new Error(`game ${gameNo} expected state=done, got ${body.state}`);
  }
}

// ── Main flow ─────────────────────────────────────────────────────────

try {
  // 1. Login
  step("1. founder bypass login");
  {
    const res = await call(founderJar, "/api/auth/founder-login", {
      method: "POST",
      body: JSON.stringify({ email: FOUNDER_EMAIL }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    if (founderJar.cookies.size === 0) throw new Error("no auth cookies set");
    pass(`logged in (${founderJar.cookies.size} cookies)`);
  }

  // 2. Create night
  step("2. create night");
  {
    const res = await call(founderJar, "/api/nights", {
      method: "POST",
      body: JSON.stringify({ venueName: "Full Flow Driver" }),
    });
    if (!res.ok) throw new Error(`create night failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    nightId = body.nightId;
    roomCode = body.roomCode;
    pass(`night id=${nightId.slice(0, 8)}… code=${roomCode}`);
  }

  // 3. Resolve both games
  step("3. resolve game ids");
  {
    const { data: games, error } = await admin
      .from("games")
      .select("id, game_no, state")
      .eq("night_id", nightId)
      .order("game_no");
    if (error || !games?.length) throw new Error(`list games: ${error?.message}`);
    const g1 = games.find((g) => g.game_no === 1);
    const g2 = games.find((g) => g.game_no === 2);
    if (!g1 || !g2) throw new Error(`expected both games, got ${games.map((g) => g.game_no).join(",")}`);
    game1Id = g1.id;
    game2Id = g2.id;
    pass(`g1=${game1Id.slice(0, 8)}… (${g1.state})  g2=${game2Id.slice(0, 8)}… (${g2.state})`);
  }

  // 4. Set up game 1 category
  step("4. set up game 1 category (create → generate → pick 7)");
  let picked1;
  {
    const t0 = Date.now();
    const r = await setupCategory(game1Id, TOPIC_GAME1, 1);
    categoryIds[0] = r.categoryId;
    picked1 = r.picked;
    pass(`game 1 category ready in ${Math.round((Date.now() - t0) / 1000)}s, points ${picked1.map((q) => q.point_value).join(",")}`);
  }

  // 5. Open room
  step("5. open the room");
  {
    const res = await call(founderJar, `/api/nights/${nightId}/open`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`open: ${res.status} ${await res.text()}`);
    pass(`opened at ${new Date((await res.json()).openedAt).toISOString().slice(11, 19)}`);
  }

  // 6. Phones join the night (auto-opts into game 1)
  step("6. spawn 3 phones and join night");
  for (const p of phones) {
    await p.init();
    await p.joinNight(nightId);
    pass(`${p.name} joined (player=${p.playerId.slice(0, 8)}…)`);
  }
  {
    const { data: parts } = await admin
      .from("game_participations")
      .select("player_id")
      .eq("game_id", game1Id);
    const ids = new Set((parts ?? []).map((x) => x.player_id));
    const missing = phones.filter((p) => !ids.has(p.playerId));
    if (missing.length) {
      throw new Error(`missing g1 participations: ${missing.map((m) => m.name).join(",")}`);
    }
    pass("all 3 have game_participations rows for game 1");
  }

  // 7. Play game 1
  step("7. play game 1 (7 cells)");
  await playCategory(game1Id, 1, picked1);

  // 8. End game 1
  step("8. end game 1");
  await endGame(game1Id, 1);
  pass("game 1 state=done");

  // 9. Phones explicitly join game 2 (the "Join Game 2" button path)
  step("9. phones join game 2");
  for (const p of phones) {
    await p.joinGame(2);
    pass(`${p.name} joined game 2`);
  }
  {
    const { data: parts } = await admin
      .from("game_participations")
      .select("player_id")
      .eq("game_id", game2Id);
    const ids = new Set((parts ?? []).map((x) => x.player_id));
    const missing = phones.filter((p) => !ids.has(p.playerId));
    if (missing.length) {
      throw new Error(`missing g2 participations: ${missing.map((m) => m.name).join(",")}`);
    }
    pass("all 3 have game_participations rows for game 2");
  }

  // 10. Set up game 2 category and play
  step("10. set up game 2 category (create → generate → pick 7)");
  let picked2;
  {
    const t0 = Date.now();
    const r = await setupCategory(game2Id, TOPIC_GAME2, 1);
    categoryIds[1] = r.categoryId;
    picked2 = r.picked;
    pass(`game 2 category ready in ${Math.round((Date.now() - t0) / 1000)}s, points ${picked2.map((q) => q.point_value).join(",")}`);
  }

  step("11. play game 2 (7 cells)");
  await playCategory(game2Id, 2, picked2);

  // 12. End game 2
  step("12. end game 2");
  await endGame(game2Id, 2);
  pass("game 2 state=done");

  // 13. Assert cumulative leaderboard across both categories.
  step("13. assert cumulative leaderboard (across both games)");
  {
    const allQuestionIds = [...picked1, ...picked2].map((q) => q.id);
    const { data: rows } = await admin
      .from("answers")
      .select("player_id, question_id, awarded_points")
      .in("question_id", allQuestionIds);

    // Per-game and cumulative totals
    const g1ids = new Set(picked1.map((q) => q.id));
    const totals = new Map();
    const g1Totals = new Map();
    const g2Totals = new Map();
    for (const r of rows ?? []) {
      const pts = r.awarded_points ?? 0;
      totals.set(r.player_id, (totals.get(r.player_id) ?? 0) + pts);
      const bucket = g1ids.has(r.question_id) ? g1Totals : g2Totals;
      bucket.set(r.player_id, (bucket.get(r.player_id) ?? 0) + pts);
    }

    const ranked = phones
      .map((p) => ({
        name: p.name,
        total: totals.get(p.playerId) ?? 0,
        g1: g1Totals.get(p.playerId) ?? 0,
        g2: g2Totals.get(p.playerId) ?? 0,
      }))
      .sort((a, b) => b.total - a.total);

    for (const r of ranked) {
      note(`${r.name.padEnd(6)} total=${String(r.total).padStart(5)}  (g1=${String(r.g1).padStart(4)}  g2=${String(r.g2).padStart(4)})`);
    }

    if (ranked[0].name !== "Alice") throw new Error(`winner expected Alice, got ${ranked[0].name}`);
    if (ranked[1].name !== "Carol") throw new Error(`2nd expected Carol, got ${ranked[1].name}`);
    if (ranked[2].name !== "Bob") throw new Error(`3rd expected Bob, got ${ranked[2].name}`);
    if (ranked[0].total <= ranked[1].total || ranked[1].total <= ranked[2].total) {
      throw new Error(`expected strict order Alice > Carol > Bob, got totals ${ranked.map((r) => r.total).join(" > ")}`);
    }
    // Bob's game 1 should be 0 (all wrong); his game 2 should be > 0 (alternates).
    const bob = ranked.find((r) => r.name === "Bob");
    if (bob.g1 !== 0) throw new Error(`Bob g1 expected 0 (all wrong), got ${bob.g1}`);
    if (bob.g2 <= 0) throw new Error(`Bob g2 expected > 0 (alternates), got ${bob.g2}`);
    pass(`leaderboard correct: ${ranked.map((r) => `${r.name}(${r.total})`).join(" > ")}`);
  }

  console.log(`\n${colorize("═══ FULL FLOW GREEN (2 games) ═══", "green")} (total ${Math.round((Date.now() - startedAt) / 1000)}s)`);
  console.log("Login ✓  Night ✓  G1 setup/play/end ✓  Phones joined g2 ✓  G2 setup/play/end ✓  Cumulative leaderboard ✓\n");
} catch (e) {
  console.log(`\n${colorize("═══ FULL FLOW RED ═══", "red")}`);
  console.log(`  ${e?.message ?? e}`);

  // Best-effort state dump for actionable failures
  for (let i = 0; i < 2; i++) {
    const gid = i === 0 ? game1Id : game2Id;
    const cid = categoryIds[i];
    if (!gid) continue;
    const { data: g } = await admin
      .from("games")
      .select("state, started_at, ended_at")
      .eq("id", gid)
      .maybeSingle();
    note(`g${i + 1} state=${g?.state ?? "?"} started=${!!g?.started_at} ended=${!!g?.ended_at}`);
    if (cid) {
      const { data: cat } = await admin
        .from("categories")
        .select("state")
        .eq("id", cid)
        .maybeSingle();
      note(`g${i + 1} category state=${cat?.state ?? "?"}`);
      const { data: qs } = await admin
        .from("questions")
        .select("point_value, played_at, finished_at")
        .eq("category_id", cid)
        .order("point_value");
      for (const q of qs ?? []) {
        note(`  Q ${q.point_value}pt played=${!!q.played_at} finished=${!!q.finished_at}`);
      }
    }
  }
  console.log("");
  process.exitCode = 1;
} finally {
  if (nightId) {
    step("cleanup");
    const { error } = await admin.from("nights").delete().eq("id", nightId);
    if (error) note(`cleanup warning: ${error.message}`);
    else pass(`deleted night ${nightId.slice(0, 8)}… (cascade)`);
  }
}
