// roomToTVSnapshot — pure adapter from the host-side `useRoom` snapshot
// (plus the auxiliary state the host already maintains: all picked
// questions, current scores, current question's answers) to the
// `TVSnapshot` shape consumed by <TVStateMachine />.
//
// Why this exists: the host laptop is often HDMI'd to the venue TV (one
// browser window, one screen) so the host page renders the TV inline.
// Rather than have the inline TV refetch and resubscribe over its own
// /api/tv/:code/snapshot pipe (duplicating network + a duplicate
// Realtime WebSocket on `room:{code}`), we re-use the host's existing
// useRoom state and translate it into the TV's shape. No fetches, no
// hooks — pure function.
//
// The host's useRoom doesn't track every field the snapshot route does:
//   • `liveAnswers` (live question's answer rows) — the host loads these
//     via a separate `host-answers:{questionId}` channel subscription.
//   • `scores` (game_scores view) — the host loads these via the
//     `host-scores:{gameId}` subscription.
//   • All picked questions across both games — the host loads these once
//     into `allQuestions` so the board grid can render even before any
//     question is live.
//   • Reveals history — the host only keeps `currentReveal` (the latest
//     reveal row for the live question). We synthesize a minimal reveals
//     array good enough for the state machine: the only fields it reads
//     are `event` and the array length.
//
// Caller passes all four. They're already in scope in HostLiveConsoleClient.

import type {
  CategoryRow,
  GameRow,
  GameScoreRow,
  PlayerRow,
  QuestionRow,
  RevealRow,
} from "@/lib/supabase/types";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type {
  TVAnswer,
  TVCategory,
  TVGame,
  TVPlayer,
  TVQuestion as TVQuestionShape,
  TVReveal,
  TVScore,
  TVSnapshot,
} from "@/lib/hooks/useTVRoom";

/** Per-answer row used by the host's live-question subscription. Only the
 *  fields the TV reveal/question screens consume. */
export interface RoomAnswerRow {
  id: string;
  question_id: string;
  player_id: string;
  ms_to_lock: number;
  is_correct: boolean | null;
  chosen_index: 0 | 1 | 2 | 3;
}

export interface RoomToTVSnapshotInput {
  /** The host's useRoom snapshot. */
  room: RoomSnapshot;
  /** Every picked question across both games (host loads these once for the
   *  board grid). May be empty before the load lands. */
  allQuestions: QuestionRow[];
  /** game_scores rows for the current game (host loads these on mount and
   *  re-subscribes to answers/adjustments). */
  scores: GameScoreRow[];
  /** answers rows for the currently live OR most-recently-resolved
   *  question. Host's subscription targets the current question; when that
   *  question resolves, the rows stay valid through the reveal frame. */
  answers: RoomAnswerRow[];
}

/**
 * Pure translator. Returns null only when the night row hasn't loaded yet
 * (initial bootstrap) — callers should fall back to a loading frame.
 */
