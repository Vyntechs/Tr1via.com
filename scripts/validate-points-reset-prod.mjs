// Points-reset validation driver. Proves that scores RESET between game 1 and
// game 2 of a night — the invariant the player "Between Games" screen leans on
// ("Game 2 starts fresh — everyone back to zero"). Read-only against prod
// Supabase; drives nothing, so it's safe to run anytime.
//
// It inspects the production `game_scores` VIEW (the exact thing the phone and
// TV read) plus the raw `answers`, and asserts:
//   A. Each game's per-player `game_scores.score` reflects ONLY that game's
//      answers — i.e. the view is scoped per game_id, not cumulative.
//   B. No carryover: a player who scored in game 1 but answered nothing in
//      game 2 shows 0 for game 2 (the headline "back to zero" guarantee).
//   C. The night total per player = game1 + game2 (the running leaderboard the
//      finale sums is exactly the two per-game scores added).
//
// Usage:
//   NIGHT_ID=<uuid> node --env-file=.env.local scripts/validate-points-reset-prod.mjs
//   # or, after a kept full-flow run, auto-discover the latest driver night:
//   SMOKE_KEEP_NIGHT=1 SMOKE_THEME_SINGLE=may node --env-file=.env.local scripts/full-flow-prod.mjs
//   node --env-file=.env.local scripts/validate-points-reset-prod.mjs
//
// Exit 0 = green (points reset correctly). Exit 1 = an assertion failed; the
// printout names the failing player + the expected vs actual numbers.

import { createClient } from "@supabase/supabase-js";

const DRIVER_VENUE = "Full Flow Driver"; // venue stamped by full-flow-prod.mjs

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supaUrl || !supaKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(supaUrl, supaKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90 };
const c = (s, col) => `\x1b[${codes[col]}m${s}\x1b[0m`;
const pass = (s) => console.log(`  ${c("✓", "green")} ${s}`);
const fail = (s) => console.log(`  ${c("✗", "red")} ${s}`);
const step = (s) => console.log(`\n${c("▸", "cyan")} ${s}`);
const note = (s) => console.log(`  ${c("·", "gray")} ${s}`);

// Resolve which night to inspect: explicit NIGHT_ID wins; otherwise the most
// recent "Full Flow Driver" night that has at least 2 games (so we never touch
// a real customer's night — those carry the venue's actual name).
async function resolveNightId() {
  if (process.env.NIGHT_ID) {
    note(`using NIGHT_ID=${process.env.NIGHT_ID}`);
    return process.env.NIGHT_ID;
  }
  const { data: nights, error } = await admin
    .from("nights")
    .select("id, created_at, venue_name, room_code")
    .eq("venue_name", DRIVER_VENUE)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`night lookup failed: ${error.message}`);
  for (const n of nights ?? []) {
    const { data: games } = await admin
      .from("games")
      .select("id")
      .eq("night_id", n.id);
    if ((games?.length ?? 0) >= 2) {
      note(`auto-discovered driver night ${n.id} (code ${n.room_code}, ${n.created_at})`);
      return n.id;
    }
  }
  throw new Error(
    `no "${DRIVER_VENUE}" night with 2 games found — run full-flow with SMOKE_KEEP_NIGHT=1 first, or pass NIGHT_ID`,
  );
}

