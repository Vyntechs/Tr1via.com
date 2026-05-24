// Creates a fully-realized night for a test host by DRIVING the real prod
// HTTP endpoints — same path a human host walks (POST /api/nights →
// POST /api/categories → POST /api/categories/[id]/manual). This route
// is a test-only sequencer; it owns no direct DB writes that prod doesn't.
//
// Body: {hostId?, scenario?, themeKey?, roomCode?, venueName?}.
// hostId is ignored (auth comes from cookies, same as prod). It's kept in
// the body for backwards compat with old fixtures that still pass it.
//
// Scenarios:
//   - "happy-path-3-cats-game1": 3 categories of 7 picked questions in game 1
//   - "two-games-ready": same + 1 category of 7 picked questions in game 2
//   - "empty-night": no categories
//
// Returns: {nightId, roomCode, game1, game2,
//           categories:[{id,name,position,question_ids:[uuid,...]}],
//           game2Categories:[{id,name,position,question_ids:[uuid,...]}]}.
// question_ids are sorted ascending by point_value (100 -> 700) so tests
// can drive a category through reveal one question at a time without
// a separate fetch.
//
// Why the round-trip through prod endpoints: a previous version inserted
// games in 'ready' state and questions with is_picked=true directly. Real
// prod inserts games in 'draft' and walks them through /open + /start at
// reveal time. Four critical gameplay bugs (participation, kick, reveal,
// all-locked-no-resolve) lived in code paths e2e fixtures bypassed. The
// rule going forward: tests enter the same doors users do.

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTestModeEnabled } from "@/lib/api/require-test-mode";

interface SeedReq {
  hostId?: string;
  scenario?: "happy-path-3-cats-game1" | "two-games-ready" | "empty-night";
  themeKey?: string;
  roomCode?: string;
  venueName?: string;
}

interface SeededCategory {
  id: string;
  name: string;
  position: number;
  question_ids: string[];
}

// 7 sample questions per category, easiest → hardest. Row order drives
// difficulty 1..7 inside /manual, which assigns point_value 100..700 in
// the same order. Options must be 4 distinct strings (manual route
// enforces this via Zod).
const SAMPLE_QUESTIONS = [
  { prompt: "Sample question 1 (easy)",    options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 0 },
  { prompt: "Sample question 2 (easyish)", options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 1 },
  { prompt: "Sample question 3 (medium)",  options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 2 },
  { prompt: "Sample question 4 (medplus)", options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 3 },
  { prompt: "Sample question 5 (hardish)", options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 0 },
  { prompt: "Sample question 6 (hard)",    options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 1 },
  { prompt: "Sample question 7 (hardest)", options: ["Alpha", "Bravo", "Charlie", "Delta"], correctIndex: 2 },
] as const;

const GAME1_CATEGORIES = [
  { name: "Pixar movies",    topic: "pixar movies",           position: 1 },
  { name: "World geography", topic: "world geography",        position: 2 },
  { name: "1990s music",     topic: "1990s alternative rock", position: 3 },
] as const;

const GAME2_CATEGORIES = [
  { name: "Bonus round", topic: "general trivia", position: 1 },
] as const;

