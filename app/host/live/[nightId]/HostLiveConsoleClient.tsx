// Client wrapper for /host/live/[nightId].
//
// Owns:
//   - useRoom(roomCode): the snapshot of nights, games, categories,
//     players, current question + reveal.
//   - useTimer: derives secondsRemaining from the live question's
//     played_at + serverNow (broadcast hint or fallback).
//   - A subscription to `answers` rows for the current question so we can
//     show the lock-in count + the per-player locked flag in real time.
//   - Action handlers: reveal (POST /api/games/[id]/reveal), undo (POST
//     /api/games/[id]/undo), end-early (POST /api/games/[id]/end-early),
//     adjust (POST /api/adjustments), remove player (DELETE /api/players/[id]),
//     add latecomer (POST /api/nights/[id]/players). The mid-game edits live
//     in dedicated modal components so the live console stays uncluttered.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRoom } from "@/lib/hooks/useRoom";
import { useTimer } from "@/lib/hooks/useTimer";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  AddLatecomerModal,
  AdjustPointsModal,
  HostLiveConsole,
  type HostLivePlayer,
  type HostLiveBoardColumn,
  type HostLiveCurrentQuestion,
} from "@/components/host";
import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  QuestionRow,
  GameScoreRow,
} from "@/lib/supabase/types";

const UNDO_WINDOW_MS = 2_000;

export interface HostLiveConsoleClientProps {
  nightId: string;
  roomCode: string;
  venueName: string;
}

export function HostLiveConsoleClient({
  nightId,
  roomCode,
  venueName,
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
    // Re-pull when any answer or adjustment lands — the view derives from
    // both tables.
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

  // ── timer for the live question ──────────────────────────────────────
  const timer = useTimer({
    revealedAtMs: room.currentQuestion?.played_at
      ? new Date(room.currentQuestion.played_at).getTime()
      : null,
    serverNowMs: room.lastBroadcast
      ? new Date(room.lastBroadcast.serverNow).getTime()
      : null,
  });

  // ── derive the board, players, currentQuestion for the component ─────
  const columns = useMemo<HostLiveBoardColumn[]>(
    () => deriveColumns(room.currentGame, room.categories, allQuestions),
    [room.currentGame, room.categories, allQuestions],
  );
  const scoreByPlayer = useMemo(() => {
    const map = new Map<string, GameScoreRow>();
    // GameScoreRow.player_id is nullable because game_scores is a LEFT
    // JOIN view; in practice it never is. Skip defensively.
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

  const currentQuestion = useMemo<HostLiveCurrentQuestion | null>(() => {
    if (!room.currentQuestion) return null;
    const q = room.currentQuestion;
    const cat = room.categories.find((c) => c.id === q.category_id);
    return {
      questionId: q.id,
      prompt: q.prompt,
      categoryName: cat?.name ?? "",
      pointValue: q.point_value ?? q.difficulty * 100,
      secondsRemaining: q.played_at ? Math.floor(timer.secondsRemaining) : null,
    };
  }, [room.currentQuestion, room.categories, timer.secondsRemaining]);

  const currentGame: GameRow | null = room.currentGame;
  const titleSuffix = currentGame
    ? `game ${currentGame.game_no} · ${currentGame.state}`
    : "waiting";

  // ── action handlers ──────────────────────────────────────────────────
  async function handleReveal(questionId: string) {
    if (!currentGame) return;
    setError(null);
    try {
      // First reveal of a draft/ready game also starts it. The host UI
      // treats "tap a cell" as the start signal (per the BOARD READY copy),
      // and the TV/phone state machines gate the lobby on games.state ===
      // 'live'. Without this promotion both surfaces sit on the lobby
      // forever while the host plays through the game on her own console.
      // /start is idempotent so we can be liberal about calling it.
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

  // The HostLiveConsole's grid click handler currently picks the cell
  // and reveals immediately. For mid-game the host can stage on her phone;
  // for the laptop console we treat a click as "reveal now."
  return (
    <>
      <HostLiveConsole
        title={`${venueName.toLowerCase()} · ${titleSuffix} · ${roomCode}`}
        columns={columns}
        currentQuestion={currentQuestion}
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

function deriveColumns(
  game: GameRow | null,
  categories: CategoryRow[],
  questions: QuestionRow[],
): HostLiveBoardColumn[] {
  if (!game) return [];
  const cats = categories
    .filter((c) => c.game_id === game.id)
    .sort((a, b) => a.position - b.position);
  return cats.map((cat) => {
    const cells = questions
      .filter((q) => q.category_id === cat.id && q.is_picked)
      .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0))
      .map((q) => ({
        questionId: q.id,
        pointValue: q.point_value ?? q.difficulty * 100,
        played: q.finished_at !== null,
        live: q.played_at !== null && q.finished_at === null,
      }));
    return { categoryId: cat.id, name: cat.name, cells };
  });
}

function formatAppOff(seconds: number): string {
  if (seconds < 1) return "0s";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