async function main() {
  console.log(`\n${c("═══ TR1VIA points-reset validator (read-only) ═══", "cyan")}`);

  const nightId = await resolveNightId();

  step("1. load games + picked questions + scores");
  const { data: games, error: gErr } = await admin
    .from("games")
    .select("id, game_no, state")
    .eq("night_id", nightId)
    .order("game_no", { ascending: true });
  if (gErr) throw new Error(`games: ${gErr.message}`);
  const g1 = games?.find((g) => g.game_no === 1);
  const g2 = games?.find((g) => g.game_no === 2);
  if (!g1 || !g2) {
    throw new Error(`expected 2 games (game_no 1 & 2), got [${(games ?? []).map((g) => g.game_no).join(", ")}]`);
  }
  note(`game 1 ${g1.id.slice(0, 8)}… (${g1.state}) · game 2 ${g2.id.slice(0, 8)}… (${g2.state})`);

  // categories → which game each question belongs to
  const { data: cats } = await admin
    .from("categories")
    .select("id, game_id")
    .in("game_id", [g1.id, g2.id]);
  const catGame = new Map((cats ?? []).map((cat) => [cat.id, cat.game_id]));
  const catIds = (cats ?? []).map((cat) => cat.id);

  const { data: questions } = await admin
    .from("questions")
    .select("id, category_id")
    .in("category_id", catIds)
    .eq("is_picked", true);
  const g1QIds = new Set();
  const g2QIds = new Set();
  for (const q of questions ?? []) {
    const gid = catGame.get(q.category_id);
    if (gid === g1.id) g1QIds.add(q.id);
    else if (gid === g2.id) g2QIds.add(q.id);
  }
  const allQIds = [...g1QIds, ...g2QIds];
  note(`picked questions: g1=${g1QIds.size}  g2=${g2QIds.size}`);

  // raw answers → per-player, per-game point sums (the ground truth)
  const { data: answers } = await admin
    .from("answers")
    .select("player_id, question_id, awarded_points")
    .in("question_id", allQIds);
  const g1AnsPts = new Map();
  const g2AnsPts = new Map();
  for (const a of answers ?? []) {
    const pts = a.awarded_points ?? 0;
    const bucket = g1QIds.has(a.question_id) ? g1AnsPts : g2AnsPts;
    bucket.set(a.player_id, (bucket.get(a.player_id) ?? 0) + pts);
  }

  // the production VIEW the UI actually reads, scoped per game_id
  const loadScores = async (gid) => {
    const { data } = await admin
      .from("game_scores")
      .select("player_id, display_name, score")
      .eq("game_id", gid);
    return new Map((data ?? []).map((r) => [r.player_id, r]));
  };
  const g1Scores = await loadScores(g1.id);
  const g2Scores = await loadScores(g2.id);
  note(`game_scores rows: g1=${g1Scores.size}  g2=${g2Scores.size}`);

  // Sanity: a true points-reset proof needs BOTH games actually played. Refuse
  // to green on an empty or half-wiped night (e.g. a game that got reset) — that
  // would make the per-game assertions vacuously true for the missing game.
  if ((answers?.length ?? 0) === 0) {
    throw new Error("no answers for this night — nothing to verify (wrong night?)");
  }
  if (g1Scores.size === 0 || g2Scores.size === 0) {
    throw new Error(
      `incomplete night: game_scores g1=${g1Scores.size} g2=${g2Scores.size} — both games must be ` +
        `played to verify reset between them (this night may have been reset/wiped)`,
    );
  }

  const nameFor = (pid) =>
    g1Scores.get(pid)?.display_name ?? g2Scores.get(pid)?.display_name ?? pid.slice(0, 8);
  const allPlayers = new Set([
    ...g1Scores.keys(),
    ...g2Scores.keys(),
    ...g1AnsPts.keys(),
    ...g2AnsPts.keys(),
  ]);

  let failed = 0;

  // ── Assertion A: each game's view score == that game's answer sum ──
  step("2. assert each game's score reflects ONLY that game's answers (per-game scoping)");
  for (const [label, scores, ansPts] of [
    ["game 1", g1Scores, g1AnsPts],
    ["game 2", g2Scores, g2AnsPts],
  ]) {
    for (const [pid, row] of scores) {
      const expected = ansPts.get(pid) ?? 0;
      if (row.score !== expected) {
        fail(`${label}: ${nameFor(pid)} view score=${row.score} but ${label} answers sum to ${expected}`);
        failed++;
      }
    }
  }
  if (failed === 0) pass("every game_scores row equals its own game's answer total (no cross-game bleed)");

  // ── Assertion B: no carryover (the headline "back to zero") ──
  step("3. assert no carryover — game-1 scorers with no game-2 answers show 0 in game 2");
  let carryChecks = 0;
  const beforeB = failed;
  for (const pid of allPlayers) {
    const g1score = g1Scores.get(pid)?.score ?? 0;
    const g2answered = (g2AnsPts.get(pid) ?? 0) > 0;
    if (g1score > 0 && !g2answered) {
      carryChecks++;
      const g2score = g2Scores.get(pid)?.score ?? 0;
      if (g2score !== 0) {
        fail(`carryover: ${nameFor(pid)} had g1=${g1score} and no g2 answers, but g2 score=${g2score} (expected 0)`);
        failed++;
      }
    }
  }
  if (failed === beforeB) {
    pass(
      carryChecks > 0
        ? `${carryChecks} game-1 scorer(s) with no game-2 answers all reset to 0`
        : "no game-1-only players to check, but no cross-game bleed found in A either",
    );
  }

  // ── Assertion C: night total == game1 + game2 ──
  step("4. assert night total per player == game1 + game2");
  const beforeC = failed;
  const ranked = [];
  for (const pid of allPlayers) {
    const g1score = g1Scores.get(pid)?.score ?? 0;
    const g2score = g2Scores.get(pid)?.score ?? 0;
    const viewTotal = g1score + g2score;
    const ansTotal = (g1AnsPts.get(pid) ?? 0) + (g2AnsPts.get(pid) ?? 0);
    if (viewTotal !== ansTotal) {
      fail(`${nameFor(pid)}: view total ${viewTotal} (g1=${g1score}+g2=${g2score}) ≠ answer total ${ansTotal}`);
      failed++;
    }
    ranked.push({ name: nameFor(pid), total: viewTotal, g1: g1score, g2: g2score });
  }
  ranked.sort((a, b) => b.total - a.total);
  for (const r of ranked) {
    note(`${String(r.name).padEnd(8)} total=${String(r.total).padStart(5)}  (g1=${String(r.g1).padStart(4)}  g2=${String(r.g2).padStart(4)})`);
  }
  if (failed === beforeC) pass("every player's night total equals game1 + game2 (cumulative = sum of two resets)");

  console.log("");
  if (failed > 0) {
    console.log(`${c("═══ POINTS-RESET RED ═══", "red")} (${failed} failed assertion${failed === 1 ? "" : "s"})\n`);
    process.exitCode = 1;
  } else {
    console.log(`${c("═══ POINTS-RESET GREEN ═══", "green")} (scores reset per game; night = g1 + g2)\n`);
  }
}

main().catch((e) => {
  console.error(`\n${c("ERROR", "red")} ${e.message}\n`);
  process.exit(1);
});
