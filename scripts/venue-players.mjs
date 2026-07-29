#!/usr/bin/env node
// venue-players — N virtual humans who actually PLAY the night.
//
// This is the sibling of venue-load.mjs, and the difference matters:
//
//   venue-load.mjs  = transport pressure. Polls + heartbeats. Never answers.
//                     Answers a narrow question: "does the idle chatter of a
//                     full room collapse the server?"
//   venue-players   = actual participants. They join the night, opt into each
//                     game, read their OWN scrambled answer layout, lock in a
//                     choice on a human-like delay, get scored by the real
//                     resolve path, and appear in the standings.
//
// The point: a host can run a real game with real phones in the room AND have
// 30 of these in the same room, and the night is indistinguishable from a
// 32-person venue — same writes, same scoring, same leaderboard, same load at
// the one moment that actually hurts (everybody locking in at once).
//
// HONEST LIMIT — these players GUESS. The correct answer is deliberately not
// sent to phones until a question resolves (that's the anti-cheat property),
// and this harness refuses to go around it via the database. So simulated
// accuracy lands near 25% (random of 4) versus ~50%+ for a real room. Every
// write path, score path and leaderboard row is real; only the skill is not.
// If this harness could answer correctly, that would be a security bug.
//
// Still NOT simulated (be honest when quoting results): no browser rendering,
// no realtime websocket subscription, one machine/one network, no host or TV
// surface. See the gap list in docs/handoffs/.
//
// Usage:
//   node scripts/venue-players.mjs --base-url http://localhost:3000 \
//        --night-id <uuid> --code <ROOM> --players 30
//   node scripts/venue-players.mjs --self-test   # no server needed
//
// Runs until --seconds elapses or the night's last game reaches "done".

import http from "node:http";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const POLL_MS = 1500; // matches the real player poll cadence
const HEARTBEAT_EVERY_TICKS = 3; // ~4.5s, like a real phone
const STALL_MS = 5000; // a request this slow is the July-22 "frozen click"
const REQ_TIMEOUT_MS = 12000;

// Human-like answering. Real players do not all fire at t=0: a few are quick,
// most cluster mid-window, a few scramble at the end, and some miss entirely.
const ANSWER_MIN_MS = 1200;
const ANSWER_MAX_MS = 18000;
const SKIP_RATE = 0.08; // fraction of players who simply don't answer a given question

const FIRST_NAMES = [
  "Maya", "Deshawn", "Priya", "Tomas", "Aisling", "Kenji", "Rosa", "Ibrahim",
  "Noor", "Lucas", "Greta", "Malik", "Hana", "Diego", "Freya", "Omar",
  "Zoe", "Andre", "Leena", "Cormac", "Iris", "Yusuf", "Nadia", "Ravi",
  "Simone", "Bo", "Tess", "Milo", "Anya", "Kofi", "Vera", "Elias",
  "Juno", "Rafi", "Lark", "Sena",
];

// ---- args -----------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    baseUrl: "http://localhost:3000",
    nightId: "",
    code: "",
    players: 30,
    seconds: 1800,
    selfTest: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--self-test") a.selfTest = true;
    else if (k === "--quiet") a.quiet = true;
    else if (k === "--base-url") a.baseUrl = argv[++i];
    else if (k === "--night-id") a.nightId = argv[++i];
    else if (k === "--code") a.code = argv[++i];
    else if (k === "--players") a.players = Number(argv[++i]);
    else if (k === "--seconds") a.seconds = Number(argv[++i]);
  }
  return a;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Triangular-ish draw so answers cluster mid-window instead of spiking at 0. */
function humanDelayMs() {
  const a = Math.random(), b = Math.random();
  const mid = (a + b) / 2; // sum of two uniforms → centered
  return Math.round(ANSWER_MIN_MS + mid * (ANSWER_MAX_MS - ANSWER_MIN_MS));
}

// ---- timed request --------------------------------------------------------
async function timedFetch(stats, endpoint, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    const ms = performance.now() - start;
    stats.samples.push({ endpoint, ms, ok: res.ok });
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch {} }
    return { ok: res.ok, status: res.status, json, ms };
  } catch {
    const ms = performance.now() - start;
    stats.samples.push({ endpoint, ms, ok: false });
    return { ok: false, status: 0, json: null, ms };
  } finally {
    clearTimeout(timer);
  }
}

