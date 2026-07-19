// GET /api/room/:code/snapshot — resilient server-route mirror of useRoom's
// direct browser→Supabase bootstrap reads.
//
// Why: the host console + player phone normally read live state with ~7 DIRECT
// browser→Supabase calls (+ a realtime WebSocket). On a degraded/blocked venue
// network those drop, leaving the host on a black screen and the player spinning
// (2026-06-10 incident). This route does the same reads SERVER-side via the
// admin client — one same-origin request (browser→Vercel→Supabase) on Vercel's
// reliable backbone — so the client can fall back to it and keep playing. The
// /tv route already proved this path survives the venue WiFi that blocked the
// direct line (only the live game, which reads directly, went black).
//
// Two auth modes (mirrors how RLS treats host JWT vs device cookie):
//   - HOST: a signed-in host who owns this night → full room state + board.
//   - PLAYER: a device cookie matching a non-removed player in this night →
//     room state + that player's own answers/participations.
// Neither → 403.
//
// SECURITY: correct_index is withheld for any non-resolved question
// (serializeRoomQuestion) — identical to the public TV feed (2026-06-06 pentest).
//
// Cache: no-store. This is the degraded-network fallback + (optionally) a poll.

import { ok, badRequest, forbidden, notFound, serverError } from "@/lib/api/responses";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { isRoomMagicReactionKind } from "@/lib/room-magic/reactions";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAuthedHost, getDeviceId } from "@/lib/api/auth";
import {
  serializeHostLiveAnswer,
  serializeParticipation,
  serializePlayerCanonicalAnswer,
  serializePlayerSelf,
  serializeRoomPlayer,
  serializeRoomQuestion,
} from "@/lib/room/roomAudience";
import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  GameScoreRow,
  NightRow,
  ParticipationRow,
  PlayerRow,
  QuestionRow,
  RevealRow,
} from "@/lib/supabase/types";

type SafePlayerRow = Pick<
  PlayerRow,
  | "id"
  | "night_id"
  | "display_name"
  | "joined_at"
  | "last_seen_at"
  | "removed_at"
  | "app_switch_total_seconds"
>;

