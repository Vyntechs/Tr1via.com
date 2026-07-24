// Client wrapper for /host/phone/[nightId].
//
// Subscribes to the room via useRoom() and renders the private host command
// center. Owns reveal/end-early/undo POSTs. Between questions the phone uses
// the same explicit board-picking model as the laptop.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoom } from "@/lib/hooks/useRoom";
import { useTimer } from "@/lib/hooks/useTimer";
import { useAllLockedAutoReveal } from "@/lib/hooks/useAllLockedAutoReveal";
import { deriveAllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";
import { rankScores } from "@/lib/game/rankScores";
import { useRoomFallback } from "@/lib/room/roomFallbackStore";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  HostAnswerResult,
  HostBetweenGames,
  HostVenueMonitor,
  HostPhoneUpcoming,
  HostPhoneLive,
  HostScores,
} from "@/components/host";
import { HostCommandCenter, type HostSection } from "@/components/host/HostCommandCenter";
import { HostPhoneBoard } from "@/components/host/HostPhoneBoard";
import { HostGameReady, type HostPreflight } from "@/components/host/HostGameReady";
import { Eyebrow, ThemeProvider, useTheme } from "@/components/system";
import { deriveHostStage, type HostStage } from "@/lib/host/gameConsole";
import type { AnswerRow, GameScoreRow, QuestionRow } from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";
import { readableForeground } from "@/lib/theme/contrast";
import { fetchJsonWithRetry } from "@/lib/realtime/fetchWithRetry";
import { BOOTSTRAP_TIMEOUT_MS } from "@/lib/realtime/readTimeout";
import type { HostLiveProjection } from "@/lib/live-answer/contracts";
import { useGameDelivery } from "@/lib/hooks/useGameDelivery";
import type { HostDeliveryReceipt } from "@/components/host/HostGameStatus";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";

const UNDO_WINDOW_MS = 2_000;

export interface HostPhoneClientProps {
  nightId: string;
  roomCode: string;
  hostName: string;
  themeKey?: ThemeKey;
}