// ---- one virtual human ----------------------------------------------------
async function runPlayer({ baseUrl, nightId, code, seconds, ix, stats, shared }) {
  const name = `${FIRST_NAMES[ix % FIRST_NAMES.length]}${ix >= FIRST_NAMES.length ? " " + (Math.floor(ix / FIRST_NAMES.length) + 1) : ""}`;

  // 1) Real device identity — the same signed cookie a phone gets. Done with a
  //    raw fetch because we need the Set-Cookie header, not just the timing.
  const t0 = performance.now();
  let cookie = "";
  try {
    const initRes = await fetch(`${baseUrl}/api/session/init`, { method: "POST" });
    cookie = (initRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("tr1via_device=")) ?? "";
    await initRes.text().catch(() => {});
    stats.samples.push({ endpoint: "POST /session/init", ms: performance.now() - t0, ok: Boolean(cookie) });
  } catch {
    stats.samples.push({ endpoint: "POST /session/init", ms: performance.now() - t0, ok: false });
  }
  if (!cookie) { stats.failedOnboard++; return; }
  const auth = { cookie, "content-type": "application/json" };

  // 2) Join the night — a real players row, visible in the roster.
  const joined = await timedFetch(stats, "POST /players", `${baseUrl}/api/players`, {
    method: "POST", headers: auth, body: JSON.stringify({ nightId, displayName: name }),
  });
  const playerId = joined.json?.player?.id ?? "";
  if (!playerId) { stats.failedOnboard++; return; }
  stats.joinedNight++;

  const snapUrl = `${baseUrl}/api/room/${code}/snapshot`;
  const heartbeatUrl = `${baseUrl}/api/players/${playerId}/heartbeat`;
  const answeredQuestions = new Set();
  const joinedGames = new Set();
  const plannedFor = new Map(); // questionId -> { atMs, slot, skip }
  const deadline = performance.now() + seconds * 1000;
  let tick = 0;

  await sleep(Math.random() * POLL_MS); // de-sync arrival, like real phones

  while (performance.now() < deadline && !shared.stop) {
    tick++;
    const snap = await timedFetch(stats, "GET /room/:code/snapshot", snapUrl, {
      method: "GET", headers: { cookie },
    });
    const s = snap.json;

    if (s) {
      // 3) Opt into whichever game is live — exactly what the "Join Game 2"
      //    button does between halves.
      const liveGame = (s.games ?? []).find((g) => g.state === "live");
      if (liveGame && !joinedGames.has(liveGame.game_no)) {
        const res = await timedFetch(stats, "POST /players/:id/join-game", `${baseUrl}/api/players/${playerId}/join-game`, {
          method: "POST", headers: auth, body: JSON.stringify({ gameNo: liveGame.game_no }),
        });
        if (res.ok) { joinedGames.add(liveGame.game_no); stats.gameJoins++; }
      }

      // 4) Answer the live question on a human delay.
      const q = s.currentQuestion;
      const isLive = q && q.playedAt && !q.finishedAt;
      if (isLive && !answeredQuestions.has(q.id)) {
        if (!plannedFor.has(q.id)) {
          plannedFor.set(q.id, {
            atMs: new Date(q.playedAt).getTime() + humanDelayMs(),
            slot: 1 + Math.floor(Math.random() * 4), // a guess — see header
            skip: Math.random() < SKIP_RATE,
          });
        }
        const plan = plannedFor.get(q.id);
        if (!plan.skip && Date.now() >= plan.atMs) {
          const live = s.live ?? null;
          const resilient = live?.play && live.play.questionId === q.id && live.runId;
          let res;
          if (resilient) {
            // Authoritative engine: opaque play/run/submission tuple.
            res = await timedFetch(stats, "POST /answers", `${baseUrl}/api/answers`, {
              method: "POST", headers: auth,
              body: JSON.stringify({
                playId: live.play.playId, runId: live.runId,
                submissionId: randomUUID(), slotChosen: plan.slot,
              }),
            });
          } else {
            // Legacy engine: question + the player's OWN scramble (anti-tamper).
            const scramble = s.questionScrambles?.[q.id];
            if (!scramble) { answeredQuestions.add(q.id); stats.noScramble++; continue; }
            res = await timedFetch(stats, "POST /answers", `${baseUrl}/api/answers`, {
              method: "POST", headers: auth,
              body: JSON.stringify({ questionId: q.id, slotChosen: plan.slot, scramble }),
            });
          }
          answeredQuestions.add(q.id);
          if (res.ok) {
            stats.answers++;
            shared.lockedIn.set(q.id, (shared.lockedIn.get(q.id) ?? 0) + 1);
          } else {
            stats.answerErrors++;
            stats.answerErrorStatuses.set(res.status, (stats.answerErrorStatuses.get(res.status) ?? 0) + 1);
          }
        }
      }

      // Stop early once the night is genuinely over.
      const games = s.games ?? [];
      if (games.length > 0 && games.every((g) => g.state === "done")) shared.stop = true;
    }

    if (tick % HEARTBEAT_EVERY_TICKS === 0) {
      await timedFetch(stats, "POST /players/:id/heartbeat", heartbeatUrl, { method: "POST", headers: { cookie } });
    }
    await sleep(POLL_MS * (0.75 + Math.random() * 0.5));
  }
}