export async function POST(req: NextRequest) {
  if (!isTestModeEnabled(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as SeedReq | null;
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const scenario = body.scenario ?? "happy-path-3-cats-game1";
  const venueName = body.venueName ?? "Test Venue";
  const themeKey = body.themeKey ?? "house";
  const origin = new URL(req.url).origin;
  const testSecret = req.headers.get("x-test-secret") ?? "";

  // Cookie jar threaded through every internal fetch. The Supabase SSR
  // client refreshes auth tokens mid-request and writes new cookies on
  // the response; if we don't capture and forward them, the SECOND
  // internal call (and later) sends stale cookies and getAuthedHost
  // returns 401 "not signed in". The jar starts from the inbound
  // request's cookie header.
  const cookieJar = new Map<string, string>();
  function ingestRawCookieHeader(raw: string | null) {
    if (!raw) return;
    for (const pair of raw.split(/;\s*/)) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) cookieJar.set(name, value);
    }
  }
  function ingestSetCookieHeader(raw: string | null) {
    if (!raw) return;
    // Split on commas that precede a `name=` (not commas inside attribute
    // values like Expires=Mon, 23-May-...).
    for (const part of raw.split(/,(?=[^ ;]+=)/)) {
      const [pair] = part.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) cookieJar.set(name, value);
    }
  }
  function jarCookieHeader(): string {
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  ingestRawCookieHeader(req.headers.get("cookie"));

  // Internal fetch helper. Forwards (and updates) cookies so getAuthedHost()
  // resolves the same Supabase session that hit /seed-night, even as that
  // session's tokens refresh between calls. The x-test-secret header is
  // also forwarded in case any downstream endpoint ever wants it.
  async function callProd(path: string, init: RequestInit = {}) {
    const res = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: jarCookieHeader(),
        "x-test-secret": testSecret,
        ...(init.headers ?? {}),
      },
    });
    ingestSetCookieHeader(res.headers.get("set-cookie"));
    return res;
  }

  // 1. Create the night via the REAL endpoint. This creates both games
  //    in 'draft' state (the prod default) — same path a real host hits.
  const nightRes = await callProd("/api/nights", {
    method: "POST",
    body: JSON.stringify({ venueName, themeKey }),
  });
  if (!nightRes.ok) {
    return NextResponse.json(
      { error: `create night failed: ${nightRes.status} ${await nightRes.text()}` },
      { status: 500 },
    );
  }
  const nightBody = (await nightRes.json()) as { nightId: string; roomCode: string };
  const nightId = nightBody.nightId;

  // The caller may have requested a specific roomCode (older fixtures did
  // this for deterministic URLs). The new /api/nights endpoint mints its
  // own code; if the caller asked for one we overwrite it post-hoc via
  // admin client. This is the only DB write left in this route.
  const admin = getSupabaseAdmin();
  let roomCode = nightBody.roomCode;
  if (body.roomCode) {
    const { error: codeErr } = await admin
      .from("nights")
      .update({ room_code: body.roomCode })
      .eq("id", nightId);
    if (!codeErr) roomCode = body.roomCode;
  }

  // 2. Look up the two game shells that /api/nights just created.
  const { data: games, error: gamesErr } = await admin
    .from("games")
    .select("id, game_no, state")
    .eq("night_id", nightId)
    .order("game_no");
  if (gamesErr || !games || games.length !== 2) {
    return NextResponse.json(
      { error: gamesErr?.message ?? "games lookup failed" },
      { status: 500 },
    );
  }
  const game1 = games.find((g) => g.game_no === 1)!;
  const game2 = games.find((g) => g.game_no === 2)!;

  // Empty night: bail here. Caller wanted shell rows only.
  if (scenario === "empty-night") {
    return NextResponse.json({
      nightId,
      roomCode,
      game1,
      game2,
      categories: [] as SeededCategory[],
      game2Categories: [] as SeededCategory[],
    });
  }

  // Helper: create a category + populate 7 manual questions via the real
  // endpoints. Returns the category id, name, position, and the picked
  // question ids in point-value order (100..700).
  async function seedCategoryViaProdApis(
    gameId: string,
    name: string,
    topic: string,
    position: number,
  ): Promise<SeededCategory> {
    // a. POST /api/categories — creates the category in 'draft' state.
    const catRes = await callProd("/api/categories", {
      method: "POST",
      body: JSON.stringify({ gameId, name, topic, position }),
    });
    if (!catRes.ok) {
      throw new Error(
        `create category ${name}: ${catRes.status} ${await catRes.text()}`,
      );
    }
    const { category } = (await catRes.json()) as {
      category: { id: string; name: string; position: number; state: string };
    };

    // b. POST /api/categories/[id]/manual — the prod "I'll type them myself"
    //    path. Wipes any prior questions, inserts the 7 we hand in (row
    //    order = difficulty 1..7 → point_value 100..700), sets is_picked=
    //    true, and flips category.state from 'draft' → 'ready'. Exactly the
    //    state a real lock-in produces, just without Claude in the loop.
    const manualRes = await callProd(`/api/categories/${category.id}/manual`, {
      method: "POST",
      body: JSON.stringify({
        questions: SAMPLE_QUESTIONS.map((q) => ({
          prompt: `${name}: ${q.prompt}`,
          options: q.options,
          correctIndex: q.correctIndex,
        })),
      }),
    });
    if (!manualRes.ok) {
      throw new Error(
        `manual ${name}: ${manualRes.status} ${await manualRes.text()}`,
      );
    }
    const manualBody = (await manualRes.json()) as {
      questions: Array<{ id: string; point_value: number | null }>;
    };
    // The route returns rows in insert order; sort ascending by
    // point_value to honor the documented contract (id[0] is 100pt …
    // id[6] is 700pt). Manual inserts them in order so this is a no-op
    // in practice, but be explicit.
    const sorted = [...manualBody.questions].sort(
      (a, b) => (a.point_value ?? 0) - (b.point_value ?? 0),
    );
    return {
      id: category.id,
      name: category.name,
      position: category.position,
      question_ids: sorted.map((q) => q.id),
    };
  }

  let categoriesWithQs: SeededCategory[] = [];
  let game2CategoriesWithQs: SeededCategory[] = [];
  try {
    for (const def of GAME1_CATEGORIES) {
      const seeded = await seedCategoryViaProdApis(
        game1.id,
        def.name,
        def.topic,
        def.position,
      );
      categoriesWithQs.push(seeded);
    }
    if (scenario === "two-games-ready") {
      for (const def of GAME2_CATEGORIES) {
        const seeded = await seedCategoryViaProdApis(
          game2.id,
          def.name,
          def.topic,
          def.position,
        );
        game2CategoriesWithQs.push(seeded);
      }
    }
  } catch (e) {
    // Best-effort cleanup so a failed seed doesn't leave stale rows; the
    // cascade deletes games → categories → questions.
    await admin.from("nights").delete().eq("id", nightId);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Re-read game states (they're still 'draft' — same as prod). Test
  // helpers that need 'live' must call startGame() explicitly, which
  // mirrors what the host's "Start" button does at runtime.
  const { data: gamesAfter } = await admin
    .from("games")
    .select("id, game_no, state")
    .eq("night_id", nightId)
    .order("game_no");
  const game1After = gamesAfter?.find((g) => g.game_no === 1) ?? game1;
  const game2After = gamesAfter?.find((g) => g.game_no === 2) ?? game2;

  return NextResponse.json({
    nightId,
    roomCode,
    game1: game1After,
    game2: game2After,
    categories: categoriesWithQs,
    game2Categories: game2CategoriesWithQs,
  });
}
