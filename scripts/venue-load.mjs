#!/usr/bin/env node
// venue-load — a 30-player room, simulated.
//
// Why this exists: the show breaks on the weeks a mid-week change ships, because
// a full room is the FIRST thing that ever stress-tests that change — and the
// only full room we had was the venue. This turns "we find out at the venue"
// into "we find out on the laptop." It fires the real player hot-loop (snapshot
// poll + heartbeat + answer) from N concurrent virtual players against a running
// target and reports the latency distribution, with a hard PASS/FAIL on the one
// thing that ruined the July 22 night: requests that freeze for seconds.
//
// It is transport-only load: it needs a running server (local dev or a Vercel
// PREVIEW deploy — never hammer Heather's production during a show) and a seeded
// room code. It does NOT write to or reset any database itself.
//
// Usage:
//   node scripts/venue-load.mjs --base-url http://localhost:3000 --code AB12CD --players 30 --seconds 20
//   node scripts/venue-load.mjs --self-test      # no server needed; proves the harness itself
//
// SLO (the "no frozen clicks" contract):
//   PASS iff  p95 < 1000ms  AND  zero requests slower than STALL_MS (5s)  AND  error rate < 1%.
//   The stall check is the direct guard against the 30s–2min freeze.

import http from "node:http";
import { performance } from "node:perf_hooks";

const STALL_MS = 5000; // a request slower than this is a "freeze" — the July 22 symptom
const REQ_TIMEOUT_MS = 12000;
const SLO = { p95Ms: 1000, maxStalls: 0, errorRatePct: 1 };

// ---- args -----------------------------------------------------------------
function parseArgs(argv) {
  const a = { baseUrl: "http://localhost:3000", code: "", nightId: "", players: 30, seconds: 20, selfTest: false, readsOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--self-test") a.selfTest = true;
    else if (k === "--reads-only") a.readsOnly = true; // only the snapshot poll (between-question load)
    else if (k === "--night-id") a.nightId = argv[++i]; // enables real join handshake
    else if (k === "--base-url") a.baseUrl = argv[++i];
    else if (k === "--code") a.code = argv[++i];
    else if (k === "--players") a.players = Number(argv[++i]);
    else if (k === "--seconds") a.seconds = Number(argv[++i]);
  }
  return a;
}

// ---- stats ----------------------------------------------------------------
function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return 0;
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length));
  return sortedMs[idx];
}

function summarize(samples) {
  // samples: [{ endpoint, ms, ok, timedOut }]
  const byEndpoint = new Map();
  for (const s of samples) {
    if (!byEndpoint.has(s.endpoint)) byEndpoint.set(s.endpoint, []);
    byEndpoint.get(s.endpoint).push(s);
  }
  const rows = [];
  for (const [endpoint, list] of byEndpoint) {
    const latencies = list.map((s) => s.ms).sort((x, y) => x - y);
    const errors = list.filter((s) => !s.ok).length;
    const stalls = list.filter((s) => s.ms >= STALL_MS).length;
    rows.push({
      endpoint,
      n: list.length,
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      max: Math.round(latencies[latencies.length - 1] ?? 0),
      errors,
      stalls,
    });
  }
  const all = samples.map((s) => s.ms).sort((x, y) => x - y);
  const totalErrors = samples.filter((s) => !s.ok).length;
  const totalStalls = samples.filter((s) => s.ms >= STALL_MS).length;
  return {
    rows: rows.sort((a, b) => b.p95 - a.p95),
    total: samples.length,
    p50: Math.round(percentile(all, 50)),
    p95: Math.round(percentile(all, 95)),
    max: Math.round(all[all.length - 1] ?? 0),
    errors: totalErrors,
    stalls: totalStalls,
    errorRatePct: samples.length ? (100 * totalErrors) / samples.length : 0,
  };
}

function verdict(sum) {
  const fails = [];
  if (sum.p95 >= SLO.p95Ms) fails.push(`p95 ${sum.p95}ms ≥ ${SLO.p95Ms}ms`);
  if (sum.stalls > SLO.maxStalls) fails.push(`${sum.stalls} frozen request(s) ≥ ${STALL_MS}ms`);
  if (sum.errorRatePct > SLO.errorRatePct) fails.push(`error rate ${sum.errorRatePct.toFixed(1)}% > ${SLO.errorRatePct}%`);
  return { pass: fails.length === 0, fails };
}

