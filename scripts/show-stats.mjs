#!/usr/bin/env node
// Read-only show statistics for real TR1VIA game nights.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   STATS_DATES=2026-10-28,2026-10-21 node scripts/show-stats.mjs
//
// Selects only: no inserts, updates, deletes or RPC calls. Writes
// <STATS_OUT>/stats.json (full detail, includes player first names) and
// <STATS_OUT>/summary.txt. Prints one summary line with counts only.
// Dates are Wednesdays in Central time; a night belongs to a date when it was
// created, scheduled or opened between local midnight and 6am the next day.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("show-stats: missing Supabase env");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const DATES = (process.env.STATS_DATES ?? "2026-10-28,2026-10-21,2026-10-14,2026-10-07")
  .split(",").map((d) => d.trim()).filter(Boolean);
const OUT = process.env.STATS_OUT ?? "show-stats";
const TEST_RE = /full[\s_-]*flow|smoke|test|validate|qa\b|probe|bench|e2e|robot|demo/i;

const errors = [];
const tz = (t) => t ? new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false }) : null;
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const ms = (t) => (t ? new Date(t).getTime() : null);

async function safe(label, fn, fallback = null) {
  try { return await fn(); } catch (e) { errors.push(`${label}: ${e?.message ?? e}`); return fallback; }
}
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function byIds(table, cols, col, ids, mod = (q) => q) {
  const out = [];
  const uniq = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100);
    out.push(...(await fetchAll(() => mod(sb.from(table).select(cols).in(col, chunk)))));
  }
  return out;
}
const countBy = (rows, keyFn) => {
  const m = {};
  for (const r of rows) { const k = keyFn(r); m[k] = (m[k] ?? 0) + 1; }
  return m;
};

const NIGHT_COLS = "id, host_id, venue_name, room_code, theme_key, scheduled_at, opened_at, closed_at, created_at, answer_engine, current_run_id, is_locked";

async function candidates(date) {
  const start = new Date(`${date}T05:00:00Z`); // midnight CDT
  const end = new Date(start.getTime() + 30 * 3600 * 1000); // 6am CDT next day
  const found = new Map();
  for (const col of ["created_at", "scheduled_at", "opened_at"]) {
    const rows = await fetchAll(() => sb.from("nights").select(NIGHT_COLS)
      .gte(col, start.toISOString()).lt(col, end.toISOString()).order("id"));
    for (const r of rows) found.set(r.id, r);
  }
  return [...found.values()];
}

