// GET /api/tv/:code/snapshot — public TV snapshot for a room code.
//
// Why this is its own route: the venue TV is anonymous (no auth, no device
// cookie). Under RLS, the browser client would see nothing — every "players
// can read…" policy requires `current_player_id(...) is not null`, and the
// TV isn't a player. So the TV pulls a curated snapshot from the server,
// which uses the admin client to bypass RLS.
//
// What's exposed: everything the TV needs to render any of its screens and
// nothing else. No host emails, no per-player device IDs, no draft questions
// (we only return questions where `is_picked = true` — picked = on the
// board). Returns null fields rather than 404 when state isn't ready, so
// the TV can keep polling against the same payload shape.
//
// Cache: no-store. The TV refreshes the snapshot whenever the broadcast
// channel fires `reveal`/`undo`/`resolve`/`end-early`; this route also
// serves the initial bootstrap and the periodic safety re-fetch.

import { ok, badRequest, notFound, serverError } from "@/lib/api/responses";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  serializeBoardQuestion,
  type TVBoardQuestionRow,
} from "@/lib/tv/serializeBoardQuestion";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await ctx.params;
  const code = parseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return badRequest("invalid room code");

  const admin = getSupabaseAdmin();

  // Night + the host's default theme (for resolveTheme on the client when
  // night.theme_key is null — i.e. no per-night override).
  const { data: night, error: nightError } = await admin
    .from("nights")
    .select(
      "id, venue_name, theme_key, room_code, opened_at, closed_at, scheduled_at, is_locked, room_magic_enabled, hosts!inner(default_theme_key)",
    )
    .eq("room_code", code)
    .maybeSingle();
  if (nightError) return serverError(nightError.message);
  if (!night) return notFound("room not found");
  const nightId = night.id;
  // Supabase returns the joined `hosts` field as either an object or an
  // array depending on relationship inference. Normalize to one object.
  const host = Array.isArray(night.hosts) ? night.hosts[0] : night.hosts;
  const hostDefaultThemeKey: string | null =
    host?.default_theme_key ?? null;

  const [
    gamesRes,
    playersRes,
    categoriesRes,
    pickedQuestionsRes,
    liveQuestionRes,
    recentRevealsRes,
  ] = await Promise.all([
    admin
      .from("games")
      .select("id, game_no, state, started_at, ended_at, category_count, question_count")
      .eq("night_id", nightId)
      .order("game_no", { ascending: true }),
    admin
      .from("players")
      .select("id, display_name, joined_at, last_seen_at, removed_at")
      .eq("night_id", nightId)
      .is("removed_at", null)
      .order("joined_at", { ascending: true }),
    admin
      .from("categories")
      .select("id, game_id, name, topic, position, color, state")
      .order("position", { ascending: true }),
    admin
      .from("questions")
      .select(
        "id, category_id, point_value, prompt, options, correct_index, image_url, fact_blurb, played_at, finished_at, is_picked",
      )
      .eq("is_picked", true),
    // Live question candidates across ALL rooms — we'll post-filter to this
    // night's categories below. `.maybeSingle()` here would error/return null
    // any time another room has an unresolved question (Brandon mid-test in
    // another tab, a half-played manual session, etc.), causing the TV in
    // THIS room to silently lose its live question. A bounded list + JS
    // filter dodges that without needing a join.
    admin
      .from("questions")
      .select(
        "id, category_id, point_value, prompt, options, correct_index, image_url, fact_blurb, played_at, finished_at, is_picked",
      )
      .not("played_at", "is", null)
      .is("finished_at", null)
      .limit(50),
    admin
      .from("reveals")
      .select("id, game_id, question_id, event, occurred_at, metadata")
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  if (gamesRes.error) return serverError(gamesRes.error.message);
  if (playersRes.error) return serverError(playersRes.error.message);
  if (categoriesRes.error) return serverError(categoriesRes.error.message);
  if (pickedQuestionsRes.error) return serverError(pickedQuestionsRes.error.message);
  if (recentRevealsRes.error) return serverError(recentRevealsRes.error.message);

  const games = gamesRes.data ?? [];
  const gameIds = new Set(games.map((g) => g.id));
  // Filter to categories owned by this night.
  const categories = (categoriesRes.data ?? []).filter((c) => gameIds.has(c.game_id));
  const categoryIds = new Set(categories.map((c) => c.id));
  // Filter to questions owned by this night.
  const questions = (pickedQuestionsRes.data ?? []).filter((q) =>
    categoryIds.has(q.category_id),
  );

  // Live question: must belong to this night. The query returns up to 50
  // candidates across all rooms; pick the first one whose category lives
  // in this night. In a healthy single-room night there's at most one such
  // row; multi-tab scenarios used to silently lose it (see comment on the
  // query above).
  const liveQuestion =
    (liveQuestionRes.data ?? []).find((q) => categoryIds.has(q.category_id)) ??
    null;

  // Recent reveals belonging to this night, newest first.
  const reveals = (recentRevealsRes.data ?? []).filter((r) => gameIds.has(r.game_id));

  // Current game = first 'live'; falls back to most-recent 'done', then a
  // 'ready' game (so the TV shows the lobby/grid even between hands).
  const liveGame = games.find((g) => g.state === "live") ?? null;
  const doneGames = games.filter((g) => g.state === "done");
  const lastDone = doneGames.length > 0
    ? [...doneGames].sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))[0]
    : null;
  const readyGame = games.find((g) => g.state === "ready") ?? null;
  const currentGame = liveGame ?? lastDone ?? readyGame ?? games[0] ?? null;

  // Fetch game_scores for currentGame (used by Grid/Leaderboard/Finale).
  let scores: Array<{
    player_id: string;
    display_name: string;
    score: number;
    correct_count: number;
    answered_count: number;
    fastest_correct_ms: number | null;
  }> = [];
  if (currentGame) {
    const { data: scoreRows } = await admin
      .from("game_scores")
      .select("*")
      .eq("game_id", currentGame.id);
    if (scoreRows) {
      // game_scores is a LEFT JOIN view so player_id + display_name can
      // technically be null. In practice every game_participation pins a
      // real player; drop the safety-null rows defensively.
      scores = scoreRows
        .filter((r): r is typeof r & { player_id: string; display_name: string } =>
          r.player_id !== null && r.display_name !== null,
        )
        .map((r) => ({
          player_id: r.player_id,
          display_name: r.display_name,
          score: Number(r.score ?? 0),
          correct_count: Number(r.correct_count ?? 0),
          answered_count: Number(r.answered_count ?? 0),
          fastest_correct_ms: r.fastest_correct_ms,
        }))
        .sort((a, b) => b.score - a.score);
    }
  }

  // Pull the live answers for the "target" question — the one the TV is
  // currently rendering. If a question is live, that's the target. Else,
  // fall back to the most recently resolved question so the reveal screen
  // can paint the fastest-five.
  let targetQuestionId: string | null = liveQuestion?.id ?? null;
  if (!targetQuestionId) {
    const resolveReveal = reveals.find((r) => r.event === "resolve") ?? reveals[0];
    targetQuestionId = resolveReveal?.question_id ?? null;
  }

  // SECURITY (anti-cheat): the target is either the LIVE (unresolved) question
  // or a fallback to the most-recently-resolved one. Per-player picks
  // (chosen_index) and correctness (is_correct) are WITHHELD until the target
  // is RESOLVED (finished_at set) — the live answer window is the exact exploit
  // window. This feed is keyed only on the room code and served via the admin
  // client (RLS bypassed), so without this any player could read every
  // opponent's pick mid-question straight off /api/tv/:code/snapshot
  // (pentest 2026-06-13, CRITICAL — same class as the correct_index leak
  // serializeBoardQuestion already closes). The TV's live "locked in" display
  // only needs the player name + ms_to_lock, which we keep.
  const targetQuestionRow =
    liveQuestion && liveQuestion.id === targetQuestionId
      ? liveQuestion
      : questions.find((q) => q.id === targetQuestionId) ?? null;
  const targetResolved = targetQuestionRow?.finished_at != null;

  let liveAnswers: Array<{
    id: string;
    question_id: string;
    player_id: string;
    player_name: string;
    ms_to_lock: number;
    is_correct: boolean | null;
    chosen_index: 0 | 1 | 2 | 3 | null;
  }> = [];
  if (targetQuestionId) {
    const { data: ans } = await admin
      .from("answers")
      .select("id, question_id, player_id, ms_to_lock, is_correct, chosen_index")
      .eq("question_id", targetQuestionId);
    if (ans && ans.length > 0) {
      const playerMap = new Map(
        (playersRes.data ?? []).map((p) => [p.id, p.display_name] as const),
      );
      liveAnswers = ans.map((a) => ({
        id: a.id,
        question_id: a.question_id,
        player_id: a.player_id,
        player_name: playerMap.get(a.player_id) ?? "—",
        ms_to_lock: Number(a.ms_to_lock ?? 0),
        // Withheld until the target question is resolved (see SECURITY note above).
        is_correct: targetResolved ? a.is_correct : null,
        // DB CHECK constraint enforces 0-3; null until resolved so the live
        // answer window never ships the actual pick to this public feed.
        chosen_index: (targetResolved ? a.chosen_index : null) as 0 | 1 | 2 | 3 | null,
      }));
      liveAnswers.sort((a, b) => a.ms_to_lock - b.ms_to_lock);
    }
  }

  return ok({
    night: {
      id: night.id,
      venueName: night.venue_name,
      themeKey: night.theme_key,
      hostDefaultThemeKey,
      roomCode: night.room_code,
      openedAt: night.opened_at,
      closedAt: night.closed_at,
      scheduledAt: night.scheduled_at,
      isLocked: night.is_locked,
      roomMagicEnabled: Boolean(
        (night as { room_magic_enabled?: boolean | null }).room_magic_enabled,
      ),
    },
    games: games.map((g) => ({
      id: g.id,
      gameNo: g.game_no,
      state: g.state,
      startedAt: g.started_at,
      endedAt: g.ended_at,
      categoryCount: g.category_count,
      questionCount: g.question_count,
    })),
    currentGameId: currentGame?.id ?? null,
    categories: categories.map((c) => ({
      id: c.id,
      gameId: c.game_id,
      name: c.name,
      topic: c.topic,
      position: c.position,
      color: c.color,
      state: c.state,
    })),
    questions: questions.map((q) =>
      serializeBoardQuestion(q as TVBoardQuestionRow),
    ),
    liveQuestionId: liveQuestion?.id ?? null,
    targetQuestionId,
    players: (playersRes.data ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
      joinedAt: p.joined_at,
      lastSeenAt: p.last_seen_at,
    })),
    scores,
    liveAnswers,
    reveals: reveals.map((r) => ({
      id: r.id,
      gameId: r.game_id,
      questionId: r.question_id,
      event: r.event,
      occurredAt: r.occurred_at,
      metadata: r.metadata,
    })),
  });
}