// ---- one timed request ----------------------------------------------------
async function timedFetch(endpoint, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Drain the body so the connection is actually free (matches real clients).
    await res.text().catch(() => {});
    const ms = performance.now() - start;
    return { endpoint, ms, ok: res.ok, timedOut: false };
  } catch {
    const ms = performance.now() - start;
    return { endpoint, ms, ok: false, timedOut: true };
  } finally {
    clearTimeout(timer);
  }
}

// ---- the real player hot-loop ---------------------------------------------
// Each virtual player, for `seconds`, polls the room snapshot on a jittered
// ~1.5s cadence (the live poll), heartbeats every ~5s, and answers occasionally.
// Real onboarding: mint a signed device cookie, then join the night — so this
// virtual player is an authorized room member (the snapshot route requires it).
// Returns the Cookie header to attach to every subsequent request, or "" if the
// handshake wasn't requested/available.
async function onboard(baseUrl, nightId, playerIx) {
  if (!nightId) return "";
  const initRes = await fetch(`${baseUrl}/api/session/init`, { method: "POST" });
  const setCookies = initRes.headers.getSetCookie?.() ?? [];
  const deviceCookie = setCookies
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("tr1via_device="));
  await initRes.text().catch(() => {});
  if (!deviceCookie) return "";
  await fetch(`${baseUrl}/api/players`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ nightId, displayName: `LoadPlayer ${playerIx}` }),
  }).then((r) => r.text()).catch(() => {});
  return deviceCookie;
}

async function runPlayer({ baseUrl, code, nightId, seconds, playerIx, samples, readsOnly }) {
  const deadline = performance.now() + seconds * 1000;
  const snapUrl = `${baseUrl}/api/room/${code}/snapshot`;
  const heartbeatUrl = `${baseUrl}/api/players/vp-${playerIx}/heartbeat`;
  const answersUrl = `${baseUrl}/api/answers`;
  // One-time handshake (not counted in the steady-state samples).
  const cookie = await onboard(baseUrl, nightId, playerIx);
  const auth = cookie ? { cookie } : {};
  let tick = 0;
  // De-sync players so they don't all fire in the same instant (real clients jitter).
  await sleep(Math.random() * 1500);
  while (performance.now() < deadline) {
    tick++;
    samples.push(await timedFetch("GET /room/:code/snapshot", snapUrl, { method: "GET", headers: { ...auth } }));
    if (readsOnly) { await sleep(1500 * (0.75 + Math.random() * 0.5)); continue; }
    if (tick % 3 === 0) {
      samples.push(
        await timedFetch("POST /players/:id/heartbeat", heartbeatUrl, { method: "POST" }),
      );
    }
    if (tick % 7 === 0) {
      samples.push(
        await timedFetch("POST /answers", answersUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerId: `vp-${playerIx}`, questionId: "q", chosenIndex: 1 }),
        }),
      );
    }
    await sleep(1500 * (0.75 + Math.random() * 0.5)); // ~1.1s–1.9s jittered
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadTest({ baseUrl, code, nightId, players, seconds, readsOnly }) {
  const samples = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: players }, (_, i) =>
      runPlayer({ baseUrl, code, nightId, seconds, playerIx: i, samples, readsOnly }),
    ),
  );
  const wallSeconds = (performance.now() - started) / 1000;
  return { samples, wallSeconds };
}

