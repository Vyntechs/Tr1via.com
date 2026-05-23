// Creates a fully-realized night for a test host. Body: {hostId, scenario?,
// themeKey?, roomCode?, venueName?}. Scenarios:
//   - "happy-path-3-cats-game1": 3 categories of 7 picked questions in game 1
//   - "two-games-ready": same + 1 category in game 2
//   - "empty-night": no categories
// Returns: {nightId, roomCode, game1, game2, categories:[{id,name,position,
// question_ids:[uuid, ...]}]}. question_ids are returned sorted ascending by
// point_value (100 -> 700) so tests can drive a category through reveal one
// question at a time without a separate fetch.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTestModeEnabled } from "@/lib/api/require-test-mode";
import { newRoomCode } from "@/lib/game/room-code";

interface SeedReq {
  hostId: string;
  scenario?: "happy-path-3-cats-game1" | "two-games-ready" | "empty-night";
  themeKey?: string;
  roomCode?: string;
  venueName?: string;
}

export async function POST(req: NextRequest) {
  if (!isTestModeEnabled(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as SeedReq | null;
  if (!body?.hostId) {
    return NextResponse.json({ error: "hostId required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const scenario = body.scenario ?? "happy-path-3-cats-game1";
  const roomCode = body.roomCode ?? newRoomCode();
  const themeKey = body.themeKey ?? "house";
  const venueName = body.venueName ?? "Test Venue";

  const { data: night, error: nightErr } = await admin
    .from("nights")
    .insert({
      host_id: body.hostId,
      venue_name: venueName,
      room_code: roomCode,
      theme_key: themeKey,
      opened_at: new Date().toISOString(),
    })
    .select("id, room_code")
    .single();
  if (nightErr || !night) {
    return NextResponse.json({ error: nightErr?.message ?? "night insert failed" }, { status: 500 });
  }

  const game1State = scenario === "empty-night" ? "draft" : "ready";
  const game2State = scenario === "two-games-ready" ? "ready" : "draft";
  const { data: games, error: gamesErr } = await admin
    .from("games")
    .insert([
      { night_id: night.id, game_no: 1, state: game1State },
      { night_id: night.id, game_no: 2, state: game2State },
    ])
    .select("id, game_no, state");
  if (gamesErr || !games) {
    return NextResponse.json({ error: gamesErr?.message ?? "games insert failed" }, { status: 500 });
  }
  const game1 = games.find((g) => g.game_no === 1)!;
  const game2 = games.find((g) => g.game_no === 2)!;

  if (scenario === "empty-night") {
    return NextResponse.json({
      nightId: night.id,
      roomCode: night.room_code,
      game1,
      game2,
      categories: [] as { id: string; name: string; position: number; question_ids: string[] }[],
    });
  }

  // 3 categories, 7 questions each, point values 100..700, all picked + ready
  const catDefs = [
    { name: "Pixar movies",    topic: "pixar movies",            position: 0, color: "#E64A8C" },
    { name: "World geography", topic: "world geography",         position: 1, color: "#4ECDC4" },
    { name: "1990s music",     topic: "1990s alternative rock",  position: 2, color: "#9B7BD8" },
  ];
  const { data: cats, error: catsErr } = await admin
    .from("categories")
    .insert(catDefs.map((c) => ({
      game_id: game1.id,
      name: c.name,
      topic: c.topic,
      position: c.position,
      color: c.color,
      state: "ready",
    })))
    .select("id, name, position");
  if (catsErr || !cats) {
    return NextResponse.json({ error: catsErr?.message ?? "categories insert failed" }, { status: 500 });
  }

  const POINT_VALUES = [100, 200, 300, 400, 500, 600, 700] as const;
  type Q = { prompt: string; options: [string, string, string, string]; correct_index: 0 | 1 | 2 | 3; difficulty: number };
  const SAMPLE_QUESTIONS: Q[] = [
    { prompt: "Sample easy",     options: ["A", "B", "C", "D"], correct_index: 0, difficulty: 1 },
    { prompt: "Sample easyish",  options: ["A", "B", "C", "D"], correct_index: 1, difficulty: 2 },
    { prompt: "Sample medium",   options: ["A", "B", "C", "D"], correct_index: 2, difficulty: 3 },
    { prompt: "Sample medplus",  options: ["A", "B", "C", "D"], correct_index: 3, difficulty: 4 },
    { prompt: "Sample hardish",  options: ["A", "B", "C", "D"], correct_index: 0, difficulty: 5 },
    { prompt: "Sample hard",     options: ["A", "B", "C", "D"], correct_index: 1, difficulty: 6 },
    { prompt: "Sample hardest",  options: ["A", "B", "C", "D"], correct_index: 2, difficulty: 7 },
  ];
  const rows = [];
  for (const cat of cats) {
    for (let i = 0; i < 7; i++) {
      rows.push({
        category_id: cat.id,
        point_value: POINT_VALUES[i],
        prompt: `${cat.name}: ${SAMPLE_QUESTIONS[i]!.prompt}`,
        options: SAMPLE_QUESTIONS[i]!.options,
        correct_index: SAMPLE_QUESTIONS[i]!.correct_index,
        difficulty: SAMPLE_QUESTIONS[i]!.difficulty,
        source: "host-edit",
        is_picked: true,
      });
    }
  }
  const { data: insertedQs, error: qErr } = await admin
    .from("questions")
    .insert(rows)
    .select("id, category_id, point_value");
  if (qErr || !insertedQs) {
    return NextResponse.json({ error: qErr?.message ?? "questions insert failed" }, { status: 500 });
  }

  // Group question ids by category, sorted ascending by point_value so the
  // first id is the 100-pointer, the seventh is the 700-pointer. This lets
  // tests march a category through reveal without a follow-up fetch.
  const questionIdsByCategory = new Map<string, string[]>();
  for (const cat of cats) questionIdsByCategory.set(cat.id, []);
  const sortedQs = [...insertedQs].sort(
    (a, b) => (a.point_value ?? 0) - (b.point_value ?? 0),
  );
  for (const q of sortedQs) {
    const list = questionIdsByCategory.get(q.category_id);
    if (list) list.push(q.id);
  }
  const categoriesWithQs = cats.map((c) => ({
    ...c,
    question_ids: questionIdsByCategory.get(c.id) ?? [],
  }));

  return NextResponse.json({
    nightId: night.id,
    roomCode: night.room_code,
    game1,
    game2,
    categories: categoriesWithQs,
  });
}