async function nightStats(n, hostName) {
  const nightErrors = [];
  const s = async (label, fn, fb = null) => {
    try { return await fn(); } catch (e) { nightErrors.push(`${label}: ${e?.message ?? e}`); return fb; }
  };
  const runs = await s("runs", () => fetchAll(() => sb.from("live_night_runs").select("run_id, answer_engine, started_at, ended_at").eq("night_id", n.id).order("started_at")), []);
  const games = (await s("games", () => fetchAll(() => sb.from("games").select("id, game_no, state, started_at, ended_at, category_count, question_count").eq("night_id", n.id).order("game_no")), [])) ?? [];
  const gameIds = games.map((g) => g.id);
  const gameNo = Object.fromEntries(games.map((g) => [g.id, g.game_no]));
  const cats = await s("categories", () => byIds("categories", "id, game_id, name, topic, position, state", "game_id", gameIds), []);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const questions = await s("questions", () => byIds("questions", "id, category_id, point_value, prompt, options, correct_index, difficulty, source, is_picked, played_at, finished_at", "category_id", cats.map((c) => c.id), (q) => q.eq("is_picked", true).order("id")), []);
  const qById = Object.fromEntries(questions.map((q) => [q.id, q]));
  const players = await s("players", () => fetchAll(() => sb.from("players").select("id, display_name, joined_at, last_seen_at, removed_at, can_answer, app_switch_total_seconds").eq("night_id", n.id).order("joined_at")), []);
  const pById = Object.fromEntries(players.map((p) => [p.id, p]));
  const parts = await s("participations", () => byIds("game_participations", "game_id, player_id, joined_at", "game_id", gameIds, (q) => q.order("id")), []);
  const scores = await s("game_scores", () => byIds("game_scores", "game_id, player_id, display_name, score, correct_count, answered_count, fastest_correct_ms", "game_id", gameIds), []);
  const adjustments = await s("adjustments", () => byIds("adjustments", "game_id, player_id, delta, reason, created_at", "game_id", gameIds), []);
  const suggestions = await s("topic_suggestions", () => byIds("topic_suggestions", "player_id, text, created_at", "player_id", players.map((p) => p.id)), []);

  // Answers from both engines; the night's engine decides which one counts.
  const legacyAnswers = await s("answers", () => byIds("answers", "id, question_id, player_id, chosen_index, ms_to_lock, is_correct, awarded_points, locked_at", "question_id", questions.map((q) => q.id), (q) => q.order("id")), []);
  const plays = await s("question_plays", () => fetchAll(() => sb.from("question_plays").select("id, run_id, game_id, question_id, status, opened_at, resolved_at, resolution_reason, eligible_count, confirmed_count").eq("night_id", n.id).order("opened_at")), []);
  const playIds = plays.map((p) => p.id);
  const elig = await s("eligibility", () => byIds("question_play_eligibility", "play_id, player_id", "play_id", playIds, (q) => q.order("play_id").order("player_id")), []);
  const qpa = await s("play_answers", () => byIds("question_play_answers", "play_id, player_id, canonical_index, ms_to_lock, is_correct, awarded_points, locked_at", "play_id", playIds, (q) => q.order("play_id").order("player_id")), []);

  const resilient = n.answer_engine === "resilient_v1";
  const currentPlays = plays.filter((p) => p.run_id === n.current_run_id);
  const resolvedPlays = currentPlays.filter((p) => p.status === "resolved");
  const answerable = (pid) => pById[pid] && pById[pid].can_answer !== false;

  // Per-question facts.
  const perQ = [];
  for (const q of questions) {
    const cat = catById[q.category_id];
    const gid = cat?.game_id;
    let eligible = [], answers = [];
    let play = null;
    if (resilient) {
      play = resolvedPlays.find((p) => p.question_id === q.id) ?? null;
      if (play) {
        eligible = elig.filter((e) => e.play_id === play.id && answerable(e.player_id)).map((e) => e.player_id);
        answers = qpa.filter((a) => a.play_id === play.id && answerable(a.player_id))
          .map((a) => ({ ...a, chosen_index: a.canonical_index }));
      }
    } else if (q.played_at) {
      const t = ms(q.played_at);
      eligible = parts.filter((pt) => pt.game_id === gid && ms(pt.joined_at) <= t && answerable(pt.player_id)
        && (!pById[pt.player_id]?.removed_at || ms(pById[pt.player_id].removed_at) > t)).map((pt) => pt.player_id);
      answers = legacyAnswers.filter((a) => a.question_id === q.id && answerable(a.player_id));
    }
    const playedAt = resilient ? play?.opened_at : q.played_at;
    const correct = answers.filter((a) => a.is_correct === true).length;
    perQ.push({
      id: q.id, game_no: gameNo[gid], category: cat?.name, points: q.point_value, prompt: q.prompt,
      options: q.options, correct_index: q.correct_index, difficulty: q.difficulty, source: q.source,
      played: Boolean(playedAt), played_at: tz(playedAt), finished_at: tz(resilient ? play?.resolved_at : q.finished_at),
      resolution: play?.resolution_reason ?? null,
      eligible: eligible.length, answered: answers.length, correct,
      pct_correct_of_answered: pct(correct, answers.length), answer_rate: pct(answers.length, eligible.length),
      avg_ms: avg(answers.map((a) => a.ms_to_lock).filter((x) => x != null)),
      unresolved_answers: answers.filter((a) => a.is_correct == null).length,
      choice_counts: [0, 1, 2, 3].map((i) => answers.filter((a) => a.chosen_index === i).length),
      _playedMs: ms(playedAt), _answers: answers,
    });
  }

  // Per game.
  const gameOut = games.map((g) => {
    const qs = perQ.filter((q) => q.game_no === g.game_no);
    const played = qs.filter((q) => q.played);
    const ans = played.flatMap((q) => q._answers);
    const sc = scores.filter((r) => r.game_id === g.id)
      .sort((a, b) => b.score - a.score || (a.fastest_correct_ms ?? 1e12) - (b.fastest_correct_ms ?? 1e12));
    const ranked = played.filter((q) => q.answered >= 3);
    const byPct = [...ranked].sort((a, b) => a.pct_correct_of_answered - b.pct_correct_of_answered);
    const brief = (q) => q && ({ category: q.category, points: q.points, prompt: q.prompt, answer: q.options?.[q.correct_index], pct_correct: q.pct_correct_of_answered, answered: q.answered });
    return {
      game_no: g.game_no, state: g.state, started_at: tz(g.started_at), ended_at: tz(g.ended_at),
      minutes: g.started_at && g.ended_at ? Math.round((ms(g.ended_at) - ms(g.started_at)) / 60000) : null,
      participants: parts.filter((p) => p.game_id === g.id).length,
      categories: cats.filter((c) => c.game_id === g.id).sort((a, b) => a.position - b.position).map((c) => ({ name: c.name, topic: c.topic, state: c.state, picked: qs.filter((q) => q.category === c.name).length, played: played.filter((q) => q.category === c.name).length })),
      questions_picked: qs.length, questions_played: played.length,
      answers: ans.length, possible: played.reduce((s2, q) => s2 + q.eligible, 0),
      answer_rate: pct(ans.length, played.reduce((s2, q) => s2 + q.eligible, 0)),
      pct_correct_all_answers: pct(ans.filter((a) => a.is_correct).length, ans.length),
      pct_correct_mean_of_questions: played.length ? Math.round(10 * played.filter((q) => q.answered).reduce((s2, q) => s2 + q.pct_correct_of_answered, 0) / Math.max(1, played.filter((q) => q.answered).length)) / 10 : null,
      avg_ms_to_lock: avg(ans.map((a) => a.ms_to_lock).filter((x) => x != null)),
      hardest: brief(byPct[0]), easiest: brief(byPct[byPct.length - 1]),
      standings: sc.map((r, i) => ({ rank: i + 1, name: r.display_name, score: r.score, correct: r.correct_count, answered: r.answered_count, fastest_correct_ms: r.fastest_correct_ms })),
      no_answer_questions: played.filter((q) => q.answered === 0).map((q) => `${q.category} ${q.points}`),
      unplayed_picked: qs.filter((q) => !q.played).map((q) => `${q.category} ${q.points}`),
    };
  });

  // Night-level people flow.
  const g1 = games.find((g) => g.game_no === 1), g2 = games.find((g) => g.game_no === 2);
  const inG = (g) => new Set(parts.filter((p) => g && p.game_id === g.id).map((p) => p.player_id));
  const g1set = inG(g1), g2set = inG(g2);
  const allAnswers = perQ.flatMap((q) => q._answers.map((a) => ({ ...a, _t: q._playedMs })));
  const lastPlayed = Math.max(0, ...perQ.filter((q) => q._playedMs).map((q) => q._playedMs));
  const firstPlayed = Math.min(...perQ.filter((q) => q._playedMs).map((q) => q._playedMs));
  const playedCount = perQ.filter((q) => q.played).length;
  const playerRows = players.map((p) => {
    const mine = allAnswers.filter((a) => a.player_id === p.id);
    const lastT = mine.length ? Math.max(...mine.map((a) => a._t)) : null;
    const firstT = mine.length ? Math.min(...mine.map((a) => a._t)) : null;
    return {
      name: p.display_name, can_answer: p.can_answer, joined_at: tz(p.joined_at), last_seen_at: tz(p.last_seen_at),
      removed_at: tz(p.removed_at), in_game1: g1set.has(p.id), in_game2: g2set.has(p.id),
      answers: mine.length, correct: mine.filter((a) => a.is_correct).length,
      first_answer_q_at: tz(firstT), last_answer_q_at: tz(lastT),
      late: g1?.started_at ? ms(p.joined_at) > ms(g1.started_at) : false,
      dropped: Boolean(lastT && lastPlayed && lastPlayed - lastT > 30 * 60000),
      app_switch_seconds: p.app_switch_total_seconds,
    };
  });
  const totals = {};
  for (const r of scores) {
    totals[r.player_id] ??= { name: r.display_name, total: 0, games: 0 };
    totals[r.player_id].total += r.score; totals[r.player_id].games += 1;
  }

  const diagAns = await s("diag_answer_events", () => fetchAll(() => sb.from("diag_answer_events").select("outcome, reason, http_status, engine, ms_after_open").eq("night_id", n.id).order("id")), []);
  const diagAct = await s("diag_server_actions", () => fetchAll(() => sb.from("diag_server_actions").select("action, actor, http_status, outcome, reason, total_ms, broadcast_ok").eq("night_id", n.id).order("id")), []);
  const diagDev = await s("diag_device_events", () => fetchAll(() => sb.from("diag_device_events").select("surface, kind").eq("night_id", n.id).order("id")), []);

  const oddities = [];
  if (!n.closed_at) oddities.push("night never closed (closed_at empty)");
  for (const g of games) if (g.state !== "done") oddities.push(`game ${g.game_no} state is '${g.state}', not done`);
  if (runs.length > 1) oddities.push(`${runs.length} runs: the night was reset ${runs.length - 1} time(s)`);
  const undone = currentPlays.filter((p) => p.status === "undone").length;
  if (undone) oddities.push(`${undone} question play(s) undone by host`);
  const stuck = currentPlays.filter((p) => !["resolved", "undone"].includes(p.status));
  if (stuck.length) oddities.push(`${stuck.length} question play(s) left open (${stuck.map((p) => p.status).join(",")})`);
  if (!resilient) {
    const unfinished = questions.filter((q) => q.played_at && !q.finished_at).length;
    if (unfinished) oddities.push(`${unfinished} played question(s) never finished`);
  }
  const unres = perQ.reduce((s2, q) => s2 + q.unresolved_answers, 0);
  if (unres) oddities.push(`${unres} answer(s) never marked right/wrong`);
  for (const g of gameOut) {
    if (g.no_answer_questions.length) oddities.push(`game ${g.game_no}: ${g.no_answer_questions.length} played question(s) with zero answers`);
    if (g.unplayed_picked.length) oddities.push(`game ${g.game_no}: ${g.unplayed_picked.length} picked question(s) never played`);
  }
  const badActs = diagAct.filter((a) => a.http_status >= 400 || /error|fail/i.test(a.outcome));
  if (badActs.length) oddities.push(`${badActs.length} host/timer action(s) failed`);
  const badAns = diagAns.filter((a) => a.outcome !== "saved");
  if (badAns.length) oddities.push(`${badAns.length} answer tap(s) not saved (see diag)`);
  if (adjustments.length) oddities.push(`${adjustments.length} manual score adjustment(s)`);

  return {
    night: { id: n.id, venue: n.venue_name, room: n.room_code, host: hostName, theme: n.theme_key, engine: n.answer_engine,
      created_at: tz(n.created_at), scheduled_at: tz(n.scheduled_at), opened_at: tz(n.opened_at), closed_at: tz(n.closed_at),
      first_question_at: tz(Number.isFinite(firstPlayed) ? firstPlayed : null), last_question_at: tz(lastPlayed || null) },
    runs: runs.map((r) => ({ ...r, started_at: tz(r.started_at), ended_at: tz(r.ended_at) })),
    headline: {
      players_joined: players.length, players_answering: players.filter((p) => p.can_answer !== false).length,
      score_only_names: players.filter((p) => p.can_answer === false).length,
      games: games.length, questions_played: playedCount,
      latecomers: playerRows.filter((p) => p.late).length, game1_only: playerRows.filter((p) => p.in_game1 && !p.in_game2).length,
      game2_only: playerRows.filter((p) => !p.in_game1 && p.in_game2).length, removed: playerRows.filter((p) => p.removed_at).length,
      dropped_30min_early: playerRows.filter((p) => p.dropped).length, never_answered: playerRows.filter((p) => p.answers === 0).length,
    },
    games: gameOut,
    night_total_computed: Object.values(totals).sort((a, b) => b.total - a.total),
    players: playerRows,
    questions: perQ.map(({ _playedMs, _answers, ...rest }) => rest),
    adjustments, topic_suggestions: suggestions.map((x) => ({ text: x.text, at: tz(x.created_at) })),
    diag: {
      answer_taps: countBy(diagAns, (a) => `${a.outcome}/${a.reason}/${a.http_status}`),
      server_actions: countBy(diagAct, (a) => `${a.action}/${a.outcome}/${a.http_status}`),
      server_action_slow_over_2s: diagAct.filter((a) => a.total_ms > 2000).length,
      broadcast_failed: diagAct.filter((a) => a.broadcast_ok === false).length,
      device_events: countBy(diagDev, (d) => `${d.surface}/${d.kind}`),
    },
    oddities, errors: nightErrors,
  };
}

