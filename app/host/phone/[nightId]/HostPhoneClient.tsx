// Client wrapper for /host/phone/[nightId].
//
// Subscribes to the room via useRoom() and renders the private host command
// center. Owns reveal/end-early/undo POSTs. Between questions the phone uses
// the same explicit board-picking model as the laptop.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRoom } from "@/lib/hooks/useRoom";
import { useTimer } from "@/lib/hooks/useTimer";
import { useAllLockedAutoReveal } from "@/lib/hooks/useAllLockedAutoReveal";
import { deriveAllLockedAutoRevealDecision } from "@/lib/game/allLockedAutoReveal";
import { useRoomFallback } from "@/lib/room/roomFallbackStore";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { HostPhoneUpcoming, HostPhoneLive, type HostPhoneLivePlayer } from "@/components/host";
import { HostCommandCenter, type HostSection } from "@/components/host/HostCommandCenter";
import { HostPhoneBoard } from "@/components/host/HostPhoneBoard";
import { Eyebrow, ThemeProvider, useTheme } from "@/components/system";
import { deriveHostStage, type HostStage } from "@/lib/host/gameConsole";
import type { AnswerRow, GameScoreRow, QuestionRow } from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";
import { readableForeground } from "@/lib/theme/contrast";

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
    eligibilityKey: string;
    rows: GameScoreRow[];
  } | null>(null);
  const { backupMode, payload: fallbackPayload } = useRoomFallback();
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
    () =>
      backupMode && fallbackPayload
        ? fallbackPayload.liveAnswers
        : room.currentQuestion
          ? directAnswers.filter(
              (answer) => answer.question_id === room.currentQuestion?.id,
            )
          : [],
    [backupMode, directAnswers, fallbackPayload, room.currentQuestion],
  );
  const scores = useMemo(
    () =>
      backupMode && fallbackPayload
        ? fallbackPayload.scores
        : directScoreSnapshot?.rows ?? [],
    [backupMode, directScoreSnapshot, fallbackPayload],
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

  // Subscribe to answers for the live question, for the lock-in counter.
  useEffect(() => {
    if (!room.currentQuestion) return;
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      if (!room.currentQuestion) return;
      const { data } = await supa
        .from("answers")
        .select("*")
        .eq("question_id", room.currentQuestion.id);
      if (cancelled) return;
      setDirectAnswers(((data as AnswerRow[] | null) ?? []));
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

  const activePlayerIdSignature = useMemo(
    () => room.players.map((player) => player.id).sort().join(","),
    [room.players],
  );

  useEffect(() => {
    const gameId = room.currentGame?.id;
    if (!gameId) return;
    const activeGameId = gameId;
    const eligibilityKey = `${activeGameId}:${activePlayerIdSignature}`;
    const supa = getSupabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await supa
        .from("game_scores")
        .select("*")
        .eq("game_id", activeGameId)
        .order("score", { ascending: false });
      if (cancelled) return;
      setDirectScoreSnapshot({
        eligibilityKey,
        rows: (data as GameScoreRow[] | null) ?? [],
      });
    }
    void load();
    const channel = supa
      .channel(`host-phone-scores:${activeGameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "answers" }, () => void load())
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
  }, [activePlayerIdSignature, room.currentGame?.id]);

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
      questionId !== stagedQuestion?.id ||
      !unplayedControlQuestions.some((question) => question.id === questionId)
    ) return;
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
        body: JSON.stringify({ questionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "reveal failed");
      }
      setSelection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reveal failed.");
    } finally {
      setBusy(false);
    }
  }

  async function endEarly(requireAllLocked = false): Promise<boolean> {
    if (!room.currentGame || !room.currentQuestion) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${room.currentGame.id}/end-early`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: room.currentQuestion.id,
          ...(requireAllLocked ? { requireAllLocked: true } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (requireAllLocked && res.status === 409) return false;
        throw new Error(body.error ?? "end-early failed");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "End-early failed.");
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
      const res = await fetch(`/api/games/${room.currentGame.id}/undo`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "undo failed");
      }
      setSelection(null);
      setNavigation(null);
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
        throw new Error(body.error ?? "game control failed");
      }
      setConfirmingEnd(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Game control failed.");
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
  const directEligibilityKey = room.currentGame
    ? `${room.currentGame.id}:${activePlayerIdSignature}`
    : null;
  const eligibilityReadyKey =
    backupMode && fallbackPayload
      ? directEligibilityKey
      : directScoreSnapshot?.eligibilityKey ?? null;
  const allLockedDecision = useMemo(
    () =>
      deriveAllLockedAutoRevealDecision({
        currentGameId: room.currentGame?.id ?? null,
        liveQuestionId: room.currentQuestion?.id ?? null,
        activePlayerIds: room.players.map((player) => player.id),
        scoreRows:
          directEligibilityKey && eligibilityReadyKey === directEligibilityKey
            ? scores
            : null,
        answers,
      }),
    [answers, directEligibilityKey, eligibilityReadyKey, room.currentGame?.id, room.currentQuestion?.id, room.players, scores],
  );
  useAllLockedAutoReveal({
    questionId: room.currentQuestion?.id ?? null,
    decision: allLockedDecision,
    onAutoReveal: () => endEarly(true),
  });
  const allGamesEnded = room.games.length > 0 && room.games.every((game) => game.state === "done");
  const game1 = room.games.find((game) => game.game_no === 1) ?? null;
  const game2 = room.games.find((game) => game.game_no === 2) ?? null;
  const resolvedCategory = room.lastResolvedQuestion
    ? room.categories.find((category) => category.id === room.lastResolvedQuestion?.category_id) ?? null
    : null;
  const resolvedGame = resolvedCategory
    ? room.games.find((game) => game.id === resolvedCategory.game_id) ?? null
    : null;
  const stage = deriveHostStage({
    game1: game1?.state ?? null,
    game2: game2?.state ?? null,
    currentGame: room.currentGame?.game_no ?? null,
    livePlay: room.currentQuestion?.id ?? null,
    lastResolve:
      room.lastResolvedQuestion && resolvedGame
        ? { id: room.lastResolvedQuestion.id, game: resolvedGame.game_no }
        : null,
    nightClosed: Boolean(room.night?.closed_at),
    stagedQuestion: stagedQuestion?.id ?? null,
  });
  const roundControls = (
    <PhoneRoundControls
      themeKey={themeKey}
      gameNo={currentGame?.game_no ?? null}
      gameState={currentGame?.state ?? null}
      questionLive={isLive}
      busy={busy}
      confirmingEnd={confirmingEnd}
      allGamesEnded={allGamesEnded}
      roomCode={roomCode}
      onStart={() => currentGame && void runLifecycle(`/api/games/${currentGame.id}/start`)}
      onRequestEnd={() => setConfirmingEnd(true)}
      onCancelEnd={() => setConfirmingEnd(false)}
      onConfirmEnd={() => currentGame && void runLifecycle(`/api/games/${currentGame.id}/end`)}
      onCloseNight={() => void runLifecycle(`/api/nights/${nightId}/close`)}
    />
  );

  let boardContent: React.ReactNode;
  if (isLive) {
    boardContent = (
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
            if (!controlGame) return;
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

  const sectionContent = activeSection === "board"
    ? boardContent
    : (
      <HostSectionSummary
        section={activeSection}
        roomCode={roomCode}
        playerNames={room.players.map((player) => player.display_name)}
        scores={scores.map((row) => ({
          name: row.display_name ?? "Player",
          score: row.score ?? 0,
        }))}
      />
    );

  return (
    <PhoneCenter
      themeKey={themeKey}
      stage={stage.stage}
      active={activeSection}
      playerCount={playerCount}
      lockedCount={answers.length}
      onNavigate={navigate}
      controls={roundControls}
    >
      {sectionContent}
      {error && <ErrorToast message={error} onDismiss={() => setError(null)} />}
    </PhoneCenter>
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
  onNavigate: (section: HostSection) => void;
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
  onNavigate,
}: Omit<PhoneCenterProps, "themeKey">) {
  return (
    <div data-host-mobile-surface="true" data-host-full-bleed="true">
      <HostCommandCenter
        stage={stage}
        active={active}
        playerCount={playerCount}
        lockedCount={lockedCount}
        delivery={{
          tv: "unknown",
          currentPhones: null,
          recoveringPhones: null,
        }}
        onNavigate={onNavigate}
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
  roomCode,
  playerNames,
  scores,
}: {
  section: Exclude<HostSection, "board">;
  roomCode: string;
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

  if (section === "tv") {
    return (
      <section style={panelStyle}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Venue TV</h2>
        <p style={{ color: t.inkMid, fontSize: 13, lineHeight: 1.45 }}>
          Open the audience-safe venue display in a separate tab.
        </p>
        <a
          href={`/tv/${roomCode}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: t.accent, fontWeight: 800 }}
        >
          Open venue TV
        </a>
      </section>
    );
  }

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
  roomCode: string;
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
  roomCode,
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

      <a
        href={`/tv/${roomCode}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Open venue screen"
        style={{
          minWidth: 58,
          minHeight: 48,
          padding: "0 10px",
          borderRadius: 10,
          border: `1px solid ${t.line}`,
          color: t.ink,
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        TV view ↗
      </a>

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