const RECENT_REACTION_WINDOW_MS = 30_000;
const RECENT_REACTION_LIMIT = 25;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await ctx.params;
  const code = parseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return badRequest("invalid room code");

  const admin = getSupabaseAdmin();

  // Night + host default theme. Select * so we return a full NightRow (matching
  // the player's direct `nights` read); the joined host theme is stripped off.
  const { data: nightRaw, error: nightErr } = await admin
    .from("nights")
    .select("*, hosts!inner(default_theme_key)")
    .eq("room_code", code)
    .maybeSingle();
  if (nightErr) return serverError();
  if (!nightRaw) return notFound("room not found");

  type HostJoin = { default_theme_key: string | null };
  const hostsField = (nightRaw as { hosts?: HostJoin | HostJoin[] }).hosts;
  const hostJoin = Array.isArray(hostsField) ? hostsField[0] : hostsField;
  const hostDefaultThemeKey: string | null = hostJoin?.default_theme_key ?? null;
  const nightRow = { ...(nightRaw as Record<string, unknown> & {
    hosts?: unknown;
  }) };
  delete nightRow.hosts;
  const night = nightRow as unknown as NightRow;
  const nightId = night.id;

  // ── Authorize: host-owns-night OR device-cookie player in this night ──────
  let mode: "host" | "player";
  let playerRow: SafePlayerRow | null = null;

  const hostAuth = await getAuthedHost();
  if (hostAuth.ok && (night as { host_id?: string }).host_id === hostAuth.host.id) {
    mode = "host";
  } else {
    const deviceId = await getDeviceId();
    if (!deviceId) return forbidden("not authorized for this room");
    const { data: player } = await admin
      .from("players")
      .select(
        "id, night_id, display_name, joined_at, last_seen_at, removed_at, app_switch_total_seconds, device_id",
      )
      .eq("night_id", nightId)
      .eq("device_id", deviceId)
      .is("removed_at", null)
      .maybeSingle();
    if (!player) return forbidden("not a player in this room");
    mode = "player";
    playerRow = player as SafePlayerRow;
  }

  // ── Room state (same reads useRoom's bootstrap does, server-side) ─────────
  const [gamesRes, categoriesRes, playersRes, pickedRes, revealsRes] =
    await Promise.all([
      admin
        .from("games")
        .select("*")
        .eq("night_id", nightId)
        .order("game_no", { ascending: true }),
      admin
        .from("categories")
        .select("*, games!inner(night_id)")
        .eq("games.night_id", nightId)
        .order("position", { ascending: true }),
      admin
        .from("players")
        .select(
          "id, night_id, display_name, joined_at, last_seen_at, removed_at, app_switch_total_seconds",
        )
        .eq("night_id", nightId)
        .is("removed_at", null)
        .order("joined_at", { ascending: true }),
      // All picked questions for this night's categories — the board + the
      // live/resolved derivation below.
      admin
        .from("questions")
        .select("*, categories!inner(games!inner(night_id))")
        .eq("categories.games.night_id", nightId)
        .eq("is_picked", true),
      admin
        .from("reveals")
        .select("*, games!inner(night_id)")
        .eq("games.night_id", nightId)
        .order("occurred_at", { ascending: false })
        .limit(1),
    ]);

  if (gamesRes.error) return serverError();
  if (categoriesRes.error) return serverError();
  if (playersRes.error) return serverError();
  if (pickedRes.error) return serverError();
  if (revealsRes.error) return serverError();

  const games = (gamesRes.data ?? []) as GameRow[];
  const categories = stripJoins(categoriesRes.data ?? [], "games") as CategoryRow[];
  const players = ((playersRes.data ?? []) as SafePlayerRow[]).map(serializeRoomPlayer);
  const allQuestionsRaw = stripJoins(pickedRes.data ?? [], "categories") as QuestionRow[];
  const reveals = stripJoins(revealsRes.data ?? [], "games") as RevealRow[];

  // Derive currentQuestion (live) + lastResolvedQuestion from the picked set —
  // identical semantics to useRoom's dedicated live/last-resolved queries.
  const currentQuestionRaw =
    allQuestionsRaw.find((q) => q.played_at !== null && q.finished_at === null) ?? null;
  const lastResolvedRaw =
    [...allQuestionsRaw]
      .filter((q) => q.finished_at !== null)
      .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0] ?? null;

  // Current game for scoring (live → most-recent-done → ready → first).
  const liveGame = games.find((g) => g.state === "live");
  const doneGame = [...games]
    .filter((g) => g.state === "done")
    .sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""))[0];
  const readyGame = games.find((g) => g.state === "ready");
  const currentGame = liveGame ?? doneGame ?? readyGame ?? games[0] ?? null;

  // Target question for the host's lock count / reveal answers: the live one,
  // else the most-recently-resolved (mirrors HostLiveConsoleClient).
  const targetQuestionId = currentQuestionRaw?.id ?? lastResolvedRaw?.id ?? null;

  // ── Aux reads: scores + target-question answers + the player's own data ───
  const [scoresRes, liveAnswersRes, myAnswersRes, myParticipationsRes, roomMagicReactionsRes] =
    await Promise.all([
      currentGame
        ? admin
            .from("game_scores")
            .select("*")
            .eq("game_id", currentGame.id)
            .order("score", { ascending: false })
        : Promise.resolve({ data: [] as GameScoreRow[], error: null }),
      // ANTI-CHEAT: only the HOST receives the target question's answers (lock
      // counts + reveal data). A player must NOT see other players' picks while
      // the question is live — so player mode resolves to []. Explicit column
      // list (matches the TV route) so a future select("*") can't auto-ship a
      // sensitive column.
      mode === "host" && targetQuestionId
        ? admin
            .from("answers")
            .select("id, question_id, player_id, ms_to_lock, is_correct, chosen_index")
            .eq("question_id", targetQuestionId)
        : Promise.resolve({ data: [], error: null }),
      mode === "player" && playerRow
        ? admin
            .from("answers")
            .select(
              "id, player_id, question_id, chosen_index, scramble, ms_to_lock, is_correct, awarded_points, locked_at",
            )
            .eq("player_id", playerRow.id)
            .order("locked_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      mode === "player" && playerRow
        ? admin
            .from("game_participations")
            .select("id, player_id, game_id, joined_at")
            .eq("player_id", playerRow.id)
        : Promise.resolve({ data: [] as ParticipationRow[], error: null }),
      mode === "host" && night.room_magic_enabled === true
        ? admin
            .from("room_magic_reactions")
            .select("id, kind, created_at")
            .eq("night_id", nightId)
            .gte(
              "created_at",
              new Date(Date.now() - RECENT_REACTION_WINDOW_MS).toISOString(),
            )
            .order("created_at", { ascending: true })
            .limit(RECENT_REACTION_LIMIT)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const scores = (scoresRes.data ?? []) as GameScoreRow[];
  if (scoresRes.error) return serverError();
  if (liveAnswersRes.error) return serverError();
  if (myAnswersRes.error) return serverError();
  if (myParticipationsRes.error) return serverError();
  if (roomMagicReactionsRes.error) return serverError();

  const liveAnswers = (liveAnswersRes.data ?? []).map(serializeHostLiveAnswer);
  const myAnswers = (myAnswersRes.data ?? []).map(serializePlayerCanonicalAnswer);
  const myParticipations = ((myParticipationsRes.data ?? []) as ParticipationRow[]).map(
    serializeParticipation,
  );
  const roomMagicReactions = (roomMagicReactionsRes.data ?? [])
    .filter((row) => isRoomMagicReactionKind(row.kind))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      serverNow: row.created_at,
    }));

  const common = {
    night,
    hostDefaultThemeKey,
    games,
    categories,
    players,
    // SECURITY: withhold correct_index for non-resolved questions.
    currentQuestion: currentQuestionRaw ? serializeRoomQuestion(currentQuestionRaw) : null,
    lastResolvedQuestion: lastResolvedRaw ? serializeRoomQuestion(lastResolvedRaw) : null,
    currentReveal: reveals[0] ?? null,
    allQuestions: allQuestionsRaw.map(serializeRoomQuestion),
    scores,
    roomMagicReactions: mode === "host" ? roomMagicReactions : [],
  };

  if (mode === "player" && playerRow) {
    return ok({
      ...common,
      audience: "player" as const,
      self: serializePlayerSelf(playerRow),
      myAnswers,
      myParticipations,
    });
  }

  return ok({
    ...common,
    audience: "host" as const,
    self: null,
    liveAnswers,
  });
}

/** Strip an embedded join field (e.g. `categories.games`) from each row. */
function stripJoins<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
): Array<Omit<T, typeof field>> {
  return rows.map((r) => {
    const copy = { ...r };
    delete copy[field];
    return copy;
  });
}