export function roomToTVSnapshot(
  input: RoomToTVSnapshotInput,
): TVSnapshot | null {
  const { room, allQuestions, scores, answers } = input;
  if (!room.night) return null;

  const night = nightToTVNight(room.night, room.hostDefaultThemeKey);
  const games = room.games.map(gameRowToTVGame);
  const categories = room.categories.map(categoryRowToTVCategory);

  // Surface the live question even when the host's `useRoom` snapshot has
  // it but it isn't yet in the broader `allQuestions` cache (which is
  // populated separately on mount). Merge by id so the state machine can
  // always look up the live question by `snapshot.liveQuestionId`.
  const questionsById = new Map<string, QuestionRow>();
  for (const q of allQuestions) questionsById.set(q.id, q);
  if (room.currentQuestion) {
    questionsById.set(room.currentQuestion.id, room.currentQuestion);
  }
  if (room.lastResolvedQuestion) {
    questionsById.set(
      room.lastResolvedQuestion.id,
      room.lastResolvedQuestion,
    );
  }
  const questions = Array.from(questionsById.values()).map(questionRowToTVQuestion);

  // Current game pick mirrors useRoom's pickCurrentGame — useRoom already
  // sets room.currentGame; just surface its id.
  const currentGameId = room.currentGame?.id ?? null;

  const liveQuestionId = room.currentQuestion?.id ?? null;
  // Target = the question the TV is "pointing at" right now. Live wins; if
  // nothing is live but a question just resolved, point at that.
  const targetQuestionId =
    liveQuestionId ??
    room.lastResolvedQuestion?.id ??
    null;

  const tvPlayerKeys = room.tvPlayerKeys ?? {};
  const playerNameByRawId = new Map(
    filterActivePlayers(room.players).map((player) => [player.id, player.display_name] as const),
  );
  const players = filterActivePlayers(room.players).flatMap((player) => {
    const tvPlayerKey = tvPlayerKeys[player.id];
    return tvPlayerKey ? [playerRowToTVPlayer(player, tvPlayerKey)] : [];
  });

  const tvScores: TVScore[] = scores
    .filter(
      (s): s is GameScoreRow & { player_id: string; display_name: string } =>
        s.player_id !== null && s.display_name !== null,
    )
    .flatMap((s) => {
      const tvPlayerKey = tvPlayerKeys[s.player_id];
      return tvPlayerKey
        ? [{
            player_key: tvPlayerKey,
            display_name: s.display_name,
            score: Number(s.score ?? 0),
            correct_count: Number(s.correct_count ?? 0),
            answered_count: Number(s.answered_count ?? 0),
            fastest_correct_ms: s.fastest_correct_ms,
          }]
        : [];
    })
    .sort((a, b) => b.score - a.score);

  // Only surface answer rows that belong to the target question. The host's
  // subscription guarantees this in practice, but we defend so a stale row
  // can't leak into the reveal frame.
  const liveAnswers: TVAnswer[] = targetQuestionId
    ? answers
        .filter((a) => a.question_id === targetQuestionId)
        .flatMap((a) => {
          const tvPlayerKey = tvPlayerKeys[a.player_id];
          return tvPlayerKey
            ? [{
                question_id: a.question_id,
                player_key: tvPlayerKey,
                player_name: playerNameByRawId.get(a.player_id) ?? "—",
                ms_to_lock: Number(a.ms_to_lock ?? 0),
                is_correct: a.is_correct,
                chosen_index: a.chosen_index,
              }]
            : [];
        })
        .sort((a, b) => a.ms_to_lock - b.ms_to_lock)
    : [];

  // Reveals history is heavy on the snapshot route (last 50 rows) but the
  // TV state machine only reads two things from it:
  //   - `reveals[0]` (unused in the current machine; safe to omit)
  //   - `reveals.find(r => r.event === 'resolve')` to derive `stickyReveal`
  // So we synthesize a single resolve entry whenever `lastResolvedQuestion`
  // is set (which is exactly the condition that should trigger sticky
  // reveal). When useRoom has a fresher `currentReveal`, prefer that row
  // because it carries the real timestamp and metadata.
  const reveals: TVReveal[] = [];
  if (room.lastResolvedQuestion) {
    const baseGameId =
      revealGameIdFor(room, room.lastResolvedQuestion) ??
      room.currentGame?.id ??
      "";
    reveals.push({
      id: room.currentReveal?.id ?? `synthetic:${room.lastResolvedQuestion.id}`,
      gameId:
        room.currentReveal?.game_id ??
        baseGameId,
      questionId: room.lastResolvedQuestion.id,
      event: "resolve",
      occurredAt:
        room.currentReveal?.occurred_at ??
        room.lastResolvedQuestion.finished_at ??
        new Date().toISOString(),
      metadata:
        (room.currentReveal?.metadata as Record<string, unknown> | null) ??
        null,
    });
  } else if (room.currentReveal) {
    reveals.push(revealRowToTVReveal(room.currentReveal));
  }

  return {
    night,
    games,
    currentGameId,
    categories,
    questions,
    liveQuestionId,
    targetQuestionId,
    players,
    scores: tvScores,
    liveAnswers,
    reveals,
  };
}

// ─── pure row converters ──────────────────────────────────────────────────

function nightToTVNight(
  n: NonNullable<RoomSnapshot["night"]>,
  hostDefaultThemeKey: string | null,
): TVSnapshot["night"] {
  return {
    id: n.id,
    venueName: n.venue_name,
    themeKey: n.theme_key,
    hostDefaultThemeKey,
    roomCode: n.room_code,
    openedAt: n.opened_at,
    closedAt: n.closed_at,
    scheduledAt: n.scheduled_at,
    isLocked: n.is_locked,
    roomMagicEnabled: n.room_magic_enabled,
  };
}

function gameRowToTVGame(g: GameRow): TVGame {
  return {
    id: g.id,
    gameNo: g.game_no,
    state: g.state,
    startedAt: g.started_at,
    endedAt: g.ended_at,
    categoryCount: g.category_count,
    questionCount: g.question_count,
  };
}

function categoryRowToTVCategory(c: CategoryRow): TVCategory {
  return {
    id: c.id,
    gameId: c.game_id,
    name: c.name,
    topic: c.topic,
    position: c.position,
    color: c.color,
    state: c.state,
  };
}

function questionRowToTVQuestion(q: QuestionRow): TVQuestionShape {
  return {
    id: q.id,
    categoryId: q.category_id,
    pointValue: q.point_value,
    prompt: q.prompt,
    options: q.options,
    correctIndex: q.correct_index,
    imageUrl: q.image_url,
    factBlurb: q.fact_blurb,
    playedAt: q.played_at,
    finishedAt: q.finished_at,
    isPicked: q.is_picked,
  };
}

function playerRowToTVPlayer(p: PlayerRow, tvPlayerKey: string): TVPlayer {
  return {
    id: tvPlayerKey,
    displayName: p.display_name,
    joinedAt: p.joined_at,
    lastSeenAt: p.last_seen_at,
  };
}

function revealRowToTVReveal(r: RevealRow): TVReveal {
  return {
    id: r.id,
    gameId: r.game_id,
    questionId: r.question_id,
    event: r.event,
    occurredAt: r.occurred_at,
    metadata: r.metadata as Record<string, unknown> | null,
  };
}

function filterActivePlayers(rows: PlayerRow[]): PlayerRow[] {
  // useRoom already filters removed_at; we keep this here as a defence in
  // case a soft-removed row sneaks in via realtime UPDATE before the
  // applyRow filter catches it.
  return rows.filter((p) => p.removed_at === null);
}

function revealGameIdFor(
  room: RoomSnapshot,
  question: QuestionRow,
): string | null {
  const cat = room.categories.find((c) => c.id === question.category_id);
  if (!cat) return null;
  return cat.game_id;
}