const hostNames = {};
async function hostName(id) {
  if (!(id in hostNames)) {
    const { data } = await sb.from("hosts").select("display_name").eq("id", id).maybeSingle();
    hostNames[id] = data?.display_name ?? null;
  }
  return hostNames[id];
}

const result = { generated_at: new Date().toISOString(), dates: {} };
for (const date of DATES) {
  const cands = (await safe(`candidates ${date}`, () => candidates(date), [])) ?? [];
  const list = [];
  for (const n of cands) {
    const host = await safe("host", () => hostName(n.host_id));
    const { count } = await sb.from("players").select("id", { count: "exact", head: true }).eq("night_id", n.id);
    const isTest = TEST_RE.test(n.venue_name ?? "") || TEST_RE.test(host ?? "");
    list.push({ n, host, players: count ?? 0, isTest });
  }
  const kept = list.filter((c) => !c.isTest && c.players > 0);
  const nights = [];
  for (const c of kept) nights.push(await safe(`night ${c.n.room_code}`, () => nightStats(c.n, c.host)));
  result.dates[date] = {
    candidates: list.map((c) => ({ venue: c.n.venue_name, room: c.n.room_code, host: c.host, players: c.players,
      created_at: tz(c.n.created_at), opened_at: tz(c.n.opened_at), closed_at: tz(c.n.closed_at),
      kept: !c.isTest && c.players > 0, why: c.isTest ? "test name" : c.players === 0 ? "no players" : "real" })),
    nights,
  };
}
result.errors = errors;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "stats.json"), JSON.stringify(result, null, 2));

