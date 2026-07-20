// Client wrapper for /host/live/[nightId].
//
// Owns:
//   - useRoom(roomCode): the snapshot of nights, games, categories,
//     players, current question + reveal.
//   - useTimer (indirect via tvSnapshot): derives secondsRemaining from
//     the live question's played_at + serverNow inside the TV state machine.
//   - A subscription to `answers` rows for the current question so we can
//     show the lock-in count + the per-player locked flag in real time.
//   - Action handlers: reveal (POST /api/games/[id]/reveal), undo (POST
//     /api/games/[id]/undo), end-early (POST /api/games/[id]/end-early),
//     start (POST /api/games/[id]/start), end (POST /api/games/[id]/end),
//     adjust (POST /api/adjustments), remove player (DELETE /api/players/[id]),
//     add latecomer (POST /api/nights/[id]/players). The mid-game edits live
//     in dedicated modal components so the live console stays uncluttered.
//
// The host laptop IS the venue TV (HDMI-mirrored), so the wrapper translates
// the host's existing useRoom snapshot — plus the auxiliary state already
// loaded on this page (allQuestions, scores, answers) — into the TV's
// expected shape and feeds it to HostLiveConsole. HostLiveConsole renders
// the TV state machine fullscreen with a thin control strip.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRoom, type BroadcastTag } from "@/lib/hooks/useRoom";
import { useRoomFallback } from "@/lib/room/roomFallbackStore";
import { hostRecoverySeed } from "@/lib/room/hostRecoverySeed";
import type { RoomFallbackPayload } from "@/lib/room/roomSnapshotPayload";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  AddLatecomerModal,
  AdjustPointsModal,
  HostLiveConsole,
  type HostLivePlayer,
} from "@/components/host";
import { HostConnectionBanner } from "@/components/host/HostConnectionBanner";
import type {
  AnswerRow,
  QuestionRow,
  GameRow,
  GameScoreRow,
  PlayerRow,
} from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";
import { WELCOME_OVERLAY_DURATION_MS, PyrotechnicsBeatConductor } from "@/components/system";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { playWelcomeChime } from "@/lib/audio/welcomeChime";
import type { TVLobbyWelcomeEvent } from "@/components/tv";
import { deriveAllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";
import { useAllLockedAutoReveal } from "@/lib/hooks/useAllLockedAutoReveal";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { HostPhoneClient } from "@/app/host/phone/[nightId]/HostPhoneClient";

const UNDO_WINDOW_MS = 2_000;

export interface HostLiveConsoleClientProps {
  nightId: string;
  roomCode: string;
  venueName: string;
  hostName: string;
  themeKey: string;
}

export function HostLiveConsoleClient(props: HostLiveConsoleClientProps) {
  const compact = useMediaQuery("(max-width: 860px)");

  if (compact) {
    return (
      <HostPhoneClient
        nightId={props.nightId}
        roomCode={props.roomCode}
        hostName={props.hostName}
        themeKey={props.themeKey as ThemeKey}
      />
    );
  }

  return <DesktopHostLiveConsoleClient {...props} />;
}

function DesktopHostLiveConsoleClient({
  nightId,
  roomCode,
  venueName,
  themeKey,
}: HostLiveConsoleClientProps) {
  const room = useRoom({ roomCode, audience: "host" });
  const [directAllQuestions, setAllQuestions] = useState<QuestionRow[]>([]);
  const [directAnswers, setAnswers] = useState<AnswerRow[]>([]);
  const [directScores, setScores] = useState<GameScoreRow[]>([]);
  const [directScoresReadyForGameId, setDirectScoresReadyForGameId] =
    useState<string | null>(null);
  // Degraded network (Phase 2): useRoom is in backup mode and feeding `room`
  // from the server route; prefer that same route payload for the host's
  // auxiliary reads (board questions, scores, live answers) so the board +
  // lock counts stay live instead of emptying out. Direct subscriptions stay
  // mounted so they're warm when realtime recovers.
  const { backupMode, payload: fallbackPayload } = useRoomFallback();
  const allQuestions =
    backupMode && fallbackPayload ? fallbackPayload.allQuestions : directAllQuestions;
  const answers =
    backupMode && fallbackPayload ? fallbackPayload.liveAnswers : directAnswers;
  const scores =
    backupMode && fallbackPayload ? fallbackPayload.scores : directScores;
  const [lastRevealAt, setLastRevealAt] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState<HostLivePlayer | null>(null);
  const [addingLatecomer, setAddingLatecomer] = useState(false);
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activePlayerIdSignature = useMemo(
    () => [...room.players.map((p) => p.id)].sort().join(","),
    [room.players],
  );

  // ── host board freshness on WiFi recovery (#3) ───────────────────────
  // While degraded, the host reads from the route payload (kept current by the
  // ~5s poll); the direct subscriptions sit frozen because postgres_changes are
  // missed. When useRoom leaves backup mode the direct reads revert to those
  // frozen values, so the live "locked-in" count (+ board + scores) can flash
  // stale. Remember the last route payload (setBackupMode(false) nulls it in the
  // same tick, so we can't read it at the edge) and seed the direct state from it
  // on recovery; the direct subscriptions then refresh on the next change.
  const lastFallbackRef = useRef<RoomFallbackPayload | null>(null);
  useEffect(() => {
    if (fallbackPayload) lastFallbackRef.current = fallbackPayload;
  }, [fallbackPayload]);
  const prevBackupModeRef = useRef(backupMode);
  useEffect(() => {
    const seed = hostRecoverySeed(
      prevBackupModeRef.current,
      backupMode,
      lastFallbackRef.current,
    );
    prevBackupModeRef.current = backupMode;
    if (seed) {
      setAnswers(seed.liveAnswers);
      setScores(seed.scores);
      setAllQuestions(seed.allQuestions);
    }
  }, [backupMode]);

  // ── load all picked questions for the night ──────────────────────────
  useEffect(() => {
    if (room.games.length === 0) return;
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
      setAllQuestions((qData as QuestionRow[] | null) ?? []);
    })();
  }, [room.games]);

  // ── load + subscribe to scores from the materialized game_scores view ─
  useEffect(() => {
    const gameId = room.currentGame?.id ?? null;
    if (!gameId) {
      setScores([]);
      setDirectScoresReadyForGameId(null);
      return;
    }
    const currentGameId = gameId;
    const eligibilityKey = `${currentGameId}:${activePlayerIdSignature}`;
    setDirectScoresReadyForGameId(null);
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load(markStaleFirst = false) {
      if (markStaleFirst && !cancelled) {
        setDirectScoresReadyForGameId(null);
      }
      const { data } = await supa
        .from("game_scores")
        .select("*")
        .eq("game_id", currentGameId)
        .order("score", { ascending: false });
      if (cancelled) return;
      setScores(((data as GameScoreRow[] | null) ?? []));
      setDirectScoresReadyForGameId(eligibilityKey);
    }
    void load();
    const channel = supa
      .channel(`host-scores:${currentGameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adjustments" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_participations",
          filter: `game_id=eq.${currentGameId}`,
        },
        () => void load(true),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [activePlayerIdSignature, room.currentGame?.id]);

  // ── subscribe to answers for the current OR most-recently-resolved
  //    question ─────────────────────────────────────────────────────────
  // The sticky-reveal frame (after resolve, before host clicks next cell)
  // needs the same answers rows the live frame had — that's how TVReveal /
  // TVRevealStumper compute "X of N got it" + the fastest list. Targeting
  // only `currentQuestion` clears the state the moment finished_at lands
  // on the row (the row no longer matches useRoom's "live" definition),
  // which leaves the sticky reveal painting "Nobody nailed this one." even
  // when players did answer correctly. Mirror the fallback that
  // roomToTVSnapshot.ts already uses for targetQuestionId.
  const answerTargetId =
    room.currentQuestion?.id ?? room.lastResolvedQuestion?.id ?? null;
  useEffect(() => {
    if (!answerTargetId) {
      setAnswers([]);
      return;
    }
    const targetId = answerTargetId;
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supa
        .from("answers")
        .select("*")
        .eq("question_id", targetId);
      if (cancelled) return;
      setAnswers(((data as AnswerRow[] | null) ?? []));
    }
    void load();
    const channel = supa
      .channel(`host-answers:${targetId}`)
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
  }, [answerTargetId]);

  // ── track the last reveal timestamp for the undo window ──────────────
  useEffect(() => {
    if (!room.lastBroadcast || room.lastBroadcast.event !== "reveal") return;
    setLastRevealAt(new Date(room.lastBroadcast.serverNow).getTime());
  }, [room.lastBroadcast]);
  useEffect(() => {
    if (!room.currentQuestion?.played_at) {
      setLastRevealAt(null);
      return;
    }
    setLastRevealAt(new Date(room.currentQuestion.played_at).getTime());
  }, [room.currentQuestion?.played_at]);

  // ── tick the undo window so the button disables after 2s ─────────────
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!lastRevealAt) return;
    const handle = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(handle);
  }, [lastRevealAt]);
  const canUndo =
    lastRevealAt !== null && Date.now() - lastRevealAt < UNDO_WINDOW_MS;

  // ── derive players for the Players sheet ─────────────────────────────
  const scoreByPlayer = useMemo(() => {
    const map = new Map<string, GameScoreRow>();
    for (const s of scores) if (s.player_id) map.set(s.player_id, s);
    return map;
  }, [scores]);
  const lockedPlayerIds = useMemo(
    () => new Set(answers.map((a) => a.player_id)),
    [answers],
  );
  const players = useMemo<HostLivePlayer[]>(
    () =>
      [...room.players]
        .map((p) => {
          const score = scoreByPlayer.get(p.id)?.score ?? 0;
          return {
            id: p.id,
            name: p.display_name,
            score,
            locked: lockedPlayerIds.has(p.id),
            appOff: formatAppOff(p.app_switch_total_seconds),
            flag: p.app_switch_total_seconds >= 30,
          } satisfies HostLivePlayer;
        })
        .sort((a, b) => b.score - a.score),
    [room.players, scoreByPlayer, lockedPlayerIds],
  );

  const currentGame: GameRow | null = room.currentGame;
  const directScoresEligibilityKey =
    currentGame ? `${currentGame.id}:${activePlayerIdSignature}` : null;
  const scoresReadyEligibilityKey =
    backupMode && fallbackPayload
      ? directScoresEligibilityKey
      : directScoresReadyForGameId;
  const allLockedAutoRevealDecision = useMemo(
    () =>
      deriveAllLockedAutoRevealDecision({
        currentGameId: currentGame?.id ?? null,
        liveQuestionId: room.currentQuestion?.id ?? null,
        activePlayerIds: room.players.map((p) => p.id),
        scoreRows:
          currentGame &&
          directScoresEligibilityKey !== null &&
          scoresReadyEligibilityKey === directScoresEligibilityKey
            ? scores
            : null,
        answers,
      }),
    [
      answers,
      currentGame,
      directScoresEligibilityKey,
      room.currentQuestion?.id,
      room.players,
      scores,
      scoresReadyEligibilityKey,
    ],
  );
  const titleSuffix = currentGame
    ? `game ${currentGame.game_no} · ${currentGame.state}`
    : "waiting";

  // ── derive the inline TV snapshot for the embedded TV panel ──────────
  const tvSnapshot = useMemo(
    () =>
      roomToTVSnapshot({
        room,
        allQuestions,
        scores,
        answers,
      }),
    [room, allQuestions, scores, answers],
  );
  const tvLastBroadcastRevealedAt =
    room.lastBroadcast?.event === "reveal"
      ? room.lastBroadcast.revealedAt ?? null
      : null;
  const tvLastBroadcastServerNow =
    room.lastBroadcast?.event === "reveal"
      ? room.lastBroadcast.serverNow
      : null;

  // Magic-Welcome event for the embedded TV panel. Lifts the
  // `roster-changed` broadcast into a UI-shaped event, holds for ~3s,
  // then unmounts. The host's HDMI'd laptop shows BOTH this overlay AND
  // the venue TV's overlay — they fire from the same broadcast so they
  // stay in sync.
  const welcomeEvent = useHostWelcomeEvent(room.lastBroadcast, room.players);

  // ── action handlers ──────────────────────────────────────────────────
  async function handleReveal(questionId: string) {
    if (!currentGame) return;
    setError(null);
    try {
      // First reveal of a draft/ready game also starts it (idempotent on
      // already-live). Kept for safety even though "Start Game 1" now
      // promotes the game explicitly via handleStartGame — older snapshots
      // may still race.
      if (currentGame.state === "draft" || currentGame.state === "ready") {
        const startRes = await fetch(`/api/games/${currentGame.id}/start`, {
          method: "POST",
        });
        if (!startRes.ok) {
          const body = (await startRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "could not start the game");
        }
      }
      const res = await fetch(`/api/games/${currentGame.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "reveal failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reveal failed.");
    }
  }
  async function handleUndo() {
    if (!currentGame) return;
    setError(null);
    try {
      const res = await fetch(`/api/games/${currentGame.id}/undo`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "undo failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed.");
    }
  }
  async function handleEndEarly({
    requireAllLocked = false,
  }: {
    requireAllLocked?: boolean;
  } = {}): Promise<boolean> {
    if (!currentGame || !room.currentQuestion) return false;
    setError(null);
    try {
      const res = await fetch(`/api/games/${currentGame.id}/end-early`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: room.currentQuestion.id,
          ...(requireAllLocked ? { requireAllLocked: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (requireAllLocked && res.status === 409) {
          return false;
        }
        throw new Error(body.error ?? "end-early failed");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "End-early failed.");
      return true;
    }
  }
  async function handleStartGame(gameId: string | null) {
    if (!gameId) return;
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/start`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "start failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Start failed.");
    }
  }
  async function handleEndGame() {
    if (!currentGame) return;
    setError(null);
    try {
      const res = await fetch(`/api/games/${currentGame.id}/end`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "end-game failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "End-game failed.");
    }
  }
  async function handleCloseNight() {
    setError(null);
    try {
      const res = await fetch(`/api/nights/${nightId}/close`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "close-night failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close-night failed.");
    }
  }
  async function handleAdjust(playerId: string, delta: number, reason: string) {
    if (!currentGame) {
      const failure = new Error("No active game.");
      setError(failure.message);
      throw failure;
    }
    setError(null);
    try {
      const res = await fetch("/api/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          gameId: currentGame.id,
          delta,
          reason: reason || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "adjust failed");
      }
    } catch (err) {
      const failure = err instanceof Error ? err : new Error("Adjust failed.");
      setError(failure.message);
      throw failure;
    }
  }
  async function handleRemovePlayer(playerId: string) {
    if (removingPlayerId) return;
    setRemovingPlayerId(playerId);
    setError(null);
    try {
      const res = await fetch(`/api/players/${playerId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "remove failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setRemovingPlayerId(null);
    }
  }
  async function handleAddLatecomer(displayName: string) {
    setError(null);
    const res = await fetch(`/api/nights/${nightId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const message = body.error ?? "add failed";
      setError(message);
      throw new Error(message);
    }
    setAddingLatecomer(false);
  }

  useAllLockedAutoReveal({
    questionId: room.currentQuestion?.id ?? null,
    decision: allLockedAutoRevealDecision,
    onAutoReveal: () => handleEndEarly({ requireAllLocked: true }),
  });

  // Identify game 1 / game 2 ids so the control strip can route Start CTAs.
  const game1Id = room.games.find((g) => g.game_no === 1)?.id ?? null;
  const game2Id = room.games.find((g) => g.game_no === 2)?.id ?? null;
  // Game 2 is "startable" once it has at least one category with ready
  // questions — otherwise pressing Start would land the TV on an empty
  // board ("0 of 0 ANSWERED"). The server enforces this too; this signal
  // just keeps the button from inviting the click in the first place.
  const isGame2Ready =
    !!game2Id &&
    room.categories.some(
      (c) => c.game_id === game2Id && c.state === "ready",
    );

  return (
    <>
      <HostConnectionBanner />
      {/* Schedules the July firework beat so the embedded TV preview ignites
          the same burst at the same instant as the venue TV. Render-less;
          no-op on non-July nights. */}
      <PyrotechnicsBeatConductor beat={room.lastFireworksBeat} />
      <HostLiveConsole
        themeKey={themeKey as ThemeKey}
        title={`${venueName.toLowerCase()} · ${titleSuffix} · ${roomCode}`}
        players={players}
        playersTotal={
          room.currentQuestion && allLockedAutoRevealDecision.eligibleCount > 0
            ? allLockedAutoRevealDecision.eligibleCount
            : room.players.length
        }
        lockedCount={
          room.currentQuestion
            ? allLockedAutoRevealDecision.lockedCount
            : answers.length
        }
        canUndo={canUndo}
        roomCode={roomCode}
        onRevealCell={(qid) => void handleReveal(qid)}
        onEndEarly={() => void handleEndEarly()}
        onUndo={() => void handleUndo()}
        onAdjustPoints={() => {
          const first = players[0];
          if (first) setAdjusting(first);
        }}
        onRemovePlayer={(pid) => void handleRemovePlayer(pid)}
        onAddPlayer={() => setAddingLatecomer(true)}
        onStartGame1={game1Id ? () => void handleStartGame(game1Id) : undefined}
        onStartGame2={game2Id ? () => void handleStartGame(game2Id) : undefined}
        startGame2Disabled={!!game2Id && !isGame2Ready}
        startGame2DisabledReason="Round 2 has no questions yet — set up its categories first"
        onEndGame={() => void handleEndGame()}
        onCloseNight={() => void handleCloseNight()}
        tvSnapshot={tvSnapshot}
        tvLastBroadcastRevealedAt={tvLastBroadcastRevealedAt}
        tvLastBroadcastServerNow={tvLastBroadcastServerNow}
        welcomeEvent={welcomeEvent}
        roomMagicEnabled={Boolean(room.night?.room_magic_enabled)}
        lastRoomMagicReaction={room.lastRoomMagicReaction}
        roomMagicReactions={room.roomMagicReactions ?? []}
      />
      {adjusting && (
        <AdjustPointsModal
          initialPlayer={adjusting}
          allPlayers={players}
          onCancel={() => setAdjusting(null)}
          onSubmit={handleAdjust}
        />
      )}
      {addingLatecomer && (
        <AddLatecomerModal
          onCancel={() => setAddingLatecomer(false)}
          onSubmit={handleAddLatecomer}
        />
      )}
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
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
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: "transparent",
              color: "#FFF",
              border: "1px solid rgba(255,255,255,.4)",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

function formatAppOff(seconds: number): string {
  if (seconds < 1) return "0s";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Same shape as the standalone /tv/[code] route's welcome hook, but reads
 * from `useRoom` (host surface) instead of `useTVRoom`. Holds the welcome
 * event for ~3s after a `roster-changed` broadcast, then unmounts. Also
 * plays the chime locally so the host's HDMI'd laptop drives the venue
 * audio.
 */
function useHostWelcomeEvent(
  lastBroadcast: BroadcastTag | null,
  players: PlayerRow[],
): TVLobbyWelcomeEvent | null {
  const [event, setEvent] = useState<TVLobbyWelcomeEvent | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!lastBroadcast || lastBroadcast.event !== "roster-changed") return;
    if (!lastBroadcast.joinToken || !lastBroadcast.displayName) return;
    const idx = Math.max(1, players.length);
    setEvent({
      joinToken: lastBroadcast.joinToken,
      name: lastBroadcast.displayName,
      colorKey: lastBroadcast.colorKey,
      joinIndex: idx,
      prefersReducedMotion: reduced,
    });
    try {
      playWelcomeChime();
    } catch {
      /* silent */
    }
    const handle = window.setTimeout(
      () => setEvent(null),
      WELCOME_OVERLAY_DURATION_MS,
    );
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    lastBroadcast?.event,
    lastBroadcast?.joinToken,
    lastBroadcast?.serverNow,
  ]);

  return event;
}
