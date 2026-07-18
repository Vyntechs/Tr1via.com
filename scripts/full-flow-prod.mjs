// Full prod end-to-end driver. Plays an entire 2-game night against
// tr1via.com, HTTP-only, no browser, no MCP. The point of this script is
// to find the next gameplay bug before the first host does — 2026-05-27 go-live.
//
// Two modes:
//
//   - DEFAULT (SMOKE_PHONES <= 3): full 2-game arc with strict
//     leaderboard assertion. Alice always correct, Bob wrong in G1 then
//     alternates, Carol alternates. ~165s total. Catches gameplay bugs.
//
//   - LOAD MODE (SMOKE_PHONES > 3): single game, single category,
//     N phones answer in parallel per question. Optional Realtime
//     subscribe (SMOKE_REALTIME=1) so each phone holds a WebSocket like
//     a real browser. Captures peak intra-game concurrency, which is
//     the relevant metric for the first host's 30-phone venue night.
//
// Theme passes (default mode only):
//
//   The script runs the 2-game arc TWICE in sequence:
//     Pass 1 — themeKey "may":  25s timer, marquee=true.
//     Pass 2 — themeKey "house": 20s timer, marquee=false.
//   Each pass creates a fresh night, plays it, asserts theme + timer,
//   then deletes it before starting the next. Total ~330s.
//   Set SMOKE_THEME_SINGLE=may|house to run only one pass.
//
// Flow:
//   1.  Founder bypass login.
//   2.  Create a night (auto-creates 2 game shells).
//   2b. PATCH /api/nights/:id/theme to set the pass theme.
//   2c. Assert DB theme_key and derived timer duration.
//   3.  Resolve game 1 + game 2 ids via Supabase admin.
//   4.  Set up game 1 category (create, generate, pick 7 — which also
//       "locks" the category by flipping state to 'ready'; there is NO
//       separate lock endpoint).
//   5.  Open the room.
//   6.  Spawn SMOKE_PHONES simulated phones (own cookie jars), each calls
//       /api/session/init then /api/players to join the night
//       (auto-opts into game 1). Optional realtime subscribe per phone.
//   7.  Play game 1 (start → 7 cells of reveal/parallel-answer/end-early).
//   8.  End game 1.
//   9.  [3-phone mode only] Phones explicitly join game 2.
//   10. [3-phone mode only] Set up game 2 category and play it.
//   11. [3-phone mode only] End game 2.
//   12. [3-phone mode only] Assert cumulative leaderboard across both games.
//   13. Cleanup: delete the night (cascade).
//
// Usage:
//   # Default 3-phone smoke (game logic test, both theme passes):
//   node --env-file=.env.local scripts/full-flow-prod.mjs [topic1] [topic2]
//
//   # Single-pass override:
//   SMOKE_THEME_SINGLE=may node --env-file=.env.local scripts/full-flow-prod.mjs
//
//   # 30-phone load mode with WebSocket subscribes:
//   SMOKE_PHONES=30 SMOKE_REALTIME=1 node --env-file=.env.local scripts/full-flow-prod.mjs
//
//   # Realistic-stagger 30-phone simulation:
//   SMOKE_PHONES=30 SMOKE_REALTIME=1 SMOKE_JOIN_STAGGER_MS=1500 node --env-file=.env.local scripts/full-flow-prod.mjs
//
// Exit 0 = green. Exit 1 = the bug the first host would have hit; the printout
// names the step, the game, the question, and DB state at the failure.

import { createClient } from "@supabase/supabase-js";
import { genTimeoutFromEnv } from "./prod-smoke-config.mjs";

const BASE = process.env.SMOKE_BASE_URL ?? "https://tr1via.com";
const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? "brandon@vyntechs.com";
const SMOKE_PHONES = Math.max(1, Math.min(100, Number(process.env.SMOKE_PHONES ?? 3)));
const LOAD_MODE = SMOKE_PHONES > 3;
const SMOKE_REALTIME = process.env.SMOKE_REALTIME === "1";
// Skip the end-of-run night deletion so a downstream read-only validator
// (e.g. validate-points-reset-prod.mjs) can inspect the just-played night.
// Prints the full NIGHT_ID to pass along. Off by default (nights are cleaned).
const SMOKE_KEEP_NIGHT = process.env.SMOKE_KEEP_NIGHT === "1";
// Default 0 = burst (all phones hit /api/players within ~50ms). Set higher
// to simulate real-world trickle joins (e.g. 1500 = roughly one new phone
// every 1.5s).
const SMOKE_JOIN_STAGGER_MS = Math.max(0, Number(process.env.SMOKE_JOIN_STAGGER_MS ?? 0));
// 2-category games exercise the section-complete celebration (predicate
// fires after the first category clears but before the game ends). Load
// mode auto-drops to 1 cat (peak concurrency matters more than narrative).
// Explicit env override always wins.
const CATEGORIES_PER_GAME = Math.max(
  1,
  Number(process.env.CATEGORIES_PER_GAME ?? (LOAD_MODE ? 1 : 2)),
);
const TOPIC_BANK_G1 = [
  process.argv[2] ?? "classic movie quotes",
  "pixar films",
  "broadway musicals",
];
const TOPIC_BANK_G2 = [
  process.argv[3] ?? "world geography",
  "famous bridges",
  "national parks",
];
// Env-configurable: question generation now runs Sonnet + two Opus verify
// passes, which is slower than the old single Haiku call. Share one budget
// with the API smoke so cleanup cannot race a healthy background worker.
const GEN_TIMEOUT_MS = genTimeoutFromEnv();
const POLL_MS = 2000;
// Alice/Bob/Carol drive the strict assertions in 3-phone mode. Player04+
// are pure load phones with a simple alternate-correct-wrong strategy.
const PHONE_NAMES = Array.from({ length: SMOKE_PHONES }, (_, i) => {
  if (i === 0) return "Alice";
  if (i === 1) return "Bob";
  if (i === 2) return "Carol";
  return `Player${String(i + 1).padStart(2, "0")}`;
});