// Short text summary for a quick read.
const lines = [];
for (const [date, d] of Object.entries(result.dates)) {
  lines.push(`== ${date}: ${d.candidates.length} candidate nights, ${d.nights.length} kept`);
  for (const c of d.candidates) lines.push(`  cand ${c.kept ? "KEEP" : "skip"} ${c.venue} | ${c.room} | host ${c.host} | ${c.players}p | created ${c.created_at} | opened ${c.opened_at} | closed ${c.closed_at} | ${c.why}`);
  for (const ns of d.nights) {
    if (!ns) continue;
    lines.push(`  NIGHT ${ns.night.venue} ${ns.night.room} host=${ns.night.host} engine=${ns.night.engine} theme=${ns.night.theme} opened=${ns.night.opened_at} closed=${ns.night.closed_at} q1=${ns.night.first_question_at} qlast=${ns.night.last_question_at}`);
    lines.push(`   headline ${JSON.stringify(ns.headline)}`);
    for (const g of ns.games) {
      lines.push(`   G${g.game_no} state=${g.state} ${g.started_at}→${g.ended_at} (${g.minutes}m) parts=${g.participants} picked=${g.questions_picked} played=${g.questions_played} answers=${g.answers}/${g.possible} rate=${g.answer_rate}% correct=${g.pct_correct_all_answers}% (mean/q ${g.pct_correct_mean_of_questions}%) avgms=${g.avg_ms_to_lock}`);
      lines.push(`    cats: ${g.categories.map((c) => `${c.name} [${c.topic}] ${c.played}/${c.picked}`).join(" ; ")}`);
      lines.push(`    top: ${g.standings.slice(0, 5).map((r) => `${r.rank}.${r.name} ${r.score} (${r.correct}/${r.answered})`).join(" | ")}`);
      lines.push(`    hardest: ${JSON.stringify(g.hardest)}`);
      lines.push(`    easiest: ${JSON.stringify(g.easiest)}`);
      if (g.no_answer_questions.length) lines.push(`    zero-answer: ${g.no_answer_questions.join(", ")}`);
      if (g.unplayed_picked.length) lines.push(`    unplayed: ${g.unplayed_picked.join(", ")}`);
    }
    lines.push(`   night total top5: ${ns.night_total_computed.slice(0, 5).map((t) => `${t.name} ${t.total}`).join(" | ")}`);
    lines.push(`   late: ${ns.players.filter((p) => p.late).map((p) => `${p.name}@${p.joined_at}`).join(", ")}`);
    lines.push(`   g1-only: ${ns.players.filter((p) => p.in_game1 && !p.in_game2).map((p) => `${p.name}(${p.answers}a, last ${p.last_answer_q_at})`).join(", ")}`);
    lines.push(`   dropped: ${ns.players.filter((p) => p.dropped).map((p) => `${p.name}(${p.answers}a, last ${p.last_answer_q_at})`).join(", ")}`);
    lines.push(`   never answered: ${ns.players.filter((p) => p.answers === 0).map((p) => p.name).join(", ")}`);
    lines.push(`   runs: ${ns.runs.length}; oddities: ${ns.oddities.join(" ; ") || "none"}`);
    lines.push(`   diag taps: ${JSON.stringify(ns.diag.answer_taps)}`);
    lines.push(`   diag actions: ${JSON.stringify(ns.diag.server_actions)} slow>2s=${ns.diag.server_action_slow_over_2s} bcastFail=${ns.diag.broadcast_failed}`);
    lines.push(`   suggestions: ${ns.topic_suggestions.map((t) => t.text).join(" | ")}`);
    if (ns.errors.length) lines.push(`   ERRORS: ${ns.errors.join(" ; ")}`);
  }
}
if (errors.length) lines.push(`ERRORS: ${errors.join(" ; ")}`);
fs.writeFileSync(path.join(OUT, "summary.txt"), lines.join("\n") + "\n");

const summary = Object.entries(result.dates).map(([d, v]) =>
  `${d}: ${v.nights.length} night(s), ${v.nights.map((x) => x ? `${x.headline.players_joined}p/${x.headline.games}g` : "err").join("+") || "-"}`).join("; ");
console.log(`show-stats: ${summary}; errors=${errors.length + Object.values(result.dates).flatMap((v) => v.nights).reduce((s2, x) => s2 + (x?.errors.length ?? 0), 0)}`);