// ---- reporting ------------------------------------------------------------
function report({ baseUrl, code, players, seconds }, { samples, wallSeconds }) {
  const sum = summarize(samples);
  const v = verdict(sum);
  console.log(`\n  venue-load — ${players} players × ${seconds}s → ${baseUrl}  (room ${code || "n/a"})`);
  console.log(`  wall ${wallSeconds.toFixed(1)}s · ${sum.total} requests · ${(sum.total / wallSeconds).toFixed(0)} req/s\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log(`  ${pad("endpoint", 32)}${padL("n", 6)}${padL("p50", 8)}${padL("p95", 8)}${padL("max", 9)}${padL("err", 6)}${padL("froze", 7)}`);
  console.log(`  ${"-".repeat(76)}`);
  for (const r of sum.rows) {
    console.log(
      `  ${pad(r.endpoint, 32)}${padL(r.n, 6)}${padL(r.p50 + "ms", 8)}${padL(r.p95 + "ms", 8)}${padL(r.max + "ms", 9)}${padL(r.errors, 6)}${padL(r.stalls, 7)}`,
    );
  }
  console.log(`  ${"-".repeat(76)}`);
  console.log(`  ${pad("ALL", 32)}${padL(sum.total, 6)}${padL(sum.p50 + "ms", 8)}${padL(sum.p95 + "ms", 8)}${padL(sum.max + "ms", 9)}${padL(sum.errors, 6)}${padL(sum.stalls, 7)}`);
  console.log("");
  if (v.pass) {
    console.log(`  ✅ PASS — the room stayed responsive (p95 ${sum.p95}ms, ${sum.stalls} frozen requests).\n`);
  } else {
    console.log(`  ❌ FAIL — ${v.fails.join("; ")}.`);
    console.log(`     A "frozen request" (≥${STALL_MS}ms) is the July-22 symptom: a click that hangs then lands seconds later.\n`);
  }
  return v.pass;
}

// ---- self-test: prove the harness on a healthy vs. a storming server -------
// Storming server = a bounded worker pool (2 slots) doing 250ms of "work" per
// request. At 30 concurrent players, requests queue and tail latency explodes
// into multiple seconds — exactly the shape of a backend that serializes under
// load. This is the July-22 storm in miniature, and the harness must FAIL it.
function makeServer({ mode }) {
  let inFlight = 0;
  const queue = [];
  const SLOTS = 2;
  const WORK_MS = 250;
  function pump() {
    while (inFlight < SLOTS && queue.length) {
      inFlight++;
      const done = queue.shift();
      setTimeout(() => {
        inFlight--;
        done();
        pump();
      }, WORK_MS);
    }
  }
  const server = http.createServer((req, res) => {
    const finish = () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    };
    if (mode === "healthy") {
      // Plenty of concurrency; ~30ms of work. A well-behaved backend.
      setTimeout(finish, 20 + Math.random() * 40);
    } else {
      // Serialized behind 2 slots → queues under a full room.
      queue.push(finish);
      pump();
    }
  });
  return server;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function selfTest() {
  console.log("\n  SELF-TEST — proving the harness catches a storm (no external server needed)\n");
  const healthy = makeServer({ mode: "healthy" });
  const storm = makeServer({ mode: "storm" });
  const hPort = await listen(healthy);
  const sPort = await listen(storm);
  const opts = { code: "SELFTEST", players: 30, seconds: 6 };

  console.log("  [1/2] healthy backend — expect PASS");
  const hPass = report(
    { ...opts, baseUrl: `http://127.0.0.1:${hPort}` },
    await loadTest({ ...opts, baseUrl: `http://127.0.0.1:${hPort}` }),
  );

  console.log("  [2/2] storming backend (serializes under a full room) — expect FAIL");
  const sPass = report(
    { ...opts, baseUrl: `http://127.0.0.1:${sPort}` },
    await loadTest({ ...opts, baseUrl: `http://127.0.0.1:${sPort}` }),
  );

  healthy.close();
  storm.close();

  const ok = hPass === true && sPass === false;
  console.log(ok
    ? "  ✅ SELF-TEST PASSED — harness passes a healthy room and FAILS a storming one.\n"
    : `  ❌ SELF-TEST FAILED — healthy=${hPass} (want true), storm=${sPass} (want false).\n`);
  process.exit(ok ? 0 : 1);
}

// ---- main -----------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  await selfTest();
} else {
  if (!args.code) {
    console.error("error: --code <ROOM_CODE> is required (seed a room first, or use --self-test)");
    process.exit(2);
  }
  const pass = report(args, await loadTest(args));
  process.exit(pass ? 0 : 1);
}