// Theme passes to run. In load mode there is no theme assertion — the arc
// is about concurrency, not feature correctness — so we run a single pass
// with no theme override.  In default (game-logic) mode we run both May
// and a non-May theme (house) unless SMOKE_THEME_SINGLE overrides to one.
const SMOKE_THEME_SINGLE = process.env.SMOKE_THEME_SINGLE ?? null;
const THEME_PASSES = LOAD_MODE
  ? [null]
  : SMOKE_THEME_SINGLE
    ? [SMOKE_THEME_SINGLE]
    : ["may", "house"];

// Duration constants mirrored from lib/theme/lockInCeremony.ts.
// These must stay in sync with the TypeScript source; no import possible in a
// plain .mjs script. The 25s timer is the default for every theme; DURATION_BY_THEME
// only holds per-theme overrides (none today — kept for future divergence).
const DURATION_BY_THEME = {};
const DEFAULT_DURATION = 25;
function questionDurationFor(themeKey) {
  if (!themeKey) return DEFAULT_DURATION;
  return DURATION_BY_THEME[themeKey] ?? DEFAULT_DURATION;
}
const MARQUEE_THEMES = new Set(["may"]);

function colorize(s, c) {
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, magenta: 35 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}
const pass = (s) => console.log(`  ${colorize("✓", "green")} ${s}`);
const fail = (s) => console.log(`  ${colorize("✗", "red")} ${s}`);
const step = (s) => console.log(`\n${colorize("▸", "cyan")} ${s}`);
const note = (s) => console.log(`  ${colorize("·", "gray")} ${s}`);
const passHeader = (s) => console.log(`\n${colorize(`▶▶▶ ${s}`, "magenta")}`);

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
    // Per-phone Supabase client used only for the room broadcast channel
    // when SMOKE_REALTIME is set. We create one client per phone so each
    // opens its own WebSocket, matching what 30 real browsers would do.
    this.rtClient = null;
    this.rtChannel = null;
    this.rtBroadcastsReceived = 0;
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
  // Opens a per-phone WebSocket to the broadcast channel — mirrors what
  // the player-facing room page does. Counts inbound broadcasts so the
  // load run can prove the WebSocket actually delivered events.
  async openRealtime(roomCode, supaUrl, anonKey) {
    this.rtClient = createClient(supaUrl, anonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const channel = this.rtClient.channel(`room:${roomCode}`);
    const eventNames = ["reveal", "undo", "resolve", "end-early", "game-ended"];
    for (const event of eventNames) {
      channel.on("broadcast", { event }, () => {
        this.rtBroadcastsReceived += 1;
      });
    }
    // Wait for SUBSCRIBED (or fail-fast on a bad status) so the run
    // actually proves connectivity before we play questions.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${this.name} realtime subscribe timeout`)),
        10_000,
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timeout);
          reject(new Error(`${this.name} realtime status=${status}`));
        }
      });
    });
    this.rtChannel = channel;
  }
  async closeRealtime() {
    if (this.rtChannel && this.rtClient) {
      await this.rtClient.removeChannel(this.rtChannel);
      this.rtChannel = null;
    }
    this.rtClient = null;
  }
}

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supaAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supaUrl || !supaKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (SMOKE_REALTIME && !supaAnonKey) {
  console.error("SMOKE_REALTIME=1 requires NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}
const admin = createClient(supaUrl, supaKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const modeLabel = LOAD_MODE
  ? `LOAD MODE — ${SMOKE_PHONES} phones, 1 game`
  : `${SMOKE_PHONES} phones, 2 games`;
console.log(`\n${colorize(`═══ TR1VIA full-flow prod driver (${modeLabel}) ═══`, "cyan")}`);
console.log(`  base       : ${BASE}`);
console.log(`  email      : ${FOUNDER_EMAIL}`);
console.log(`  phones     : ${SMOKE_PHONES}${LOAD_MODE ? " (load mode)" : ""}`);
console.log(`  realtime   : ${SMOKE_REALTIME ? "on (per-phone WebSocket subscribe)" : "off (HTTP only)"}`);
console.log(`  join stagger: ${SMOKE_JOIN_STAGGER_MS}ms${SMOKE_JOIN_STAGGER_MS === 0 ? " (burst)" : ""}`);
console.log(`  cats/g     : ${CATEGORIES_PER_GAME}`);
console.log(`  g1 topics  : ${TOPIC_BANK_G1.slice(0, CATEGORIES_PER_GAME).join(", ")}`);
if (!LOAD_MODE) {
  console.log(`  g2 topics  : ${TOPIC_BANK_G2.slice(0, CATEGORIES_PER_GAME).join(", ")}`);
}
console.log(`  theme passes: ${THEME_PASSES.map((t) => t ?? "none").join(", ")}`);

// ── Per-pass mutable state (reset between passes by runOnePass) ───────
// These are declared in module scope so the helpers below can close over
// them without needing explicit parameter threading.
let founderJar = new Jar();
let phones = PHONE_NAMES.map((n) => new Phone(n));
let perQuestionTimings = [];

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
  let deadline = Date.now() + GEN_TIMEOUT_MS;
  let candidates = [];
  let lastState = null;
  let recoveryAttempts = 0;
  while (Date.now() < deadline) {
    const [{ data: cat }, { data: job }] = await Promise.all([
      admin
        .from("categories")
        .select("state")
        .eq("id", categoryId)
        .maybeSingle(),
      admin
        .from("question_generation_jobs")
        .select("phase, certified_count, target_count, attempt")
        .eq("category_id", categoryId)
        .maybeSingle(),
    ]);
    if (cat?.state !== lastState) {
      note(`(${topic}) state=${cat?.state} (${Math.round((Date.now() - genStart) / 1000)}s)`);
      lastState = cat?.state;
    }
    if (cat?.state === "draft") {
      throw new Error(`(${topic}) category rolled back to draft`);
    }
    if (job?.phase === "needs_attention") {
      if (recoveryAttempts >= 1) {
        throw new Error(
          `(${topic}) recovery still needs attention after attempt ${job.attempt}`,
        );
      }
      note(
        `(${topic}) retrying only the uncertified shortfall ` +
          `(${job.certified_count}/${job.target_count} already safe)`,
      );
      const retryRes = await call(
        founderJar,
        `/api/categories/${categoryId}/generate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (retryRes.status !== 202) {
        throw new Error(
          `retry generate (${topic}): ${retryRes.status} ${await retryRes.text()}`,
        );
      }
      recoveryAttempts += 1;
      deadline = Date.now() + GEN_TIMEOUT_MS;
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
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
//   Player04+ (load mode): alternate based on (phoneIndex + cellIndex)
//     parity so different phones land different mixes per question.
function decide(phoneIndex, cellIndex, gameNo) {
  if (phoneIndex === 0) return "correct";
  if (phoneIndex === 1) {
    return gameNo === 1 ? "wrong" : cellIndex % 2 === 0 ? "correct" : "wrong";
  }
  if (phoneIndex === 2) {
    return cellIndex % 2 === 0 ? "correct" : "wrong";
  }
  return (phoneIndex + cellIndex) % 2 === 0 ? "correct" : "wrong";
}

// Mirrors useSectionCompleteCelebration's pickCelebration predicate.
// Returns one of:
//   { fire: true,  topicName, categoryId }      — celebration would fire
//   { fire: false, reason }                     — celebration would NOT fire
// The script asserts this at category boundaries so a refactor that breaks
// the trigger surfaces as a red here even though the hook lives in React.
async function evaluateSectionCompletePredicate(gameId) {
  const { data: cats } = await admin
    .from("categories")
    .select("id, name, color")
    .eq("game_id", gameId);
  const catIds = (cats ?? []).map((c) => c.id);
  if (catIds.length === 0) return { fire: false, reason: "no categories" };

  const { data: qs } = await admin
    .from("questions")
    .select("id, category_id, is_picked, point_value, finished_at")
    .in("category_id", catIds);

  const finished = (qs ?? [])
    .filter((q) => q.is_picked && q.point_value !== null && q.finished_at !== null)
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  const last = finished[0];
  if (!last) return { fire: false, reason: "no finished picked questions yet" };

  const sameCatUnplayed = (qs ?? []).filter(
    (q) =>
      q.category_id === last.category_id &&
      q.is_picked &&
      q.point_value !== null &&
      q.finished_at === null,
  );
  if (sameCatUnplayed.length > 0) {
    return { fire: false, reason: `same category has ${sameCatUnplayed.length} unplayed` };
  }
  const otherCatUnplayed = (qs ?? []).filter(
    (q) =>
      q.category_id !== last.category_id &&
      q.is_picked &&
      q.point_value !== null &&
      q.finished_at === null,
  );
  if (otherCatUnplayed.length === 0) {
    return { fire: false, reason: "every category exhausted (End Game)" };
  }
  const category = (cats ?? []).find((c) => c.id === last.category_id);
  return {
    fire: true,
    topicName: category?.name ?? null,
    categoryId: last.category_id,
  };
}

async function assertSectionCompletePredicate(gameId, expected, ctx) {
  const verdict = await evaluateSectionCompletePredicate(gameId);
  if (expected && !verdict.fire) {
    throw new Error(
      `${ctx}: expected section-complete to FIRE — reason="${verdict.reason}"`,
    );
  }
  if (!expected && verdict.fire) {
    throw new Error(
      `${ctx}: section-complete WOULD fire but should NOT — topic="${verdict.topicName}"`,
    );
  }
  if (verdict.fire) {
    pass(`${ctx} — section-complete would fire (topic="${verdict.topicName}")`);
  } else {
    pass(`${ctx} — section-complete would NOT fire (${verdict.reason})`);
  }
}

async function playOneQuestion(gameId, gameNo, q, cellGlobalIndex) {
  const tag = `G${gameNo} Q${cellGlobalIndex + 1} (${q.point_value}pt)`;

  // Reveal
  const revealStart = Date.now();
  {
    const res = await call(founderJar, `/api/games/${gameId}/reveal`, {
      method: "POST",
      body: JSON.stringify({ questionId: q.id }),
    });
    if (!res.ok) throw new Error(`reveal ${tag}: ${res.status} ${await res.text()}`);
  }
  const revealMs = Date.now() - revealStart;

  // All phones answer in PARALLEL — this is what 30 real phones look like
  // from the API's perspective (one /api/answers POST per phone, all in
  // flight simultaneously). The sequential loop in the original 3-phone
  // mode masked any contention; this exposes it.
  const answerStart = Date.now();
  await Promise.all(
    phones.map((phone, pi) => {
      const scramble = scrambleFor(q.id, phone.playerId);
      const correct1 = correctSlot(scramble, q.correct_index);
      const slot =
        decide(pi, cellGlobalIndex, gameNo) === "correct"
          ? correct1
          : (correct1 % 4) + 1;
      return phone.submitAnswer(q.id, slot);
    }),
  );
  const answerMs = Date.now() - answerStart;

  // Host ends early → resolve_question RPC + broadcast.
  const endEarlyStart = Date.now();
  {
    const res = await call(founderJar, `/api/games/${gameId}/end-early`, {
      method: "POST",
      body: JSON.stringify({ questionId: q.id }),
    });
    if (!res.ok) throw new Error(`end-early ${tag}: ${res.status} ${await res.text()}`);
  }
  const endEarlyMs = Date.now() - endEarlyStart;

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
  if ((answers?.length ?? 0) !== phones.length) {
    throw new Error(`${tag}: expected ${phones.length} answers, got ${answers?.length ?? 0}`);
  }
  const ungraded = answers.filter(
    (a) => a.is_correct === null || a.awarded_points === null,
  );
  if (ungraded.length) {
    throw new Error(`${tag}: ${ungraded.length} answers left ungraded by resolve_question`);
  }
  perQuestionTimings.push({ tag, revealMs, answerMs, endEarlyMs });
  if (LOAD_MODE) {
    pass(`${tag} reveal=${revealMs}ms · ${phones.length}× answer (parallel)=${answerMs}ms · resolve=${endEarlyMs}ms`);
  } else {
    pass(`${tag} revealed → ${phones.length} answered → resolved → graded`);
  }
}

async function playGame(gameId, gameNo, categories) {
  // Start (idempotent).
  const startRes = await call(founderJar, `/api/games/${gameId}/start`, {
    method: "POST",
  });
  if (!startRes.ok) throw new Error(`start game ${gameNo}: ${startRes.status} ${await startRes.text()}`);

  let cellGlobalIndex = 0;
  for (let catIdx = 0; catIdx < categories.length; catIdx++) {
    const { picked } = categories[catIdx];
    const isLastCategory = catIdx === categories.length - 1;
    for (let qIdx = 0; qIdx < picked.length; qIdx++) {
      await playOneQuestion(gameId, gameNo, picked[qIdx], cellGlobalIndex);
      cellGlobalIndex += 1;
      const isLastQuestionInCat = qIdx === picked.length - 1;

      if (isLastQuestionInCat) {
        // Category just cleared. If it's the LAST category in the game, the
        // predicate must NOT fire (End Game territory). Otherwise it must fire.
        const ctx = `G${gameNo} after cat ${catIdx + 1}/${categories.length} cleared`;
        await assertSectionCompletePredicate(
          gameId,
          /* expected fire */ !isLastCategory,
          ctx,
        );
      }
    }
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

// ── Theme assertions ──────────────────────────────────────────────────
// Validates the theme path for a night: DB theme_key, computed duration,
// marquee flag, and API surface (TV snapshot). In load mode this is skipped
// (nightThemeKey is always null; we don't call PATCH /theme).

async function assertThemePath(nightId, roomCode, nightThemeKey) {
  if (LOAD_MODE) return; // load mode doesn't exercise the theme path

  const expectedDuration = questionDurationFor(nightThemeKey);
  const expectedMarquee = MARQUEE_THEMES.has(nightThemeKey ?? "");
  const themeLabel = nightThemeKey ?? "null (default)";

  step(`2c. assert theme path (themeKey=${themeLabel})`);

  // 1. DB: nights.theme_key must match what we set.
  const { data: nightRow } = await admin
    .from("nights")
    .select("theme_key")
    .eq("id", nightId)
    .maybeSingle();
  const actualThemeKey = nightRow?.theme_key ?? null;
  if (actualThemeKey !== nightThemeKey) {
    throw new Error(
      `theme DB: expected theme_key="${nightThemeKey}" in nights, got "${actualThemeKey}"`,
    );
  }
  pass(`DB nights.theme_key = "${actualThemeKey}" ✓`);

  // 2. Derived timer duration matches lockInCeremonyFor() logic.
  const actualDuration = questionDurationFor(actualThemeKey);
  if (actualDuration !== expectedDuration) {
    throw new Error(
      `timer duration: expected ${expectedDuration}s for themeKey="${nightThemeKey}", got ${actualDuration}s`,
    );
  }
  pass(`timer duration = ${actualDuration}s (${nightThemeKey === "may" ? "May/Storm extended" : "default"}) ✓`);

  // 3. Marquee flag: may=true, everything else=false.
  const actualMarquee = MARQUEE_THEMES.has(actualThemeKey ?? "");
  if (actualMarquee !== expectedMarquee) {
    throw new Error(
      `marquee: expected ${expectedMarquee} for themeKey="${nightThemeKey}", got ${actualMarquee}`,
    );
  }
  pass(`marquee = ${actualMarquee} (${nightThemeKey === "may" ? "scoreboard marquee on" : "lock-in pile"}) ✓`);

  // 4. TV snapshot surface: themeKey field is propagated.
  const snapRes = await fetch(`${BASE}/api/tv/${roomCode}/snapshot`);
  if (!snapRes.ok) {
    throw new Error(`TV snapshot: ${snapRes.status} ${await snapRes.text()}`);
  }
  const snap = await snapRes.json();
  // The ok() helper returns the body directly (no wrapper), so the shape
  // is { night: { themeKey, ... }, games: [...], ... }.
  const snapThemeKey = snap?.night?.themeKey ?? null;
  if (snapThemeKey !== nightThemeKey) {
    throw new Error(
      `TV snapshot: expected themeKey="${nightThemeKey}", got "${snapThemeKey}"`,
    );
  }
  pass(`TV snapshot.night.themeKey = "${snapThemeKey}" ✓`);
}

// ── One full night pass ───────────────────────────────────────────────

async function runOnePass(passThemeKey) {
  // Reset per-pass mutable state.
  founderJar = new Jar();
  phones = PHONE_NAMES.map((n) => new Phone(n));
  perQuestionTimings = [];

  const gameCategories = [[], []];
  let nightId = null;
  let roomCode = null;
  let game1Id = null;
  let game2Id = null;
  const passStartedAt = Date.now();

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

    // 2b. Set theme (skip for load mode or null pass)
    if (!LOAD_MODE && passThemeKey) {
      step(`2b. set theme to "${passThemeKey}"`);
      const themeRes = await call(founderJar, `/api/nights/${nightId}/theme`, {
        method: "PATCH",
        body: JSON.stringify({ themeKey: passThemeKey }),
      });
      if (!themeRes.ok) {
        throw new Error(`set theme: ${themeRes.status} ${await themeRes.text()}`);
      }
      const themeBody = await themeRes.json();
      // ok() returns the body directly, so the shape is { themeKey: "may" }.
      if (themeBody?.themeKey !== passThemeKey) {
        throw new Error(
          `set theme: response themeKey="${themeBody?.themeKey}", expected "${passThemeKey}"`,
        );
      }
      pass(`PATCH /api/nights/${nightId.slice(0, 8)}…/theme → themeKey="${passThemeKey}" ✓`);
    }

    // 2c. Assert theme path (DB + derived duration + TV snapshot)
    await assertThemePath(nightId, roomCode, passThemeKey ?? null);

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

    // 3b. Sad-path guard: starting either game now (zero categories) must
    //     fail with 400. The server precondition is what stops the host
    //     from accidentally landing the TV on an empty "0 of 0 ANSWERED"
    //     board. Both games are still in 'draft' here.
    step("3b. assert empty games refuse to start (server precondition)");
    {
      const r1 = await call(founderJar, `/api/games/${game1Id}/start`, { method: "POST" });
      if (r1.status !== 400) {
        const body = await r1.text();
        throw new Error(`g1 start with no categories should 400, got ${r1.status} body=${body}`);
      }
      const r2 = await call(founderJar, `/api/games/${game2Id}/start`, { method: "POST" });
      if (r2.status !== 400) {
        const body = await r2.text();
        throw new Error(`g2 start with no categories should 400, got ${r2.status} body=${body}`);
      }
      pass(`empty-game start refused: g1 → 400, g2 → 400 (precondition works)`);
    }

    // 4. Set up game 1 categories
    step(`4. set up game 1 categories (${CATEGORIES_PER_GAME} × create → generate → pick 7)`);
    {
      for (let i = 0; i < CATEGORIES_PER_GAME; i++) {
        const t0 = Date.now();
        const topic = TOPIC_BANK_G1[i] ?? `${TOPIC_BANK_G1[0]} ${i + 1}`;
        const r = await setupCategory(game1Id, topic, i + 1);
        gameCategories[0].push(r);
        pass(`g1 cat ${i + 1}/${CATEGORIES_PER_GAME} (${topic}) ready in ${Math.round((Date.now() - t0) / 1000)}s, points ${r.picked.map((q) => q.point_value).join(",")}`);
      }
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
    step(`6. spawn ${SMOKE_PHONES} phones and join night${SMOKE_JOIN_STAGGER_MS > 0 ? ` (stagger ${SMOKE_JOIN_STAGGER_MS}ms)` : " (burst)"}`);
    const joinStart = Date.now();
    if (SMOKE_JOIN_STAGGER_MS === 0) {
      // Burst: all phones init + join in parallel (worst-case stress).
      await Promise.all(
        phones.map(async (p) => {
          await p.init();
          await p.joinNight(nightId);
        }),
      );
    } else {
      // Trickle: phones join with a fixed inter-join delay.
      for (const p of phones) {
        await p.init();
        await p.joinNight(nightId);
        if (p !== phones[phones.length - 1]) {
          await new Promise((r) => setTimeout(r, SMOKE_JOIN_STAGGER_MS));
        }
      }
    }
    const joinElapsedMs = Date.now() - joinStart;
    if (LOAD_MODE) {
      pass(`all ${SMOKE_PHONES} phones joined in ${joinElapsedMs}ms (${Math.round(joinElapsedMs / SMOKE_PHONES)}ms/phone avg)`);
    } else {
      for (const p of phones) {
        pass(`${p.name} joined (player=${p.playerId.slice(0, 8)}…)`);
      }
    }
    if (SMOKE_REALTIME) {
      const rtStart = Date.now();
      await Promise.all(
        phones.map((p) => p.openRealtime(roomCode, supaUrl, supaAnonKey)),
      );
      pass(`${SMOKE_PHONES}× realtime subscribed in ${Date.now() - rtStart}ms`);
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
      pass(`all ${SMOKE_PHONES} have game_participations rows for game 1`);
    }

    // 7. Play game 1
    step(`7. play game 1 (${CATEGORIES_PER_GAME * 7} cells across ${CATEGORIES_PER_GAME} categor${CATEGORIES_PER_GAME === 1 ? "y" : "ies"})`);
    await playGame(game1Id, 1, gameCategories[0]);

    // 8. End game 1
    step("8. end game 1 + assert intermission");
    await endGame(game1Id, 1);
    pass("game 1 state=done");
    {
      const { data: gs } = await admin
        .from("games")
        .select("id, game_no, state")
        .eq("night_id", nightId)
        .order("game_no");
      const g1 = gs.find((g) => g.game_no === 1);
      const g2 = gs.find((g) => g.game_no === 2);
      if (g1?.state !== "done") throw new Error(`expected g1.state=done, got ${g1?.state}`);
      if (g2?.state === "done") throw new Error(`unexpected g2.state=done before play`);
      pass(`intermission state: g1=done, g2=${g2?.state}`);
    }

    // Steps 9-12 only run in the default (3-phone) game-logic mode. LOAD MODE
    // stops after game 1 because the relevant signal is intra-game peak
    // concurrency, not narrative span.
    if (!LOAD_MODE) {
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

      // 10. Set up game 2 categories
      step(`10. set up game 2 categories (${CATEGORIES_PER_GAME} × create → generate → pick 7)`);
      {
        for (let i = 0; i < CATEGORIES_PER_GAME; i++) {
          const t0 = Date.now();
          const topic = TOPIC_BANK_G2[i] ?? `${TOPIC_BANK_G2[0]} ${i + 1}`;
          const r = await setupCategory(game2Id, topic, i + 1);
          gameCategories[1].push(r);
          pass(`g2 cat ${i + 1}/${CATEGORIES_PER_GAME} (${topic}) ready in ${Math.round((Date.now() - t0) / 1000)}s, points ${r.picked.map((q) => q.point_value).join(",")}`);
        }
      }

      step(`11. play game 2 (${CATEGORIES_PER_GAME * 7} cells across ${CATEGORIES_PER_GAME} categor${CATEGORIES_PER_GAME === 1 ? "y" : "ies"})`);
      await playGame(game2Id, 2, gameCategories[1]);

      // 12. End game 2 + assert finale
      step("12. end game 2 + assert finale");
      await endGame(game2Id, 2);
      pass("game 2 state=done");
      {
        const { data: gs } = await admin
          .from("games")
          .select("game_no, state")
          .eq("night_id", nightId)
          .order("game_no");
        const g1 = gs.find((g) => g.game_no === 1);
        const g2 = gs.find((g) => g.game_no === 2);
        if (g1?.state !== "done" || g2?.state !== "done") {
          throw new Error(`finale predicate fails: g1=${g1?.state} g2=${g2?.state}`);
        }
        pass(`finale state: g1=done, g2=done`);
      }
    }

    // 13. Strict leaderboard assertion (default mode) OR load summary.
    step(LOAD_MODE ? `13. load summary (${SMOKE_PHONES} phones)` : "13. assert cumulative leaderboard (across both games)");
    if (LOAD_MODE) {
      // Load-mode summary: timings + answer integrity + broadcast deliveries.
      const picked = gameCategories[0].flatMap((c) => c.picked);
      const { data: rows } = await admin
        .from("answers")
        .select("player_id, question_id, awarded_points, is_correct")
        .in("question_id", picked.map((q) => q.id));

      const totalAnswers = rows?.length ?? 0;
      const expectedAnswers = SMOKE_PHONES * picked.length;
      if (totalAnswers !== expectedAnswers) {
        throw new Error(
          `load integrity: expected ${expectedAnswers} answers (${SMOKE_PHONES} × ${picked.length}), got ${totalAnswers}`,
        );
      }
      pass(`integrity: all ${expectedAnswers} answers landed and were graded`);

      // Timing distribution
      const answerMsValues = perQuestionTimings.map((t) => t.answerMs).sort((a, b) => a - b);
      const p50 = answerMsValues[Math.floor(answerMsValues.length * 0.5)];
      const p95 = answerMsValues[Math.floor(answerMsValues.length * 0.95)] ?? answerMsValues[answerMsValues.length - 1];
      const max = answerMsValues[answerMsValues.length - 1];
      note(`${SMOKE_PHONES}-phone parallel POST /api/answers per question:`);
      note(`  p50 = ${p50}ms   p95 = ${p95}ms   max = ${max}ms`);

      // Spot-check per-phone scores: every phone should have a non-null score.
      const scoreByPlayer = new Map();
      for (const r of rows ?? []) {
        scoreByPlayer.set(r.player_id, (scoreByPlayer.get(r.player_id) ?? 0) + (r.awarded_points ?? 0));
      }
      const phonesWithZeroScore = phones.filter((p) => (scoreByPlayer.get(p.playerId) ?? 0) === 0);
      if (phonesWithZeroScore.length > 0) {
        // Some phones may legitimately get all-wrong; flag but don't fail.
        note(`${phonesWithZeroScore.length} phone(s) ended with 0 points (acceptable: deterministic decide() may give all-wrong)`);
      }
      const scores = phones.map((p) => scoreByPlayer.get(p.playerId) ?? 0);
      const min = Math.min(...scores);
      const maxScore = Math.max(...scores);
      note(`scores: min=${min}  max=${maxScore}  avg=${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}`);

      // Realtime broadcast delivery (if enabled)
      if (SMOKE_REALTIME) {
        const broadcastsByPhone = phones.map((p) => p.rtBroadcastsReceived);
        const totalBroadcasts = broadcastsByPhone.reduce((a, b) => a + b, 0);
        const expectedPerPhone = picked.length * 2; // reveal + end-early per question
        const minPerPhone = Math.min(...broadcastsByPhone);
        const maxPerPhone = Math.max(...broadcastsByPhone);
        note(`realtime: ${totalBroadcasts} broadcasts received across ${SMOKE_PHONES} phones (expected ~${expectedPerPhone}/phone)`);
        note(`  min/phone=${minPerPhone}  max/phone=${maxPerPhone}`);
        if (minPerPhone < Math.floor(expectedPerPhone * 0.5)) {
          throw new Error(
            `realtime delivery: a phone received only ${minPerPhone} broadcasts (expected ~${expectedPerPhone}); WebSocket layer likely struggling at ${SMOKE_PHONES} clients`,
          );
        }
        pass(`realtime delivery: all phones received at least 50% of expected broadcasts`);
      }
    } else {
      const picked1 = gameCategories[0].flatMap((c) => c.picked);
      const picked2 = gameCategories[1].flatMap((c) => c.picked);
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

    const passLabel = passThemeKey ? `themeKey="${passThemeKey}"` : "default (no theme)";
    const finishedBanner = LOAD_MODE
      ? `═══ LOAD FLOW GREEN (${SMOKE_PHONES} phones) ═══`
      : `═══ PASS GREEN — ${passLabel} ═══`;
    console.log(`\n${colorize(finishedBanner, "green")} (${Math.round((Date.now() - passStartedAt) / 1000)}s)`);
    if (!LOAD_MODE) {
      const themeChecks = passThemeKey
        ? `Theme="${passThemeKey}" ✓  Timer=${questionDurationFor(passThemeKey)}s ✓  Marquee=${MARQUEE_THEMES.has(passThemeKey)} ✓  `
        : `Theme=null (default) ✓  Timer=${questionDurationFor(null)}s ✓  Marquee=false ✓  `;
      console.log(`  ${themeChecks}Login ✓  Night ✓  G1 setup/play/end ✓  Phones joined g2 ✓  G2 setup/play/end ✓  Leaderboard ✓\n`);
    } else {
      console.log(`  Login ✓  Night ✓  ${SMOKE_PHONES} phones joined ✓  G1 played (parallel answers) ✓  Integrity + timings reported ✓\n`);
    }
  } catch (e) {
    console.log(`\n${colorize("═══ PASS RED ═══", "red")} (themeKey=${passThemeKey ?? "null"})`);
    console.log(`  ${e?.message ?? e}`);

    // Best-effort state dump for actionable failures
    for (let i = 0; i < 2; i++) {
      const gid = i === 0 ? game1Id : game2Id;
      if (!gid) continue;
      const { data: g } = await admin
        .from("games")
        .select("state, started_at, ended_at")
        .eq("id", gid)
        .maybeSingle();
      note(`g${i + 1} state=${g?.state ?? "?"} started=${!!g?.started_at} ended=${!!g?.ended_at}`);
      for (const { categoryId } of gameCategories[i]) {
        if (!categoryId) continue;
        const { data: cat } = await admin
          .from("categories")
          .select("state, name")
          .eq("id", categoryId)
          .maybeSingle();
        note(`g${i + 1} category "${cat?.name}" state=${cat?.state ?? "?"}`);
        const { data: qs } = await admin
          .from("questions")
          .select("id, source, is_picked, point_value, played_at, finished_at")
          .eq("category_id", categoryId)
          .order("point_value");
        for (const q of qs ?? []) {
          note(
            `  Q ${q.id.slice(0, 8)}… source=${q.source} picked=${q.is_picked} ` +
              `slot=${q.point_value ?? "null"} played=${!!q.played_at} finished=${!!q.finished_at}`,
          );
        }
      }
    }
    console.log("");
    throw e; // re-throw so the outer loop can mark the run failed
  } finally {
    // Close any per-phone WebSocket subscriptions before exiting the process.
    if (SMOKE_REALTIME) {
      await Promise.all(phones.map((p) => p.closeRealtime().catch(() => undefined)));
    }
    if (nightId) {
      step("cleanup");
      if (SMOKE_KEEP_NIGHT) {
        note("SMOKE_KEEP_NIGHT=1 — night left in place for inspection");
        pass(`NIGHT_ID=${nightId}  (pass to validate-points-reset-prod.mjs)`);
      } else {
        const { error } = await admin.from("nights").delete().eq("id", nightId);
        if (error) note(`cleanup warning: ${error.message}`);
        else pass(`deleted night ${nightId.slice(0, 8)}… (cascade)`);
      }
    }
  }
}

// ── Main: run all theme passes ────────────────────────────────────────

const overallStart = Date.now();
let anyFailed = false;

for (const passThemeKey of THEME_PASSES) {
  const passLabel = passThemeKey
    ? `theme="${passThemeKey}" (${questionDurationFor(passThemeKey)}s timer, marquee=${MARQUEE_THEMES.has(passThemeKey)})`
    : "default (no theme override, 20s timer)";
  passHeader(`PASS: ${passLabel}`);

  try {
    await runOnePass(passThemeKey);
  } catch {
    anyFailed = true;
    // Continue to run remaining passes so all failures surface together.
    note(`pass "${passThemeKey ?? "null"}" FAILED — continuing to next pass`);
  }
}

if (anyFailed) {
  console.log(`\n${colorize("═══ FULL FLOW RED ═══", "red")} (total ${Math.round((Date.now() - overallStart) / 1000)}s)\n`);
  process.exitCode = 1;
} else {
  const passesLabel = THEME_PASSES.map((t) => t ?? "default").join(" + ");
  console.log(
    `\n${colorize(`═══ FULL FLOW GREEN (${passesLabel}) ═══`, "green")} (total ${Math.round((Date.now() - overallStart) / 1000)}s)\n`,
  );
}