export function HostPhoneClient({
  nightId,
  roomCode,
  hostName,
  themeKey,
}: HostPhoneClientProps) {
  const room = useRoom({ roomCode, audience: "host" });
  const [directAllQuestions, setDirectAllQuestions] = useState<QuestionRow[]>([]);
  const [directAnswers, setDirectAnswers] = useState<AnswerRow[]>([]);
  const [directScoreSnapshot, setDirectScoreSnapshot] = useState<{
    gameId: string;
    eligibilityKey: string;
    rows: GameScoreRow[];
  } | null>(null);
  const [preferredDirectScoreGameId, setPreferredDirectScoreGameId] = useState<string | null>(null);
  const { backupMode, payload: fallbackPayload } = useRoomFallback();
  const isResilient = room.night?.answer_engine === "resilient_v1";
  const authoritativeLive: HostLiveProjection | null = useMemo(
    () =>
      isResilient &&
      room.live?.runId === room.night?.current_run_id
        ? room.live ?? null
        : null,
    [isResilient, room.live, room.night?.current_run_id],
  );
  const resolvedCategoryForAnswers = room.lastResolvedQuestion
    ? room.categories.find((category) => category.id === room.lastResolvedQuestion?.category_id) ?? null
    : null;
  const resolvedQuestionGameForAnswers = resolvedCategoryForAnswers
    ? room.games.find((game) => game.id === resolvedCategoryForAnswers.game_id) ?? null
    : null;
  const resolvedBelongsToCurrentLiveGame = Boolean(
    room.lastResolvedQuestion &&
    room.currentGame?.state === "live" &&
    resolvedQuestionGameForAnswers?.id === room.currentGame.id,
  );
  const answerTargetId = room.currentQuestion?.id ??
    (resolvedBelongsToCurrentLiveGame ? room.lastResolvedQuestion?.id ?? null : null);
  const sourceQuestions =
    backupMode && fallbackPayload ? fallbackPayload.allQuestions : directAllQuestions;
  const allQuestions = useMemo(
    () =>
      sourceQuestions.map((question) => {
        if (question.id === room.currentQuestion?.id) {
          return { ...question, played_at: room.currentQuestion.played_at };
        }
        if (
          !room.currentQuestion &&
          room.lastBroadcast?.event === "undo" &&
          question.id === room.lastBroadcast.questionId
        ) {
          return { ...question, played_at: null, finished_at: null };
        }
        return question;
      }),
    [room.currentQuestion, room.lastBroadcast, sourceQuestions],
  );
  const answers = useMemo(
    () => {
      if (!answerTargetId) return [];
      if (isResilient) {
        return (room.liveAnswers ?? []).filter(
          (answer) => answer.question_id === answerTargetId,
        );
      }
      const source = backupMode && fallbackPayload
        ? fallbackPayload.liveAnswers
        : directAnswers;
      return source.filter((answer) => answer.question_id === answerTargetId);
    },
    [answerTargetId, backupMode, directAnswers, fallbackPayload, isResilient, room.liveAnswers],
  );
  const [selection, setSelection] = useState<{
    questionId: string;
    gameId: string;
    contextKey: string;
  } | null>(null);
  const [navigation, setNavigation] = useState<{
    section: HostSection;
    contextKey: string;
  } | null>(null);
  const [dismissedResultKey, setDismissedResultKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<HostPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  // Pull all picked questions for the current game (so we can stage the
  // next one).
  useEffect(() => {
    if (room.games.length === 0) return;
    let cancelled = false;
    const gameIds = room.games.map((g) => g.id);
    const supa = getSupabaseBrowser();
    void (async () => {
      const { data: catData } = await supa
        .from("categories")
        .select("id")
        .in("game_id", gameIds);
      const catIds = ((catData ?? []) as Array<{ id: string }>).map((c) => c.id);
      if (catIds.length === 0) return;
      const { data: qData } = await supa
        .from("questions")
        .select("*")
        .in("category_id", catIds)
        .eq("is_picked", true);
      if (cancelled) return;
      const rows = (qData as QuestionRow[] | null) ?? [];
      setDirectAllQuestions(
        rows.map((question) =>
          question.id === room.currentQuestion?.id
            ? { ...question, played_at: room.currentQuestion.played_at }
            : question,
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [room.games, room.currentQuestion]);

  // Subscribe to the live or current-game resolved question. The latter is
  // needed for result math; game ownership above prevents stale Game 1 data
  // from becoming Game 2's result.
  useEffect(() => {
    if (isResilient || !answerTargetId) return;
    const targetId = answerTargetId;
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supa
        .from("answers")
        .select("*")
        .eq("question_id", targetId);
      if (cancelled) return;
      setDirectAnswers(((data as AnswerRow[] | null) ?? []));
    }
    void load();
    const channel = supa
      .channel(`host-phone-answers:${targetId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `question_id=eq.${targetId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [answerTargetId, isResilient]);

  const activePlayerIdSignature = useMemo(
    () => room.players.map((player) => player.id).sort().join(","),
    [room.players],
  );

  const fetchDirectScores = useCallback(async (gameId: string) => {
    const { data, error } = await getSupabaseBrowser()
      .from("game_scores")
      .select("*")
      .eq("game_id", gameId)
      .order("score", { ascending: false });
    if (error) throw new Error(error.message ?? "could not refresh scores");
    return (data as GameScoreRow[] | null) ?? [];
  }, []);

  useEffect(() => {
    if (isResilient) return;
    const gameId = room.currentGame?.id;
    if (!gameId) return;
    const activeGameId = gameId;
    const eligibilityKey = `${activeGameId}:${activePlayerIdSignature}`;
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      const rows = await fetchDirectScores(activeGameId).catch(() => null);
      if (cancelled) return;
      if (!rows) return;
      setDirectScoreSnapshot({
        gameId: activeGameId,
        eligibilityKey,
        rows,
      });
    }
    void load();
    const channel = supa
      .channel(`host-phone-scores:${activeGameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "answers" }, () => void load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adjustments", filter: `game_id=eq.${activeGameId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_participations", filter: `game_id=eq.${activeGameId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [activePlayerIdSignature, fetchDirectScores, isResilient, room.currentGame?.id]);

  const lastRevealAt =
    room.lastBroadcast?.event === "reveal"
      ? new Date(room.lastBroadcast.serverNow).getTime()
      : room.currentQuestion?.played_at
        ? new Date(room.currentQuestion.played_at).getTime()
        : null;
  const [clockMs, setClockMs] = useState(0);
  useEffect(() => {
    if (!lastRevealAt) return;
    const handle = setInterval(() => setClockMs(Date.now()), 250);
    return () => clearInterval(handle);
  }, [lastRevealAt]);
  const canUndo =
    lastRevealAt !== null &&
    (clockMs === 0 || clockMs - lastRevealAt < UNDO_WINDOW_MS);

  // `pickCurrentGame` intentionally holds the just-completed game during an
  // intermission. The private host controller instead advances to the next
  // unfinished round so the host can start Game 2 from this same surface.
  const controlGame = useMemo(
    () =>
      room.games.find((game) => game.state === "live") ??
      room.games.find((game) => game.state !== "done") ??
      [...room.games]
        .filter((game) => game.state === "done")
        .sort((a, b) => b.game_no - a.game_no)[0] ??
      null,
    [room.games],
  );
  // Scores are always tied to the game the host is currently viewing. During
  // intermission that is deliberately Game 1, even though Game 2 is the next
  // lifecycle target. Never let a stale or future-game score snapshot bleed
  // into the standings or point-adjustment control.
  const scoreGameId = room.currentGame?.id ?? null;
  const scores = useMemo<GameScoreRow[]>(() => {
    if (!scoreGameId) return [];
    if (room.scoreGameId === scoreGameId) {
      return room.scores ?? [];
    }
    if (isResilient) return [];
    if (
      preferredDirectScoreGameId === scoreGameId &&
      directScoreSnapshot?.gameId === scoreGameId
    ) {
      return directScoreSnapshot.rows ?? [];
    }
    if (backupMode && fallbackPayload) {
      return fallbackPayload.scoreGameId === scoreGameId
        ? fallbackPayload.scores ?? []
        : [];
    }
    return directScoreSnapshot?.gameId === scoreGameId
      ? directScoreSnapshot.rows ?? []
      : [];
  }, [backupMode, directScoreSnapshot, fallbackPayload, isResilient, preferredDirectScoreGameId, room.scoreGameId, room.scores, scoreGameId]);
  const scoreGame = useMemo(
    () => room.games.find((game) => game.id === scoreGameId) ?? null,
    [room.games, scoreGameId],
  );
  const controlCategories = useMemo(
    () =>
      room.categories
        .filter((category) => category.game_id === controlGame?.id)
        .sort((a, b) => a.position - b.position),
    [controlGame?.id, room.categories],
  );
  const controlCategoryIds = useMemo(
    () => new Set(controlCategories.map((category) => category.id)),
    [controlCategories],
  );
  const controlQuestions = useMemo(
    () =>
      allQuestions.filter(
        (question) =>
          controlCategoryIds.has(question.category_id) && question.is_picked,
      ),
    [allQuestions, controlCategoryIds],
  );
  const unplayedControlQuestions = useMemo(
    () =>
      controlQuestions
        .filter(
          (question) =>
            controlGame?.state !== "done" &&
            !question.played_at,
        )
        .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0)),
    [controlGame?.state, controlQuestions],
  );

  const contextKey = [
    controlGame?.id ?? "no-game",
    room.currentQuestion?.id ?? "idle",
    room.lastBroadcast?.event ?? "snapshot",
    room.lastBroadcast?.questionId ?? "no-question",
    room.lastBroadcast?.serverNow ?? "no-revision",
  ].join(":");
  const stagedQuestion =
    selection &&
    selection.gameId === controlGame?.id &&
    selection.contextKey === contextKey
    ? unplayedControlQuestions.find((question) => question.id === selection.questionId) ?? null
    : null;
  const activeSection = navigation?.contextKey === contextKey
    ? navigation.section
    : "board";
  const navigate = (section: HostSection) => setNavigation({ section, contextKey });

  // Live timer for the question.
  const timer = useTimer({
    revealedAtMs: room.currentQuestion?.played_at
      ? new Date(room.currentQuestion.played_at).getTime()
      : null,
    serverNowMs: room.lastBroadcast
      ? new Date(room.lastBroadcast.serverNow).getTime()
      : null,
    themeKey,
  });

  // Action handlers.
  async function reveal(questionId: string) {
    if (
      !controlGame ||
      !unplayedControlQuestions.some((question) => question.id === questionId)
    ) return;
    setBusy(true);
    setError(null);
    try {
      let startedControl: ResilientControl | null = null;
      if (controlGame.state === "draft" || controlGame.state === "ready") {
        startedControl = await startGame(controlGame.id);
      }
      const resilientControl = isResilient
        ? startedControl ?? requireResilientControl(authoritativeLive, room.night?.current_run_id)
        : null;
      const res = await fetch(`/api/games/${controlGame.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          resilientControl
            ? {
                questionId,
                runId: resilientControl.runId,
                commandId: freshCommandId(),
                expectedControlRevision: resilientControl.controlRevision,
              }
            : { questionId },
        ),
      });
      if (resilientControl) {
        await requireAppliedCommand(res, {
          eventKinds: ["play_opened"],
          runId: resilientControl.runId,
          gameId: controlGame.id,
          questionId,
        });
      } else {
        await requireOk(res, "reveal failed");
      }
      setSelection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reveal failed.");
      if (isResilient) room.requestRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  async function showStandings(questionId: string, resolvedResultKey: string) {
    if (!room.currentGame || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${room.currentGame.id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      await requireOk(response, "could not show standings");
      setDismissedResultKey(resolvedResultKey);
      setSelection(null);
      setNavigation(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not show standings.");
    } finally {
      setBusy(false);
    }
  }

  async function endEarly(requireAllLocked = false): Promise<boolean> {
    if (!room.currentGame || !room.currentQuestion) return false;
    setBusy(true);
    setError(null);
    try {
      const resilientPlay = isResilient
        ? requireResilientPlay(
            authoritativeLive,
            room.night?.current_run_id,
            room.currentGame.id,
            room.currentQuestion.id,
          )
        : null;
      const res = await fetch(`/api/games/${room.currentGame.id}/end-early`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          resilientPlay
            ? {
                playId: resilientPlay.playId,
                runId: resilientPlay.runId,
                commandId: freshCommandId(),
                expectedControlRevision: resilientPlay.controlRevision,
              }
            : {
                questionId: room.currentQuestion.id,
                ...(requireAllLocked ? { requireAllLocked: true } : {}),
              },
        ),
      });
      if (resilientPlay) {
        await requireAppliedCommand(res, {
          eventKinds: ["final_window_started", "play_resolved"],
          runId: resilientPlay.runId,
          playId: resilientPlay.playId,
        });
      } else if (!res.ok && requireAllLocked && res.status === 409) {
        return false;
      } else {
        await requireOk(res, "end-early failed");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "End-early failed.");
      if (isResilient) room.requestRefresh?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!room.currentGame) return;
    setBusy(true);
    setError(null);
    try {
      const resilientPlay = isResilient
        ? requireResilientPlay(
            authoritativeLive,
            room.night?.current_run_id,
            room.currentGame.id,
            room.currentQuestion?.id ?? null,
          )
        : null;
      const res = await fetch(`/api/games/${room.currentGame.id}/undo`, resilientPlay
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              playId: resilientPlay.playId,
              runId: resilientPlay.runId,
              commandId: freshCommandId(),
              expectedControlRevision: resilientPlay.controlRevision,
            }),
          }
        : { method: "POST" });
      if (resilientPlay) {
        await requireAppliedCommand(res, {
          eventKinds: ["play_undone"],
          runId: resilientPlay.runId,
          playId: resilientPlay.playId,
        });
      } else {
        await requireOk(res, "undo failed");
      }
      setSelection(null);
      setNavigation(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed.");
      if (isResilient) room.requestRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  async function runLifecycle(path: string, gameId?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const resilientControl = isResilient && gameId
        ? requireResilientControl(authoritativeLive, room.night?.current_run_id)
        : null;
      const res = await fetch(path, resilientControl
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              runId: resilientControl.runId,
              commandId: freshCommandId(),
              expectedControlRevision: resilientControl.controlRevision,
            }),
          }
        : { method: "POST" });
      if (resilientControl) {
        await requireAppliedCommand(res, {
          eventKinds: ["game_ended"],
          runId: resilientControl.runId,
          gameId,
        });
      } else {
        await requireOk(res, "game control failed");
      }
      setConfirmingEnd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Game control failed.");
      if (isResilient) room.requestRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  async function startGame(gameId: string): Promise<ResilientControl | null> {
    let request: RequestInit = { method: "POST" };
    if (isResilient) {
      const runId = room.night?.current_run_id;
      const expectedControlRevision = room.night?.control_revision;
      if (
        !runId ||
        !Number.isInteger(expectedControlRevision) ||
        (expectedControlRevision ?? -1) < 0 ||
        typeof globalThis.crypto?.randomUUID !== "function"
      ) {
        throw new Error("Game control metadata is not ready. Refresh the game before starting.");
      }
      request = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          commandId: freshCommandId(),
          expectedControlRevision,
        }),
      };
    }

    const response = await fetch(`/api/games/${gameId}/start`, request);
    if (isResilient) {
      const applied = await requireAppliedCommand(response, {
        eventKinds: ["game_started"],
        runId: room.night?.current_run_id ?? "",
        gameId,
      });
      return { runId: applied.runId, controlRevision: applied.controlRevision };
    }
    await requireOk(response, "game control failed");
    return null;
  }

  async function runStartGame(gameId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await startGame(gameId);
      setConfirmingEnd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Game control failed.");
      if (isResilient) room.requestRefresh?.();
    } finally {
      setBusy(false);
    }
  }

  async function adjustPoints(playerId: string, delta: number, reason: string) {
    if (!scoreGameId || busy) throw new Error("Scores are still loading. Try again.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          gameId: scoreGameId,
          delta,
          reason: reason || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "adjust failed");
      }
      // A successful write is not enough: keep the modal pending until this
      // exact game's canonical score projection has been refreshed. This
      // prevents an adjustment in Game 1 from borrowing Game 2's standings.
      if (isResilient) {
        await room.requestRefresh?.();
      } else {
        const rows = await fetchDirectScores(scoreGameId);
        setDirectScoreSnapshot({
          gameId: scoreGameId,
          eligibilityKey: `${scoreGameId}:${activePlayerIdSignature}`,
          rows,
        });
        setPreferredDirectScoreGameId(scoreGameId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Point adjustment failed.");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Display state.
  const isLive = room.currentQuestion !== null;
  const playerCount = room.players.length;
  const lockedIds = new Set(answers.map((a) => a.player_id));
  const currentGame = controlGame;
  const directEligibilityKey = room.currentGame
    ? `${room.currentGame.id}:${activePlayerIdSignature}`
    : null;
  const eligibilityReadyKey =
    backupMode && fallbackPayload
      ? directEligibilityKey
      : directScoreSnapshot?.eligibilityKey ?? null;
  const legacyEligibleCount = useMemo(() => {
    if (!directEligibilityKey || eligibilityReadyKey !== directEligibilityKey) return null;
    const active = new Set(room.players.map((player) => player.id));
    return new Set(
      scores
        .map((row) => row.player_id)
        .filter((playerId): playerId is string => Boolean(playerId && active.has(playerId))),
    ).size;
  }, [directEligibilityKey, eligibilityReadyKey, room.players, scores]);
  const allLockedDecision = useMemo(() => {
    if (isResilient) {
      const play = authoritativeLive?.play;
      const coherent = Boolean(
        play &&
        play.gameId === room.currentGame?.id &&
        play.questionId === room.currentQuestion?.id &&
        (play.state === "accepting" || play.state === "all_in_hold"),
      );
      const eligibleCount = coherent ? authoritativeLive?.operations.eligibleCount ?? 0 : 0;
      const lockedCount = coherent ? authoritativeLive?.operations.confirmedCount ?? 0 : 0;
      return {
        eligibleCount,
        lockedCount,
        complete: coherent && eligibleCount > 0 && lockedCount === eligibleCount,
      };
    }
    return deriveAllLockedAutoRevealDecision({
      currentGameId: room.currentGame?.id ?? null,
      liveQuestionId: room.currentQuestion?.id ?? null,
      activePlayerIds: room.players.map((player) => player.id),
      scoreRows:
        directEligibilityKey && eligibilityReadyKey === directEligibilityKey
          ? scores
          : null,
      answers,
    });
  }, [answers, authoritativeLive, directEligibilityKey, eligibilityReadyKey, isResilient, room.currentGame?.id, room.currentQuestion?.id, room.players, scores]);
  useAllLockedAutoReveal({
    questionId: room.currentQuestion?.id ?? null,
    decision: allLockedDecision,
    onAutoReveal: () => endEarly(true),
  });
  const allGamesEnded = room.games.length > 0 && room.games.every((game) => game.state === "done");
  const game1 = room.games.find((game) => game.game_no === 1) ?? null;
  const game2 = room.games.find((game) => game.game_no === 2) ?? null;
  const finalControlGame = controlGame && (
    game2 ? controlGame.id === game2.id : controlGame.id === game1?.id
  );
  const finalGameExhausted = Boolean(
    finalControlGame &&
    controlGame?.state === "live" &&
    controlQuestions.length > 0 &&
    controlQuestions.every((question) => question.finished_at !== null),
  );
  const resolvedGame = resolvedQuestionGameForAnswers;
  const resultKey = resolvedBelongsToCurrentLiveGame && room.lastResolvedQuestion && resolvedGame
    ? `${resolvedGame.id}:${room.lastResolvedQuestion.id}:${room.lastResolvedQuestion.finished_at ?? "resolved"}`
    : null;
  const resultDismissed = resultKey !== null && dismissedResultKey === resultKey;
  const stage = deriveHostStage({
    game1: game1?.state ?? null,
    game2: game2?.state ?? null,
    currentGame: room.currentGame?.game_no ?? null,
    livePlay: room.currentQuestion?.id ?? null,
    lastResolve:
      room.lastResolvedQuestion && resolvedGame && !resultDismissed
        ? { id: room.lastResolvedQuestion.id, game: resolvedGame.game_no }
        : null,
    nightClosed: Boolean(room.night?.closed_at),
    stagedQuestion: stagedQuestion?.id ?? null,
    finalGameExhausted,
  });
  const deliveryRunId = authoritativeLive?.runId ?? null;
  const deliveryRoomRevision = authoritativeLive?.roomRevision ?? null;
  const deliveryControlRevision = authoritativeLive?.controlRevision ?? null;
  const deliveryPlayId = authoritativeLive?.playId ?? null;
  const deliveryCanonical = useMemo(
    () => deliveryRunId !== null &&
      deliveryRoomRevision !== null &&
      deliveryControlRevision !== null
      ? {
          runId: deliveryRunId,
          roomRevision: deliveryRoomRevision,
          controlRevision: deliveryControlRevision,
          playId: deliveryPlayId,
        }
      : null,
    [
      deliveryControlRevision,
      deliveryPlayId,
      deliveryRoomRevision,
      deliveryRunId,
    ],
  );
  const delivery = useGameDelivery({
    roomCode,
    canonical: deliveryCanonical,
    stageKey: stage.stage,
    enabled: isResilient,
  });
  const venueTVSnapshot = useMemo(
    () => roomToTVSnapshot({
      room,
      allQuestions,
      scores,
      allScores: room.allScores,
      answers,
    }),
    [allQuestions, answers, room, scores],
  );
  const isGame1Preflight =
    stage.stage === "game-ready" &&
    game1 !== null &&
    game1.started_at === null &&
    (game1.state === "draft" || game1.state === "ready");
  const fetchPreflight = useCallback(async (signal: AbortSignal) => {
    const payload = await fetchJsonWithRetry<unknown>(
      `/api/nights/${nightId}/preflight`,
      {
        attempts: 2,
        perAttemptTimeoutMs: Math.floor(BOOTSTRAP_TIMEOUT_MS / 2),
        signal,
      },
    );
    if (!isHostPreflight(payload)) throw new Error("invalid preflight response");
    return payload;
  }, [nightId]);

  useEffect(() => {
    if (!isGame1Preflight) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
    void fetchPreflight(controller.signal).then(
      (next) => {
        if (!cancelled) {
          setPreflight(next);
          setPreflightError(null);
        }
      },
      () => {
        if (!cancelled) setPreflightError("Could not check Game 1 readiness. Check the control connection and try again.");
      },
    ).finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchPreflight, isGame1Preflight]);

  const roundControls =
    isGame1Preflight ||
    stage.stage === "answer-result" ||
    stage.stage === "intermission" ||
    stage.stage === "finale"
      ? undefined
      : (
    <PhoneRoundControls
      themeKey={themeKey}
      gameNo={currentGame?.game_no ?? null}
      gameState={currentGame?.state ?? null}
      questionLive={isLive}
      busy={busy}
      confirmingEnd={confirmingEnd}
      allGamesEnded={allGamesEnded}
      onStart={() => currentGame && void runStartGame(currentGame.id)}
      onRequestEnd={() => setConfirmingEnd(true)}
      onCancelEnd={() => setConfirmingEnd(false)}
      onConfirmEnd={() => currentGame && void runLifecycle(`/api/games/${currentGame.id}/end`, currentGame.id)}
      onCloseNight={() => void runLifecycle(`/api/nights/${nightId}/close`)}
    />
  );

  let boardContent: React.ReactNode;
  if (isLive) {
    const liveCategory = room.categories.find((category) => category.id === room.currentQuestion?.category_id) ?? null;
    const livePlay = authoritativeLive?.play ?? null;
    const resilientOperations = isResilient &&
      livePlay?.gameId === room.currentGame?.id &&
      livePlay?.questionId === room.currentQuestion?.id
      ? authoritativeLive?.operations ?? null
      : null;
    boardContent = (
      <HostPhoneLive
        themeKey={themeKey}
        secondsRemaining={Math.max(0, Math.floor(timer.secondsRemaining))}
        lockedCount={resilientOperations?.confirmedCount ?? lockedIds.size}
        totalPlayers={resilientOperations?.eligibleCount ?? playerCount}
        categoryName={liveCategory?.name ?? "Question"}
        pointValue={room.currentQuestion?.point_value ?? (room.currentQuestion?.difficulty ?? 0) * 100}
        prompt={room.currentQuestion?.prompt ?? "Question in progress"}
        onEndEarly={() => void endEarly()}
        onUndo={() => void undo()}
        canUndo={canUndo}
        isEnding={busy}
      />
    );
  } else if (stage.stage === "answer-result" && room.lastResolvedQuestion && resultKey) {
    boardContent = (
      <HostAnswerResult
        themeKey={themeKey}
        question={room.lastResolvedQuestion}
        answers={answers}
        players={room.players}
        eligibleCount={
          isResilient &&
          authoritativeLive?.play?.questionId === room.lastResolvedQuestion.id
            ? authoritativeLive.play.eligibleCount
            : legacyEligibleCount
        }
        onReturnToBoard={() => void showStandings(room.lastResolvedQuestion!.id, resultKey)}
      />
    );
  } else if (stage.stage === "intermission") {
    boardContent = (
      <HostBetweenGames
        mode="intermission"
        standings={toHostBetweenStandings(scores)}
        onPrimary={game2 ? () => void runStartGame(game2.id) : undefined}
        busy={busy}
      />
    );
  } else if (stage.stage === "finale") {
    const mode = stage.primary === "present-winners"
      ? "present-winners"
      : stage.primary === "end-game"
        ? "finale"
        : "complete";
    const onPrimary = stage.primary === "present-winners" && controlGame
      ? () => void runLifecycle(`/api/games/${controlGame.id}/end`, controlGame.id)
      : stage.primary === "end-game"
        ? () => void runLifecycle(`/api/nights/${nightId}/close`)
        : undefined;
    boardContent = (
      <HostBetweenGames
        mode={mode}
        standings={toHostBetweenStandings(scores)}
        onPrimary={onPrimary}
        busy={busy}
      />
    );
  } else if (stagedQuestion) {
    const stagedCategory = controlCategories.find(
      (category) => category.id === stagedQuestion.category_id,
    );
    boardContent = (
      <HostPhoneUpcoming
        themeKey={themeKey}
        hostName={hostName}
        categoryName={stagedCategory?.name ?? "Category"}
        pointValue={stagedQuestion.point_value ?? stagedQuestion.difficulty * 100}
        prompt={stagedQuestion.prompt}
        options={stagedQuestion.options}
        correctIndex={stagedQuestion.correct_index}
        factBlurb={stagedQuestion.fact_blurb}
        imageUrl={stagedQuestion.image_url}
        imageAttribution={stagedQuestion.image_attribution}
        onReveal={() => void reveal(stagedQuestion.id)}
        onBack={() => setSelection(null)}
        isRevealing={busy}
      />
    );
  } else {
    boardContent = (
      <div style={{ padding: "2px 0 12px" }}>
        <HostPhoneBoard
          categories={controlCategories}
          questions={controlQuestions}
          selectedQuestionId={null}
          onSelect={(questionId) => {
            if (!controlGame || busy) return;
            setSelection({ questionId, gameId: controlGame.id, contextKey });
            navigate("board");
          }}
        />
        {controlCategories.length === 0 && (
          <p style={{ margin: "18px 0", color: "var(--ink-mid)", fontSize: 13 }}>
            Waiting for the next game board.
          </p>
        )}
      </div>
    );
  }

  const sectionContent = activeSection === "scores"
    ? (
      <HostScores
        gameNo={scoreGame?.game_no ?? null}
        scores={scores}
        onSubmitAdjustment={adjustPoints}
      />
    )
    : activeSection === "board" || activeSection === "tv"
    ? isGame1Preflight
      ? preflight
        ? (
          <HostGameReady
            roomCode={roomCode}
            preflight={preflight}
            onCheck={fetchPreflight}
            onStart={() => game1 && void runStartGame(game1.id)}
            isStarting={busy}
          />
        )
        : (
          <GameReadyBootstrap
            error={preflightError}
            onRetry={() => {
              const controller = new AbortController();
              setPreflightError(null);
              void fetchPreflight(controller.signal).then(setPreflight).catch(() => {
                setPreflightError("Could not check Game 1 readiness. Check the control connection and try again.");
              });
            }}
          />
        )
      : boardContent
    : (
      <HostSectionSummary
        section={activeSection}
        playerNames={room.players.map((player) => player.display_name)}
        scores={[]}
      />
    );
  const commandCenterPlay = authoritativeLive?.play ?? null;
  const commandCenterLockedCount = isResilient &&
    commandCenterPlay?.gameId === room.currentGame?.id &&
    commandCenterPlay?.questionId === room.currentQuestion?.id
    ? authoritativeLive?.operations.confirmedCount ?? 0
    : lockedIds.size;

  return (
    <PhoneCenter
      themeKey={themeKey}
      stage={stage.stage}
      active={activeSection}
      playerCount={playerCount}
      lockedCount={commandCenterLockedCount}
      delivery={delivery}
      onNavigate={navigate}
      controls={roundControls}
      venueMonitor={(
        <HostVenueMonitor
          snapshot={venueTVSnapshot}
          active={activeSection === "tv"}
          themeKey={themeKey}
          lastBroadcastRevealedAt={
            room.lastBroadcast?.event === "reveal"
              ? room.lastBroadcast.serverNow
              : null
          }
          lastBroadcastServerNow={room.lastBroadcast?.serverNow ?? null}
        />
      )}
    >
      {sectionContent}
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
    </PhoneCenter>
  );
}

function GameReadyBootstrap({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const { t } = useTheme();
  return (
    <section
      aria-label="Game Ready preflight"
      style={{
        margin: 14,
        padding: 18,
        border: `1px solid ${t.line}`,
        borderRadius: 16,
        background: t.surface,
        color: t.ink,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22 }}>Checking Game 1 readiness…</h1>
      <p role={error ? "alert" : "status"} style={{ color: error ? t.wrong : t.inkMid, fontSize: 13 }}>
        {error ?? "Checking the owned game, content, players, and control path."}
      </p>
      {error && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            minWidth: 48,
            minHeight: 48,
            padding: "0 16px",
            border: `1px solid ${t.line}`,
            borderRadius: 10,
            background: t.surfaceH,
            color: t.ink,
            font: "inherit",
            fontWeight: 800,
          }}
        >
          Try readiness check again
        </button>
      )}
    </section>
  );
}

function isHostPreflight(value: unknown): value is HostPreflight {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HostPreflight>;
  const checks = candidate.checks;
  const content = candidate.content;
  return (
    Boolean(checks) &&
    (checks?.content === "ready" || checks?.content === "invalid") &&
    (checks?.tv === "unknown" || checks?.tv === "missing") &&
    checks?.players === "unknown" &&
    checks?.network === "control-path-healthy" &&
    (checks?.controls === "ready" || checks?.controls === "unavailable") &&
    typeof candidate.canStart === "boolean" &&
    (typeof candidate.startReason === "string" || candidate.startReason === null) &&
    typeof candidate.checkedAt === "string" &&
    Number.isFinite(Date.parse(candidate.checkedAt)) &&
    typeof candidate.elapsedMs === "number" &&
    Number.isFinite(candidate.elapsedMs) &&
    typeof candidate.playerCount === "number" &&
    Number.isInteger(candidate.playerCount) &&
    candidate.playerCount >= 0 &&
    Boolean(content) &&
    (typeof content?.gameId === "string" || content?.gameId === null) &&
    typeof content?.categoryCount === "number" &&
    typeof content?.expectedCategoryCount === "number" &&
    typeof content?.pickedQuestionCount === "number" &&
    typeof content?.expectedQuestionCount === "number" &&
    (typeof content?.reason === "string" || content?.reason === null)
  );
}

function toHostBetweenStandings(scores: GameScoreRow[]) {
  return rankScores(scores).flatMap(({ row, rank }) =>
    row.player_id && row.display_name
      ? [{ playerId: row.player_id, name: row.display_name, score: row.score ?? 0, rank }]
      : [],
  );
}

interface PhoneCenterProps {
  children: React.ReactNode;
  controls?: React.ReactNode;
  themeKey?: ThemeKey;
  stage: HostStage;
  active: HostSection;
  playerCount: number;
  lockedCount: number;
  delivery: HostDeliveryReceipt;
  onNavigate: (section: HostSection) => void;
  venueMonitor: React.ReactNode;
}

function PhoneCenter({ themeKey, ...props }: PhoneCenterProps) {
  return (
    <ThemeProvider themeKey={themeKey ?? "house"}>
      <PhoneCenterInner {...props} />
    </ThemeProvider>
  );
}

function PhoneCenterInner({
  children,
  controls,
  stage,
  active,
  playerCount,
  lockedCount,
  delivery,
  onNavigate,
  venueMonitor,
}: Omit<PhoneCenterProps, "themeKey">) {
  return (
    <div data-host-mobile-surface="true" data-host-full-bleed="true">
      <HostCommandCenter
        stage={stage}
        active={active}
        playerCount={playerCount}
        lockedCount={lockedCount}
        delivery={delivery}
        onNavigate={onNavigate}
        venueMonitor={venueMonitor}
      >
        <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
          {controls}
          <div style={{ flex: 1, minHeight: 0, paddingTop: 12 }}>{children}</div>
        </div>
      </HostCommandCenter>
    </div>
  );
}

function HostSectionSummary({
  section,
  playerNames,
  scores,
}: {
  section: Exclude<HostSection, "board" | "tv">;
  playerNames: string[];
  scores: Array<{ name: string; score: number }>;
}) {
  const { t } = useTheme();
  const panelStyle: React.CSSProperties = {
    padding: 16,
    border: `1px solid ${t.line}`,
    borderRadius: 14,
    background: t.surface,
    color: t.ink,
  };

  const isPlayers = section === "players";
  const rows = isPlayers
    ? playerNames.map((name) => ({ name, detail: "Joined" }))
    : scores.map((row) => ({ name: row.name, detail: `${row.score} points` }));
  return (
    <section style={panelStyle}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{isPlayers ? "Players" : "Scores"}</h2>
      {rows.length === 0 ? (
        <p style={{ color: t.inkMid, fontSize: 13 }}>
          {isPlayers ? "No players have joined this game yet." : "Scores appear after play begins."}
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {rows.map((row) => (
            <li key={row.name} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>{row.name}</span>
              <span style={{ color: t.inkMid }}>{row.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface PhoneRoundControlsProps {
  themeKey?: ThemeKey;
  gameNo: number | null;
  gameState: string | null;
  questionLive: boolean;
  busy: boolean;
  confirmingEnd: boolean;
  allGamesEnded: boolean;
  onStart: () => void;
  onRequestEnd: () => void;
  onCancelEnd: () => void;
  onConfirmEnd: () => void;
  onCloseNight: () => void;
}

function PhoneRoundControls({ themeKey, ...props }: PhoneRoundControlsProps) {
  return (
    <ThemeProvider themeKey={themeKey ?? "house"}>
      <PhoneRoundControlsInner {...props} />
    </ThemeProvider>
  );
}

function PhoneRoundControlsInner({
  gameNo,
  gameState,
  questionLive,
  busy,
  confirmingEnd,
  allGamesEnded,
  onStart,
  onRequestEnd,
  onCancelEnd,
  onConfirmEnd,
  onCloseNight,
}: Omit<PhoneRoundControlsProps, "themeKey">) {
  const { t } = useTheme();
  const startable = gameNo !== null && (gameState === "draft" || gameState === "ready");
  const canEnd = gameNo !== null && gameState === "live" && !questionLive;

  return (
    <div
      data-testid="host-phone-round-controls"
      style={{
        padding: "max(10px, env(safe-area-inset-top)) 14px 10px",
        borderBottom: `1px solid ${t.line}`,
        background: t.paper,
        color: t.ink,
        display: "flex",
        flexWrap: confirmingEnd ? "wrap" : undefined,
        alignItems: "center",
        gap: 10,
        minHeight: 56,
        boxSizing: "border-box",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ flex: 1, flexBasis: confirmingEnd ? "100%" : undefined, minWidth: 0 }}>
        <Eyebrow color={t.accent} size={9}>
          {gameNo ? `GAME ${gameNo}` : "GAME CONTROL"}
        </Eyebrow>
        <div style={{ marginTop: 2, fontSize: 12, color: t.inkMid, fontWeight: 600 }}>
          {questionLive ? "Question live" : gameState === "done" ? "Round complete" : gameState ?? "Waiting"}
        </div>
      </div>

      {confirmingEnd ? (
        <>
          <button type="button" onClick={onCancelEnd} disabled={busy} style={roundButton(t, false)}>
            Keep playing
          </button>
          <button type="button" onClick={onConfirmEnd} disabled={busy} style={roundButton(t, true)}>
            {busy ? "Ending…" : `Confirm end Game ${gameNo}`}
          </button>
        </>
      ) : startable ? (
        <button type="button" onClick={onStart} disabled={busy} style={roundButton(t, true)}>
          {busy ? "Starting…" : `Start Game ${gameNo}`}
        </button>
      ) : canEnd ? (
        <button type="button" onClick={onRequestEnd} disabled={busy} style={roundButton(t, false)}>
          End Game {gameNo}
        </button>
      ) : allGamesEnded ? (
        <button type="button" onClick={onCloseNight} disabled={busy} style={roundButton(t, true)}>
          {busy ? "Closing…" : "End the night"}
        </button>
      ) : null}
    </div>
  );
}

function roundButton(t: ReturnType<typeof useTheme>["t"], primary: boolean): React.CSSProperties {
  return {
    minHeight: 48,
    padding: "8px 12px",
    borderRadius: 10,
    border: primary ? "none" : `1px solid ${t.line}`,
    background: primary ? t.accent : "transparent",
    color: primary ? readableForeground(t.accent) : t.ink,
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    flex: 1,
  };
}

interface ResilientControl {
  runId: string;
  controlRevision: number;
}

interface ResilientPlayControl extends ResilientControl {
  playId: string;
}

interface AppliedCommandResult extends ResilientControl {
  applied: true;
  eventKind: string;
  gameId?: string;
  playId?: string;
  questionId?: string;
}

function freshCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Game control metadata is not ready. Refresh the game and try again.");
  }
  return globalThis.crypto.randomUUID();
}

function requireResilientControl(
  live: HostLiveProjection | null,
  currentRunId: string | null | undefined,
): ResilientControl {
  if (
    !live ||
    !currentRunId ||
    live.runId !== currentRunId ||
    !Number.isInteger(live.controlRevision) ||
    live.controlRevision < 0
  ) {
    throw new Error("Game control metadata is not ready. Refreshing the game before sending this command.");
  }
  return { runId: live.runId, controlRevision: live.controlRevision };
}

function requireResilientPlay(
  live: HostLiveProjection | null,
  currentRunId: string | null | undefined,
  gameId: string,
  questionId: string | null,
): ResilientPlayControl {
  const control = requireResilientControl(live, currentRunId);
  if (
    !live?.play ||
    !questionId ||
    live.play.gameId !== gameId ||
    live.play.questionId !== questionId ||
    live.play.state === "undone"
  ) {
    throw new Error("Game control metadata is not ready. Refreshing the game before sending this command.");
  }
  return { ...control, playId: live.play.playId };
}

async function requireOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? fallback);
}

async function requireAppliedCommand(
  response: Response,
  expected: {
    eventKinds: string[];
    runId: string;
    gameId?: string;
    playId?: string;
    questionId?: string;
  },
): Promise<AppliedCommandResult> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Game command failed.");
  }
  if (body.applied !== true) {
    const reason = typeof body.code === "string" ? body.code.replaceAll("_", " ") : "not applied";
    throw new Error(`Game changed before this command could be applied (${reason}). Refreshing game state.`);
  }
  if (
    typeof body.eventKind !== "string" ||
    !expected.eventKinds.includes(body.eventKind) ||
    body.runId !== expected.runId ||
    !Number.isInteger(body.controlRevision)
  ) {
    throw new Error("Game returned an unexpected control result. Refreshing game state.");
  }
  if (expected.gameId && body.gameId !== expected.gameId) {
    throw new Error("Game returned an unexpected control result. Refreshing game state.");
  }
  if (expected.playId && body.playId !== expected.playId) {
    throw new Error("Game returned an unexpected control result. Refreshing game state.");
  }
  if (
    expected.questionId &&
    body.questionId !== undefined &&
    body.questionId !== expected.questionId
  ) {
    throw new Error("Game returned an unexpected control result. Refreshing game state.");
  }
  // A haptic is earned only after the server's canonical command result has
  // passed every ancestry/revision check above. Unsupported devices and
  // reduced-motion preferences stay text-only.
  if (
    typeof window !== "undefined" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches &&
    typeof navigator.vibrate === "function"
  ) {
    navigator.vibrate(12);
  }
  return body as unknown as AppliedCommandResult;
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        left: 12,
        zIndex: 50,
        padding: "12px 16px",
        borderRadius: 10,
        background: "rgba(156,47,47,.95)",
        color: "#FFF",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        fontWeight: 500,
        display: "flex",
        gap: 12,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          minWidth: 48,
          minHeight: 48,
          background: "transparent",
          color: "#FFF",
          border: "1px solid rgba(255,255,255,.4)",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0,
          boxSizing: "border-box",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
