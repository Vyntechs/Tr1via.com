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
import {
  getAuthedHost,
  getDeviceId,
  hasHostSessionCookie,
} from "@/lib/api/auth";
import {
  projectHostLiveRoom,
  projectPlayerLiveRoom,
} from "@/lib/live-answer/projectPlay";
import {
  serializeHostLiveAnswer,
  serializeParticipation,
  serializePlayerCanonicalAnswer,
  serializePlayerRoomPlayer,
  serializePlayerScore,
  serializePlayerSelf,
  serializeRoomPlayer,
  serializeRoomQuestion,
} from "@/lib/room/roomAudience";
import { presentationKey } from "@/lib/room/presentationKey";
import { scrambleFor } from "@/lib/game/scramble";
import type {
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

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

type SharedRoomState = {
  night: NightRow;
  hostDefaultThemeKey: string | null;
  currentPlay: Record<string, unknown> | null;
  games: GameRow[];
  categories: CategoryRow[];
  activePlayerRows: SafePlayerRow[];
  allQuestionsRaw: QuestionRow[];
  reveals: RevealRow[];
  allScores: GameScoreRow[];
};

type SharedRoomResult =
  | { ok: true; value: SharedRoomState }
  | { ok: false; kind: "not-found" | "server-error" };

// A reveal wakes every player at nearly the same instant. Without request
// coalescing, each phone independently runs the same room-wide query fan-out,
// multiplying one transition into hundreds of concurrent database reads.
// Share only the in-flight promise: there is no TTL and therefore no stale
// room state. Player-specific answers and identity remain outside this map.
const sharedRoomLoads = new Map<string, Promise<SharedRoomResult>>();

function loadSharedRoomState(
  admin: AdminClient,
  code: string,
): Promise<SharedRoomResult> {
  const existing = sharedRoomLoads.get(code);
  if (existing) return existing;

  const pending = loadSharedRoomStateUncached(admin, code);
  sharedRoomLoads.set(code, pending);
  const cleanup = () => {
    if (sharedRoomLoads.get(code) === pending) sharedRoomLoads.delete(code);
  };
  void pending.then(cleanup, cleanup);
  return pending;
}

async function loadSharedRoomStateUncached(
  admin: AdminClient,
  code: string,
): Promise<SharedRoomResult> {
  const { data: nightRaw, error: nightErr } = await admin
    .from("nights")
    .select("*, hosts!inner(default_theme_key)")
    .eq("room_code", code)
    .maybeSingle();
  if (nightErr) return { ok: false, kind: "server-error" };
  if (!nightRaw) return { ok: false, kind: "not-found" };

  type HostJoin = { default_theme_key: string | null };
  const hostsField = (nightRaw as { hosts?: HostJoin | HostJoin[] }).hosts;
  const hostJoin = Array.isArray(hostsField) ? hostsField[0] : hostsField;
  const hostDefaultThemeKey = hostJoin?.default_theme_key ?? null;
  const nightRow = { ...(nightRaw as Record<string, unknown> & { hosts?: unknown }) };
  delete nightRow.hosts;
  const night = nightRow as unknown as NightRow;
  const nightId = night.id;

  const [gamesRes, categoriesRes, playersRes, pickedRes, revealsRes, playRes] =
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
      night.answer_engine === "resilient_v1" && night.current_run_id
        ? admin
            .from("question_plays")
            .select(
              "id, game_id, question_id, status, opened_at, main_zero_at, final_window_starts_at, final_window_ends_at, finalize_at, eligible_count, confirmed_count",
            )
            .eq("night_id", nightId)
            .eq("run_id", night.current_run_id)
            .order("opened_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (
    gamesRes.error || categoriesRes.error || playersRes.error ||
    pickedRes.error || revealsRes.error || playRes.error
  ) {
    return { ok: false, kind: "server-error" };
  }

  const games = (gamesRes.data ?? []) as GameRow[];
  const { data: scoresData, error: scoresError } = games.length > 0
    ? await admin
        .from("game_scores")
        .select("*")
        .in("game_id", games.map((game) => game.id))
        .order("score", { ascending: false })
    : { data: [] as GameScoreRow[], error: null };
  if (scoresError) return { ok: false, kind: "server-error" };

  return {
    ok: true,
    value: {
      night,
      hostDefaultThemeKey,
      currentPlay: playRes.data?.[0] ?? null,
      games,
      categories: stripJoins(categoriesRes.data ?? [], "games") as CategoryRow[],
      activePlayerRows: (playersRes.data ?? []) as SafePlayerRow[],
      allQuestionsRaw: stripJoins(pickedRes.data ?? [], "categories") as QuestionRow[],
      reveals: stripJoins(revealsRes.data ?? [], "games") as RevealRow[],
      allScores: (scoresData ?? []) as GameScoreRow[],
    },
  };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await ctx.params;
  const code = parseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return badRequest("invalid room code");

  const admin = getSupabaseAdmin();
  const sharedResult = await loadSharedRoomState(admin, code);
  if (!sharedResult.ok) {
    return sharedResult.kind === "not-found"
      ? notFound("room not found")
      : serverError();
  }
  const {
    night,
    hostDefaultThemeKey,
    currentPlay,
    games,
    categories,
    activePlayerRows,
    allQuestionsRaw,
    reveals,
    allScores,
  } = sharedResult.value;
  const nightId = night.id;

  // ── Authorize: host-owns-night OR device-cookie player in this night ──────
  let mode: "host" | "player";
  let playerRow: SafePlayerRow | null = null;

  // Player phones normally have no host session. Avoid calling Supabase Auth
  // hundreds of times during a reveal fan-out; the cookie check is only a
  // hint, and real host sessions are still fully validated below.
  const mayBeHost = await hasHostSessionCookie();
  const hostAuth = mayBeHost ? await getAuthedHost() : null;
  if (hostAuth?.ok && (night as { host_id?: string }).host_id === hostAuth.host.id) {
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
      .maybeSingle();
    if (!player) return forbidden("not a player in this room");
    mode = "player";
    playerRow = player as SafePlayerRow;
  }

  // Resilient nights expose one explicit audience-safe projection. Raw plays,
  // frozen eligibility rows, and canonical answers never cross this route.
  let playerEligibility: { play_id: string } | null = null;
  let playerCanonicalAnswer: Record<string, unknown> | null = null;
  const resilient = night.answer_engine === "resilient_v1";
  if (resilient && night.current_run_id) {
    if (mode === "player" && playerRow && currentPlay) {
      const [eligibilityRes, canonicalAnswerRes] = await Promise.all([
        admin
          .from("question_play_eligibility")
          .select("play_id")
          .eq("play_id", currentPlay.id as string)
          .eq("player_id", playerRow.id)
          .maybeSingle(),
        admin
          .from("question_play_answers")
          .select(
            "visible_slot, canonical_index, received_at, locked_at, ms_to_lock, is_correct, awarded_points",
          )
          .eq("play_id", currentPlay.id as string)
          .eq("player_id", playerRow.id)
          .maybeSingle(),
      ]);
      if (eligibilityRes.error || canonicalAnswerRes.error) return serverError();
      playerEligibility = eligibilityRes.data;
      playerCanonicalAnswer = canonicalAnswerRes.data;
    }
  }

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

  // A completed Game 1 play is not the current Game 2 play. This prevents the
  // between-games snapshot from replaying old answer state before Game 2's
  // first question opens.
  const projectionPlay =
    liveGame && currentPlay?.game_id === liveGame.id && currentPlay.status !== "undone"
      ? currentPlay
      : null;
  const projectionEligibility =
    projectionPlay && playerEligibility?.play_id === projectionPlay.id
      ? playerEligibility
      : null;
  const projectionAnswer = projectionEligibility ? playerCanonicalAnswer : null;

  // Removal stops access to future plays, but it cannot revoke eligibility
  // that was frozen for a play already in progress.
  if (mode === "player" && playerRow?.removed_at && !projectionEligibility) {
    return forbidden("not a player in this room");
  }

  const live = resilient && night.current_run_id
    ? mode === "player"
      ? projectPlayerLiveRoom({
          night: {
            current_run_id: night.current_run_id,
            room_revision: night.room_revision ?? 0,
            control_revision: night.control_revision ?? 0,
          },
          play: projectionPlay as Parameters<typeof projectPlayerLiveRoom>[0]["play"],
          eligibility: projectionEligibility,
          answer: projectionAnswer as Parameters<
            typeof projectPlayerLiveRoom
          >[0]["answer"],
        })
      : projectHostLiveRoom({
          night: {
            current_run_id: night.current_run_id,
            room_revision: night.room_revision ?? 0,
            control_revision: night.control_revision ?? 0,
          },
          play: projectionPlay as Parameters<typeof projectHostLiveRoom>[0]["play"],
        })
    : null;

  // Target question for the host's lock count / reveal answers: the live one,
  // else the most-recently-resolved (mirrors HostLiveConsoleClient).
  const targetQuestionId = currentQuestionRaw?.id ?? lastResolvedRaw?.id ?? null;

  // ── Aux reads: scores + target-question answers + the player's own data ───
  const [liveAnswersRes, myAnswersRes, myParticipationsRes, roomMagicReactionsRes] =
    await Promise.all([
      // ANTI-CHEAT: only the HOST receives the target question's answers (lock
      // counts + reveal data). A player must NOT see other players' picks while
      // the question is live — so player mode resolves to []. Explicit column
      // list (matches the TV route) so a future select("*") can't auto-ship a
      // sensitive column.
      mode === "host" && resilient && projectionPlay
        ? admin
            .from("question_play_answers")
            .select("play_id, player_id, canonical_index, locked_at, ms_to_lock, is_correct, awarded_points")
            .eq("play_id", projectionPlay.id as string)
        : mode === "host" && !resilient && targetQuestionId
          ? admin
            .from("answers")
            .select("id, question_id, player_id, ms_to_lock, locked_at, is_correct, awarded_points, chosen_index")
            .eq("question_id", targetQuestionId)
        : Promise.resolve({ data: [], error: null }),
      mode === "player" && playerRow
        ? admin
            .from("answers")
            .select(
              "question_id, chosen_index, scramble, ms_to_lock, is_correct, awarded_points, locked_at",
            )
            .eq("player_id", playerRow.id)
            .order("locked_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      mode === "player" && playerRow
        ? admin
            .from("game_participations")
            .select("game_id, joined_at")
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

  const scores = currentGame
    ? allScores.filter((score) => score.game_id === currentGame.id)
    : [];
  if (liveAnswersRes.error) return serverError();
  if (myAnswersRes.error) return serverError();
  if (myParticipationsRes.error) return serverError();
  if (roomMagicReactionsRes.error) return serverError();

  const liveAnswers = resilient && projectionPlay
    ? ((liveAnswersRes.data ?? []) as Array<{
        play_id: string;
        player_id: string;
        canonical_index: number;
        locked_at: string;
        ms_to_lock: number;
        is_correct: boolean | null;
        awarded_points: number | null;
      }>).map((answer) => serializeHostLiveAnswer({
        id: `${String(answer.play_id)}:${String(answer.player_id)}`,
        question_id: String(projectionPlay.question_id),
        player_id: String(answer.player_id),
        chosen_index: Number(answer.canonical_index),
        locked_at: String(answer.locked_at),
        ms_to_lock: Number(answer.ms_to_lock),
        is_correct: typeof answer.is_correct === "boolean" ? answer.is_correct : null,
        awarded_points: typeof answer.awarded_points === "number" ? answer.awarded_points : null,
      }))
    : ((liveAnswersRes.data ?? []) as Array<{
        id: string;
        question_id: string;
        player_id: string;
        ms_to_lock: number;
        locked_at: string;
        chosen_index: number | null;
        is_correct: boolean | null;
        awarded_points: number | null;
      }>).map(serializeHostLiveAnswer);
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
    hostDefaultThemeKey,
    games,
    categories,
    // SECURITY: withhold correct_index for non-resolved questions.
    currentQuestion: currentQuestionRaw ? serializeRoomQuestion(currentQuestionRaw) : null,
    lastResolvedQuestion: lastResolvedRaw ? serializeRoomQuestion(lastResolvedRaw) : null,
    currentReveal: reveals[0] ?? null,
    allQuestions: allQuestionsRaw.map(serializeRoomQuestion),
    allScores,
    scores,
    scoreGameId: currentGame?.id ?? null,
    roomMagicReactions: mode === "host" ? roomMagicReactions : [],
  };

  if (mode === "player" && playerRow) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return serverError();
    const nightKey = presentationKey(secret, "player", "night", nightId, nightId);
    const keyForPlayer = (rawPlayerId: string) =>
      presentationKey(secret, "player", "player", nightId, rawPlayerId);
    const playerKeys = new Map(
      activePlayerRows.map((player) => [player.id, keyForPlayer(player.id)] as const),
    );
    const playerScores = allScores.flatMap((score) => {
      if (score.player_id === null) return [];
      const serialized = serializePlayerScore(score, keyForPlayer(score.player_id));
      return serialized ? [serialized] : [];
    });
    const safeNight = { ...night } as Partial<NightRow>;
    delete safeNight.id;
    delete safeNight.host_id;
    delete safeNight.current_run_id;
    const safeGames = games.map((game) => {
      const safeGame = { ...game } as Partial<GameRow>;
      delete safeGame.night_id;
      return safeGame;
    });
    const questionScrambles = Object.fromEntries(
      allQuestionsRaw.map((question) => [question.id, scrambleFor(question.id, playerRow.id)]),
    );
    return ok({
      ...common,
      night: { ...safeNight, nightKey },
      games: safeGames,
      players: activePlayerRows.map((player) =>
        serializePlayerRoomPlayer(player, playerKeys.get(player.id) ?? keyForPlayer(player.id))),
      allScores: playerScores,
      scores: currentGame
        ? playerScores.filter((score) => score.gameId === currentGame.id)
        : [],
      audience: "player" as const,
      live,
      self: serializePlayerSelf(playerRow, keyForPlayer(playerRow.id)),
      myAnswers,
      myParticipations,
      questionScrambles,
    });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) return serverError();
  const tvPlayerIds = new Set<string>(activePlayerRows.map((player) => player.id));
  for (const score of allScores) {
    if (score.player_id) tvPlayerIds.add(score.player_id);
  }
  for (const answer of liveAnswers) tvPlayerIds.add(answer.playerId);
  const tvPlayerKeys = Object.fromEntries(
    [...tvPlayerIds].map((rawPlayerId) => [
      rawPlayerId,
      presentationKey(secret, "tv", "player", nightId, rawPlayerId),
    ]),
  );

  return ok({
    ...common,
    night,
    players: activePlayerRows.map(serializeRoomPlayer),
    allScores,
    scores,
    audience: "host" as const,
    tvPlayerKeys,
    live,
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
