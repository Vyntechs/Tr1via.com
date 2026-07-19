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
import { Eyebrow, ThemeProvider, useTheme } from "@/components/system";
import type { AnswerRow, QuestionRow } from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";

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
  const [allQuestions, setAllQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [stagedQuestionId, setStagedQuestionId] = useState<string | null>(null);
  const [lastRevealAt, setLastRevealAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setAllQuestions(
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

  // Keep the staging pool aligned with the live snapshot. The initial query
  // is intentionally broad and does not rerun after every reveal, so mirror
  // the authoritative played/undo transitions locally to advance instantly.
  useEffect(() => {
    const liveQuestion = room.currentQuestion;
    if (liveQuestion) {
      setAllQuestions((previous) =>
        previous.map((question) =>
          question.id === liveQuestion.id
            ? { ...question, played_at: liveQuestion.played_at }
            : question,
        ),
      );
      return;
    }
    if (room.lastBroadcast?.event === "undo") {
      const undoneId = room.lastBroadcast.questionId;
      setAllQuestions((previous) =>
        previous.map((question) =>
          question.id === undoneId
            ? { ...question, played_at: null, finished_at: null }
            : question,
        ),
      );
      setStagedQuestionId(undoneId);
    }
  }, [room.currentQuestion, room.lastBroadcast]);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastRevealAt) return;
    const handle = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(handle);
  }, [lastRevealAt]);
  const canUndo =
    lastRevealAt !== null && Date.now() - lastRevealAt < UNDO_WINDOW_MS;

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
  const controlCategoryIds = useMemo(
    () =>
      new Set(
        room.categories
          .filter((category) => category.game_id === controlGame?.id)
          .map((category) => category.id),
      ),
    [controlGame?.id, room.categories],
  );
  const unplayedControlQuestions = useMemo(
    () =>
      allQuestions
        .filter(
          (question) =>
            controlGame?.state !== "done" &&
            controlCategoryIds.has(question.category_id) &&
            question.is_picked &&
            !question.played_at,
        )
        .sort((a, b) => (a.point_value ?? 0) - (b.point_value ?? 0)),
    [allQuestions, controlCategoryIds, controlGame?.state],
  );

  // Stage the next question when the room idles (no live question).
  const nextUnplayedId = unplayedControlQuestions[0]?.id ?? null;

  useEffect(() => {
    if (room.currentQuestion) return;
    if (room.lastBroadcast?.event === "undo") {
      if (stagedQuestionId !== room.lastBroadcast.questionId) {
        setStagedQuestionId(room.lastBroadcast.questionId);
      }
      return;
    }
    if (
      stagedQuestionId &&
      unplayedControlQuestions.some((question) => question.id === stagedQuestionId)
    ) {
      return;
    }
    setStagedQuestionId(nextUnplayedId);
  }, [room.currentQuestion, room.lastBroadcast, stagedQuestionId, nextUnplayedId, unplayedControlQuestions]);

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
  async function reveal() {
    if (!controlGame || !stagedQuestionId) return;
    setBusy(true);
    setError(null);
    try {
      if (controlGame.state === "draft" || controlGame.state === "ready") {
        const startRes = await fetch(`/api/games/${controlGame.id}/start`, {
          method: "POST",
        });
        if (!startRes.ok) {
          const body = (await startRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "could not start the game");
        }
      }
      const res = await fetch(`/api/games/${controlGame.id}/reveal`, {
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

  async function runLifecycle(path: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "show control failed");
      }
      setConfirmingEnd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Show control failed.");
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
  const currentGame = controlGame;
  const allGamesEnded = room.games.length > 0 && room.games.every((game) => game.state === "done");
  const roundControls = (
    <PhoneRoundControls
      themeKey={themeKey}
      gameNo={currentGame?.game_no ?? null}
      gameState={currentGame?.state ?? null}
      questionLive={isLive}
      busy={busy}
      confirmingEnd={confirmingEnd}
      allGamesEnded={allGamesEnded}
      onStart={() => currentGame && void runLifecycle(`/api/games/${currentGame.id}/start`)}
      onRequestEnd={() => setConfirmingEnd(true)}
      onCancelEnd={() => setConfirmingEnd(false)}
      onConfirmEnd={() => currentGame && void runLifecycle(`/api/games/${currentGame.id}/end`)}
      onCloseNight={() => void runLifecycle(`/api/nights/${nightId}/close`)}
    />
  );

  if (isLive) {
    return (
      <PhoneCenter controls={roundControls}>
        <HostPhoneLive
          themeKey={themeKey}
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
    ? unplayedControlQuestions.find((q) => q.id === stagedQuestionId) ?? null
    : null;
  const stagedCat = staged
    ? room.categories.find((c) => c.id === staged.category_id) ?? null
    : null;
  const pickedTotal = allQuestions.filter(
    (q) => controlCategoryIds.has(q.category_id) && q.is_picked,
  ).length;
  const playedSoFar = allQuestions.filter(
    (q) =>
      controlCategoryIds.has(q.category_id) &&
      q.is_picked &&
      q.played_at !== null,
  ).length;

  if (!staged) {
    return (
      <PhoneCenter controls={roundControls}>
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
    <PhoneCenter controls={roundControls}>
      <HostPhoneUpcoming
        themeKey={themeKey}
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
          const game = controlGame;
          if (!game) return;
          const pool = unplayedControlQuestions;
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

function PhoneCenter({ children, controls }: { children: React.ReactNode; controls?: React.ReactNode }) {
  // The host's phone view should fill the device. We don't add a faux
  // phone chrome here — this isn't the dev gallery — and just lean on the
  // PhoneScreen component's inner padding.
  //
  // The AccountChip is hidden on this in-hand surface (see AccountChip), but
  // HostLayout still reserves its top strip (--host-chip-reserve). The
  // negative margin cancels that leftover padding so the phone keeps filling
  // the device with no extra scroll.
  return (
    <div
      data-host-mobile-surface="true"
      style={{
        minHeight: "100dvh",
        height: "100dvh",
        marginTop: "calc(-1 * var(--host-chip-reserve, 0px))",
        display: "flex",
        flexDirection: "column",
        background: "var(--paper)",
        overflow: "hidden",
      }}
    >
      {controls}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
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
          {gameNo ? `GAME ${gameNo}` : "SHOW CONTROL"}
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
    minHeight: 44,
    padding: "8px 12px",
    borderRadius: 10,
    border: primary ? "none" : `1px solid ${t.line}`,
    background: primary ? t.accent : "transparent",
    color: primary ? (t.dark ? "#0E0E0C" : "#FFF") : t.ink,
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    flex: 1,
  };
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
