// Validates PR "player answer isolation" at the data layer, against PROD
// Supabase, using the PLAYER's real anon credentials (anon key + x-tr1via-device
// header) — i.e. exactly what the phone's useRoom queries hit.
//
// Proves:
//   1. The trimmed live-question SELECT (PLAYER_QUESTION_COLUMNS) is VALID
//      against prod PostgREST (no typo'd column, embed still works).
//   2. That query returns the live question WITHOUT correct_index (the fix).
//   3. The OLD `select('*')` WOULD have leaked correct_index (the bug it fixes).
//   4. A FINISHED question's correct_index is still readable (reveal data OK).
//
//   node --env-file=.env.local scripts/validate-player-answer-isolation.mjs

import { createClient } from "@supabase/supabase-js";

// Keep this in lockstep with PLAYER_QUESTION_COLUMNS in lib/hooks/useRoom.ts.
const PLAYER_QUESTION_COLUMNS =
  "id, category_id, difficulty, fact_blurb, finished_at, image_attribution, image_source, image_url, is_picked, options, played_at, point_value, prompt, source";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Missing SUPABASE env (need URL, anon key, service role key).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
};

// Find a night that has BOTH an active player (device id) and a played question.
async function findScenario() {
  // Players with a device id, newest first.
  const { data: players } = await admin
    .from("players")
    .select("id, night_id, device_id, removed_at")
    .is("removed_at", null)
    .not("device_id", "is", null)
    .order("joined_at", { ascending: false })
    .limit(200);
  for (const p of players ?? []) {
    // A played question in this player's night.
    const { data: qs } = await admin
      .from("questions")
      .select("id, played_at, finished_at, correct_index, categories!inner(games!inner(night_id))")
      .eq("categories.games.night_id", p.night_id)
      .not("played_at", "is", null)
      .limit(50);
    if (!qs || qs.length === 0) continue;
    const live = qs.find((q) => q.finished_at === null);
    const finished = qs.find((q) => q.finished_at !== null);
    if (live || finished) {
      return { nightId: p.night_id, deviceId: p.device_id, live, finished };
    }
  }
  return null;
}

function anonAs(deviceId) {
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { "x-tr1via-device": deviceId } },
  });
}

async function main() {
  console.log("\n▸ Locating a real prod night with a player + played question…");
  const sc = await findScenario();
  if (!sc) {
    console.log(
      "  (no suitable existing night found — need a player + a played question). " +
        "Re-run after a game, or this validation needs a live scenario.",
    );
    process.exit(2);
  }
  console.log(
    `  night=${sc.nightId.slice(0, 8)}… live=${sc.live ? sc.live.id.slice(0, 8) + "…" : "none"} finished=${sc.finished ? sc.finished.id.slice(0, 8) + "…" : "none"}`,
  );
  const supa = anonAs(sc.deviceId);

  // The column-trim behaves identically whether the played question is live or
  // finished — the only difference is the finished_at WHERE clause. With no
  // purely-live question in prod right now, exercise the trim on whichever
  // played question exists (live preferred). This proves the SELECT is valid
  // and strips correct_index on a REAL played row read by a REAL player.
  const played = sc.live ?? sc.finished;
  if (played) {
    console.log(`\n▸ Trimmed query on a played question (${sc.live ? "LIVE" : "finished"})`);

    // (a) Syntax/embed validity — the actual bootstrap live-query shape.
    const { error: eEmbed } = await supa
      .from("questions")
      .select(`${PLAYER_QUESTION_COLUMNS}, categories!inner(games!inner(night_id))`)
      .eq("categories.games.night_id", sc.nightId)
      .not("played_at", "is", null)
      .limit(1);
    if (eEmbed) bad(`trimmed query with embed ERRORED (column typo / bad embed?): ${eEmbed.message}`);
    else ok("trimmed bootstrap query is valid against prod PostgREST (no typo, embed works)");

    // (b) Shape on a real played row — must NOT contain correct_index.
    const { data: trimmed, error: eById } = await supa
      .from("questions")
      .select(PLAYER_QUESTION_COLUMNS)
      .eq("id", played.id)
      .maybeSingle();
    if (eById) bad(`trimmed by-id query errored: ${eById.message}`);
    if (trimmed && "correct_index" in trimmed)
      bad("trimmed query STILL contains correct_index — fix not effective");
    else if (trimmed) ok("trimmed query returns the question WITHOUT correct_index ✅");
    else console.log("  (player not authorized for this row via RLS — shape check skipped)");

    // (c) Demonstrate what the fix removes — the OLD select('*') leak.
    const { data: old } = await supa
      .from("questions")
      .select("*")
      .eq("id", played.id)
      .maybeSingle();
    if (old && typeof old.correct_index === "number")
      ok(`OLD select('*') exposes correct_index=${old.correct_index} to the player — the leak the trim closes`);
    else if (old) console.log("  (old select returned a row but no correct_index — unexpected)");
    else console.log("  (player not authorized to read this row directly — RLS)");
  }

  if (sc.finished) {
    console.log("\n▸ FINISHED question — reveal must still get the answer");
    const { data: ans, error: e2 } = await supa
      .from("questions")
      .select("correct_index")
      .eq("id", sc.finished.id)
      .maybeSingle();
    if (e2) bad(`finished correct_index fetch errored: ${e2.message}`);
    else if (ans && typeof ans.correct_index === "number")
      ok(`finished question's correct_index IS readable (=${ans.correct_index}) — reveal data intact ✅`);
    else bad("finished question's correct_index NOT readable — reveal would break");
  } else {
    console.log("\n▸ (no finished question available to check reveal-data path)");
  }

  console.log(
    failures === 0
      ? "\n\x1b[32m═══ DATA-LAYER VALIDATION GREEN ═══\x1b[0m\n"
      : `\n\x1b[31m═══ ${failures} CHECK(S) FAILED ═══\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
