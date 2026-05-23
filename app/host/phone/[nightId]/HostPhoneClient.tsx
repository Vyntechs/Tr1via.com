// Client wrapper for /host/phone/[nightId].
//
// Subscribes to the room via useRoom() and decides which of the two phone
// screens to render. Owns reveal/end-early/undo POSTs. The phone has a
// simple "pick next" model: if no question is live, show the
// next-unplayed question with the lowest point value; the host can also
// scroll through other cells.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRoom } from "@/lib/hooks/useRoom";
import { useTimer } from "@/lib/hooks/useTimer";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { HostPhoneUpcoming, HostPhoneLive, type HostPhoneLivePlayer } from "@/components/host";
import type { AnswerRow, QuestionRow } from "@/lib/supabase/types";

const UNDO_WINDOW_MS = 2_000;

export interface HostPhoneClientProps {
  nightId: string;
  roomCode: string;
  hostName: string;
}

export function HostPhoneClient({
  nightId: _nightId,
  roomCode,
  hostName,
}: HostPhoneClientProps) {
  const room = useRoom({ roomCode });
  const [allQuestions, setAllQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [stagedQuestionId, setStagedQuestionId] = useState<string | null>(null);
  const [lastRevealAt, setLastRevealAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull all picked questions for the current game (so we can stage the
  // next one).
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

  // Subscribe to answers for the live question, for the lock-in counter.
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
      .channel(`host-phone-answers:${room.currentQuestion.id}`)
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

  // Track the last reveal timestamp for the undo window.
  useEffect(() => {
    if (room.lastBroadcast?.event === "reveal") {
      setLastRevealAt(new Date(room.lastBroadcast.serverNow).getTime());
    }
  }, [room.lastBroadcast]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastRevealAt) return;
    const handle = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(handle);
  }, [lastRevealAt]);
  const canUndo =
    lastRevealAt !== null && Date.now() - lastRevealAt < UNDO_WINDOW_MS;

  // Stage the next question when the room idles (no live question).
  const nextUnplayedId = useMemo(() => {
    const game = room.currentGame;
    if (!game) return null;
    const cats = room.categories.filter((c) => c.game_id === game.id);
    const catIds = new Set(cats.map((c) => c.id));
    const candidates = allQuestions
      .filter((q) => catIds.has(q.category_id) && q.is_picked && !q.played_at)
      .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0));
    return candidates[0]?.id ?? null;
  }, [room.currentGame, room.categories, allQuestions]);

  useEffect(() => {
    if (room.currentQuestion) return;
    if (stagedQuestionId && allQuestions.some((q) => q.id === stagedQuestionId)) {
      return;
    }
    setStagedQuestionId(nextUnplayedId);
  }, [room.currentQuestion, stagedQuestionId, nextUnplayedId, allQuestions]);

  // Live timer for the question.
  const timer = useTimer({
    revealedAtMs: room.currentQuestion?.played_at
      ? new Date(room.currentQuestion.played_at).getTime()
      : null,
    serverNowMs: room.lastBroadcast
      ? new Date(room.lastBroadcast.serverNow).getTime()
      : null,
  });

  // Action handlers.
  async function reveal() {
    if (!room.currentGame || !stagedQuestionId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${room.currentGame.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: stagedQuestionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "reveal failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reveal failed.");
    } finally {
      setBusy(false);
    }
  }

  async function endEarly() {
    if (!room.currentGame || !room.currentQuestion) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${room.currentGame.id}/end-early`, {
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
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!room.currentGame) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${room.currentGame.id}/undo`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "undo failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed.");
    } finally {
      setBusy(false);
    }
  }

  // Display state.
  const isLive = room.currentQuestion !== null;
  const playerCount = room.players.length;
  const lockedIds = new Set(answers.map((a) => a.player_id));
  const stillThinking: HostPhoneLivePlayer[] = room.players
    .filter((p) => !lockedIds.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      flag: p.app_switch_total_seconds >= 30
        ? `app-switched ${Math.floor(p.app_switch_total_seconds / 60)}m`
        : null,
    }));

  if (isLive) {
    return (
      <PhoneCenter>
        <HostPhoneLive
          secondsRemaining={Math.max(0, Math.floor(timer.secondsRemaining))}
          lockedCount={answers.length}
          totalPlayers={playerCount}
          stillThinking={stillThinking}
          onEndEarly={() => void endEarly()}
          onUndo={() => void undo()}
          canUndo={canUndo}
          isEnding={busy}
        />
        {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
      </PhoneCenter>
    );
  }

  // Upcoming view.
  const staged = stagedQuestionId
    ? allQuestions.find((q) => q.id === stagedQuestionId) ?? null
    : null;
  const stagedCat = staged
    ? room.categories.find((c) => c.id === staged.category_id) ?? null
    : null;
  const pickedTotal = allQuestions.filter((q) => q.is_picked).length;
  const playedSoFar = allQuestions.filter(
    (q) => q.is_picked && q.played_at !== null,
  ).length;

  if (!staged) {
    return (
      <PhoneCenter>
        <div
          style={{
            padding: 40,
            color: "var(--ink-mid)",
            fontFamily: "var(--font-sans)",
            textAlign: "center",
            fontSize: 14,
            maxWidth: 320,
          }}
        >
          Waiting for the next game to open — or the board is already finished.
        </div>
        {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
      </PhoneCenter>
    );
  }

  return (
    <PhoneCenter>
      <HostPhoneUpcoming
        hostName={hostName.split(" ")[0] ?? hostName}
        roomLive={room.night?.opened_at !== null}
        playerCount={playerCount}
        categoryName={stagedCat?.name ?? "Category"}
        pointValue={staged.point_value ?? staged.difficulty * 100}
        questionIndex={playedSoFar + 1}
        questionTotal={pickedTotal}
        prompt={staged.prompt}
        options={staged.options}
        correctIndex={staged.correct_index}
        onReveal={() => void reveal()}
        onPickDifferent={() => {
          // Rotate to the next staged question — for now, increment by id
          // order from the pool of unplayed.
          const game = room.currentGame;
          if (!game) return;
          const cats = room.categories.filter((c) => c.game_id === game.id);
          const catIds = new Set(cats.map((c) => c.id));
          const pool = allQuestions
            .filter((q) => catIds.has(q.category_id) && q.is_picked && !q.played_at)
            .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0));
          const idx = pool.findIndex((q) => q.id === stagedQuestionId);
          const next = pool[(idx + 1) % pool.length];
          setStagedQuestionId(next?.id ?? null);
        }}
        isRevealing={busy}
      />
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
    </PhoneCenter>
  );
}

function PhoneCenter({ children }: { children: React.ReactNode }) {
  // The host's phone view should fill the device. We don't add a faux
  // phone chrome here — this isn't the dev gallery — and just lean on the
  // PhoneScreen component's inner padding.
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--paper)",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
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
  );
}