// ---- stats ----------------------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function report(args, stats, wallSeconds) {
  const byEndpoint = new Map();
  for (const s of stats.samples) {
    if (!byEndpoint.has(s.endpoint)) byEndpoint.set(s.endpoint, []);
    byEndpoint.get(s.endpoint).push(s);
  }
  const all = stats.samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = stats.samples.filter((s) => !s.ok).length;
  const stalls = stats.samples.filter((s) => s.ms >= STALL_MS).length;

  console.log(`\n  venue-players — ${args.players} virtual humans → ${args.baseUrl}  (room ${args.code})`);
  console.log(`  wall ${wallSeconds.toFixed(1)}s · ${stats.samples.length} requests\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`  ${pad("endpoint", 30)}${padL("n", 6)}${padL("p50", 8)}${padL("p95", 8)}${padL("max", 9)}${padL("err", 6)}${padL("froze", 7)}`);
  console.log(`  ${"-".repeat(74)}`);
  for (const [endpoint, list] of [...byEndpoint].sort((a, b) => b[1].length - a[1].length)) {
    const lat = list.map((s) => s.ms).sort((x, y) => x - y);
    console.log(
      `  ${pad(endpoint, 30)}${padL(list.length, 6)}${padL(Math.round(percentile(lat, 50)) + "ms", 8)}` +
      `${padL(Math.round(percentile(lat, 95)) + "ms", 8)}${padL(Math.round(lat[lat.length - 1] ?? 0) + "ms", 9)}` +
      `${padL(list.filter((s) => !s.ok).length, 6)}${padL(list.filter((s) => s.ms >= STALL_MS).length, 7)}`,
    );
  }
  console.log(`  ${"-".repeat(74)}`);
  console.log(`\n  players joined night ....... ${stats.joinedNight}/${args.players}`);
  console.log(`  game opt-ins .............. ${stats.gameJoins}`);
  console.log(`  answers locked in ......... ${stats.answers}`);
  if (stats.answerErrors) {
    const codes = [...stats.answerErrorStatuses].map(([k, v]) => `${k}×${v}`).join(", ");
    console.log(`  answer REJECTIONS ......... ${stats.answerErrors}  (${codes})`);
  }
  if (stats.failedOnboard) console.log(`  failed to onboard ......... ${stats.failedOnboard}`);
  if (stats.noScramble) console.log(`  missing scramble .......... ${stats.noScramble}`);
  console.log(`  overall p95 ............... ${Math.round(percentile(all, 95))}ms`);
  console.log(`  frozen requests (≥5s) ..... ${stalls}`);
  console.log(`  errors .................... ${errors}\n`);

  const pass = stats.joinedNight === args.players && stalls === 0 && stats.answerErrors === 0;
  console.log(pass
    ? "  ✅ every virtual player joined, played, and locked in cleanly.\n"
    : "  ⚠️  see the counters above — something did not behave like a real player.\n");
  return pass;
}

// ---- self-test ------------------------------------------------------------
// Stands up a fake room that speaks just enough of the real API to prove the
// player brain works: onboards, joins the game, waits out a human delay, and
// submits exactly one answer per live question with its own scramble.
async function selfTest() {
  console.log("\n  SELF-TEST — proving virtual players actually play (no app needed)\n");
  let answersReceived = 0;
  let joinsReceived = 0;
  const answeredBy = new Set();
  const playedAt = new Date().toISOString();
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const url = req.url ?? "";
      const send = (code, obj, headers = {}) => {
        res.writeHead(code, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(obj ?? {}));
      };
      if (url.startsWith("/api/session/init")) {
        return send(200, {}, { "set-cookie": `tr1via_device=dev-${Math.random().toString(36).slice(2)}; Path=/` });
      }
      if (url === "/api/players") return send(200, { player: { id: randomUUID() } });
      if (url.includes("/join-game")) { joinsReceived++; return send(200, {}); }
      if (url.includes("/heartbeat")) return send(200, {});
      if (url === "/api/answers") {
        const parsed = JSON.parse(body || "{}");
        // A real player must send its own 4-slot scramble on the legacy path.
        if (!Array.isArray(parsed.scramble) || parsed.scramble.length !== 4) return send(400, { error: "bad scramble" });
        if (!(parsed.slotChosen >= 1 && parsed.slotChosen <= 4)) return send(400, { error: "bad slot" });
        const key = req.headers.cookie ?? "";
        if (answeredBy.has(key)) return send(409, { error: "double answer" });
        answeredBy.add(key);
        answersReceived++;
        return send(204, {});
      }
      if (url.includes("/snapshot")) {
        return send(200, {
          games: [{ id: "g1", game_no: 1, state: "live" }],
          currentQuestion: { id: "11111111-1111-1111-1111-111111111111", playedAt, finishedAt: null },
          questionScrambles: { "11111111-1111-1111-1111-111111111111": [2, 0, 3, 1] },
          live: null,
        });
      }
      return send(404, {});
    });
  });
  const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

  const args = { baseUrl: `http://127.0.0.1:${port}`, nightId: randomUUID(), code: "SELFTEST", players: 12, seconds: 22 };
  const stats = newStats();
  const shared = { stop: false, lockedIn: new Map() };
  const started = performance.now();
  await Promise.all(Array.from({ length: args.players }, (_, ix) =>
    runPlayer({ ...args, ix, stats, shared })));
  report(args, stats, (performance.now() - started) / 1000);
  server.close();

  const wantAnswers = Math.floor(args.players * (1 - SKIP_RATE) * 0.7); // allow for skips + slow draws
  const ok = stats.joinedNight === args.players && joinsReceived === args.players && answersReceived >= wantAnswers;
  console.log(`  joined=${stats.joinedNight}/${args.players}  game-joins=${joinsReceived}  answers=${answersReceived} (want ≥${wantAnswers}, one per player max)`);
  console.log(ok
    ? "  ✅ SELF-TEST PASSED — they onboard, opt in, and each lock in exactly one answer.\n"
    : "  ❌ SELF-TEST FAILED — the virtual players are not behaving like players.\n");
  process.exit(ok ? 0 : 1);
}

function newStats() {
  return {
    samples: [], joinedNight: 0, gameJoins: 0, answers: 0,
    answerErrors: 0, answerErrorStatuses: new Map(), failedOnboard: 0, noScramble: 0,
  };
}

// ---- main -----------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  await selfTest();
} else {
  if (!args.nightId || !args.code) {
    console.error("error: --night-id <uuid> and --code <ROOM_CODE> are both required (or use --self-test)");
    process.exit(2);
  }
  const stats = newStats();
  const shared = { stop: false, lockedIn: new Map() };
  const started = performance.now();
  const ticker = args.quiet ? null : setInterval(() => {
    const total = [...shared.lockedIn.values()].reduce((a, b) => a + b, 0);
    process.stdout.write(`\r  ${stats.joinedNight}/${args.players} in the room · ${total} lock-ins · ${stats.samples.length} requests   `);
  }, 1000);
  await Promise.all(Array.from({ length: args.players }, (_, ix) =>
    runPlayer({ ...args, ix, stats, shared })));
  if (ticker) { clearInterval(ticker); process.stdout.write("\r" + " ".repeat(78) + "\r"); }
  const pass = report(args, stats, (performance.now() - started) / 1000);
  process.exit(pass ? 0 : 1);
}
