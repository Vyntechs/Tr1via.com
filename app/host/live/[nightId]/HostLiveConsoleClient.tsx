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

import { useEffect, useMemo, useState } from "react";
import { useRoom } from "@/lib/hooks/useRoom";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  AddLatecomerModal,
  AdjustPointsModal,
  HostLiveConsole,
  type HostLivePlayer,
} from "@/components/host";
import type {
  AnswerRow,
  QuestionRow,
  GameRow,
  GameScoreRow,
} from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";

const UNDO_WINDOW_MS = 2_000;

export interface HostLiveConsoleClientProps {
  nightId: string;
  roomCode: string;
  venueName: string;
  themeKey: string;
}

export function HostLiveConsoleClient({
  nightId,
  roomCode,
  venueName,
  themeKey,
}: HostLiveConsoleClientProps) {
  const room = useRoom({ roomCode });
  const [allQuestions, setAllQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [scores, setScores] = useState<GameScoreRow[]>([]);
  const [lastRevealAt, setLastRevealAt] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState<HostLivePlayer | null>(null);
  const [addingLatecomer, setAddingLatecomer] = useState(false);
  const [removingPlayerId, setRemovingPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (!room.currentGame) {
      setScores([]);
      return;
    }
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      if (!room.currentGame) return;
      const { data } = await supa
        .from("game_scores")
        .select("*")
        .eq("game_id", room.currentGame.id)
        .order("score", { ascending: false });
      if (cancelled) return;
      setScores(((data as GameScoreRow[] | null) ?? []));
    }
    void load();
    const channel = supa
      .channel(`host-scores:${room.currentGame.id}`)
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
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [room.currentGame]);

  // ── subscribe to answers for the current question ────────────────────
  useEffect(() => {
    if (!room.currentQuestion) {
      setAnswers([]);
      return;
    }
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      if (!room.currentQuestion) return;
      const { data } = await supa
        .from("answers")
        .select("*")
        .eq("question_id", room.currentQuestion.id);
      if (cancelled) return;
      setAnswers(((data as AnswerRow[] | null) ?? []));
    }
    void load();
    const channel = supa
      .channel(`host-answers:${room.currentQuestion.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `question_id=eq.${room.currentQuestion.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [room.currentQuestion]);

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
  async function handleEndEarly() {
    if (!currentGame || !room.currentQuestion) return;
    setError(null);
    try {
      const res = await fetch(`/api/games/${currentGame.id}/end-early`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: room.currentQuestion.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "end-early failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "End-early failed.");
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
    if (!currentGame) return;
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
      setAdjusting(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjust failed.");
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

  // Identify game 1 / game 2 ids so the control strip can route Start CTAs.
  const game1Id = room.games.find((g) => g.game_no === 1)?.id ?? null;
  const game2Id = room.games.find((g) => g.game_no === 2)?.id ?? null;

  return (
    <>
      <HostLiveConsole
        themeKey={themeKey as ThemeKey}
        title={`${venueName.toLowerCase()} · ${titleSuffix} · ${roomCode}`}
        players={players}
        playersTotal={room.players.length}
        lockedCount={answers.length}
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
        onEndGame={() => void handleEndGame()}
        onCloseNight={() => void handleCloseNight()}
        tvSnapshot={tvSnapshot}
        tvLastBroadcastRevealedAt={tvLastBroadcastRevealedAt}
        tvLastBroadcastServerNow={tvLastBroadcastServerNow}
      />
      {adjusting && (
        <AdjustPointsModal
          initialPlayer={adjusting}
          allPlayers={players}
          onCancel={() => setAdjusting(null)}
          onSubmit={(playerId, delta, reason) =>
            void handleAdjust(playerId, delta, reason)
          }
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
