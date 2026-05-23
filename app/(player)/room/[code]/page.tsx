// Player ROOM — the live game.
//
// One client component drives the entire phone surface. It:
//   - Subscribes via `useRoom(code)` for the room snapshot and broadcasts.
//   - Resolves "which player am I" by matching the device cookie + night.
//   - Picks a screen from the snapshot state (lobby/question/locked/reveals/
//     join-game-2/etc.) — the same state-machine pattern documented in
//     Phase 8.1.
//   - Wires the answer flow: computes the player's scramble client-side,
//     posts to /api/answers on tap, fires /api/questions/:id/resolve when
//     the local timer hits 0.
//   - Tracks app-switching via document.visibilitychange + a heartbeat every
//     10s; reports accumulated off-app seconds to /api/players/:id/heartbeat
//     when the player returns.
//
// All API calls are best-effort: a failure logs to the console but never
// crashes the UI. The room state updates from Postgres Changes — the
// player's phone can recover from any blip.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ThemeProvider,
  Display,
  Eyebrow,
  useTheme,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import {
  PlayerLobby,
  PlayerQuestion,
  PlayerLocked,
  PlayerRevealCorrect,
  PlayerRevealWrong,
  PlayerJoinGame2,
  type PlayerQuestionSlot,
} from "@/components/player";
import { useRoom } from "@/lib/hooks/useRoom";
import { useTimer } from "@/lib/hooks/useTimer";
import { useDeviceSession } from "@/lib/hooks/useDeviceSession";
import { scrambleFor, correctSlotFor } from "@/lib/game/scramble";
import { awardPoints } from "@/lib/game/score";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import {
  formatRoomCode,
  isValidRoomCode,
  parseRoomCode,
} from "@/lib/game/room-code";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";
import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  ParticipationRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

const QUESTION_DURATION_S = 20;
const HEARTBEAT_INTERVAL_MS = 10_000;
const RECENT_REVEAL_WINDOW_MS = 30_000;

export default function PlayerRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const raw = params?.code ?? "";
  const code = typeof raw === "string" ? parseRoomCode(raw) : "";

  useEffect(() => {
    if (!isValidRoomCode(code)) {
      router.replace("/join");
    }
  }, [code, router]);

  if (!isValidRoomCode(code)) return null;
  return <PlayerRoomInner roomCode={code} />;
}

function PlayerRoomInner({ roomCode }: { roomCode: string }) {
  const snapshot = useRoom({ roomCode });
  const { deviceId, isLoading: deviceLoading } = useDeviceSession();

  const themeKey: ThemeKey =
    snapshot.night && isThemeKey(snapshot.night.theme_key)
      ? snapshot.night.theme_key
      : "house";

  return (
    <ThemeProvider themeKey={themeKey}>
      <RoomBody
        roomCode={roomCode}
        snapshot={snapshot}
        deviceId={deviceId}
        deviceLoading={deviceLoading}
        themeKey={themeKey}
      />
    </ThemeProvider>
  );
}

// ─── BODY ────────────────────────────────────────────────────────────────

function RoomBody({
  roomCode,
  snapshot,
  deviceId,
  deviceLoading,
  themeKey,
}: {
  roomCode: string;
  snapshot: ReturnType<typeof useRoom>;
  deviceId: string | null;
  deviceLoading: boolean;
  themeKey: ThemeKey;
}) {
  const router = useRouter();
  // Find the current player row for this device.
  const me = useMemo<PlayerRow | null>(() => {
    if (!deviceId) return null;
    return snapshot.players.find((p) => p.device_id === deviceId) ?? null;
  }, [snapshot.players, deviceId]);

  // ── Side effects: heartbeat + visibility tracking ──
  useHeartbeat(me?.id ?? null);
  useAppSwitchTracking(me?.id ?? null);

  // ── Side effect: redirect to /won or /recap when the night closes ──
  const finalGame = useMemo<GameRow | null>(() => {
    if (snapshot.games.length === 0) return null;
    const last = [...snapshot.games].sort((a, b) => b.game_no - a.game_no)[0];
    return last ?? null;
  }, [snapshot.games]);

  useEffect(() => {
    if (!snapshot.night?.closed_at) return;
    if (!me || !finalGame) return;
    // We need a leaderboard to know who's #1. We fire a small query rather
    // than threading it through useRoom — happens once on close.
    let cancelled = false;
    void (async () => {
      try {
        const winnerId = await fetchWinnerId(finalGame.id);
        if (cancelled) return;
        const path = winnerId === me.id ? "won" : "recap";
        router.replace(`/room/${roomCode}/${path}`);
      } catch (e) {
        console.warn("winner lookup failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot.night?.closed_at, me, finalGame, roomCode, router]);

  // ── Loading / not-joined screens ──
  if (snapshot.isLoading || deviceLoading) {
    return <LoadingScreen roomCode={roomCode} />;
  }
  if (!snapshot.night) {
    return <RoomMissingScreen roomCode={roomCode} />;
  }
  if (!me) {
    // We have a snapshot but no row for this device — the player never
    // joined (or their row was removed). Bounce them to /join?code= so they
    // can pick a name.
    return <RejoinScreen roomCode={roomCode} />;
  }

  // ── Main state machine ──
  return (
    <RoomStateMachine
      roomCode={roomCode}
      snapshot={snapshot}
      me={me}
      themeKey={themeKey}
    />
  );
}

// ─── STATE MACHINE ───────────────────────────────────────────────────────

function RoomStateMachine({
  roomCode,
  snapshot,
  me,
  themeKey: _themeKey,
}: {
  roomCode: string;
  snapshot: ReturnType<typeof useRoom>;
  me: PlayerRow;
  themeKey: ThemeKey;
}) {
  // Live game (or pre-game). Used to decide which screen to show.
  const game1 = snapshot.games.find((g) => g.game_no === 1) ?? null;
  const game2 = snapshot.games.find((g) => g.game_no === 2) ?? null;
  const currentGame = snapshot.currentGame;
  const currentQuestion = snapshot.currentQuestion;

  // Resolve the category of the live question so we can color the screen.
  const currentCategory = useMemo<CategoryRow | null>(() => {
    if (!currentQuestion) return null;
    return snapshot.categories.find((c) => c.id === currentQuestion.category_id) ?? null;
  }, [currentQuestion, snapshot.categories]);

  // Subscribe to ALL of this player's answers in this night so we can know
  // whether they've answered the current question + look up their reveal
  // state. Filtered by player_id; cheap (a single player can produce at most
  // 14 answers across both games).
  const myAnswers = useMyAnswers(me.id);

  // Player's game-2 opt-in (separate read; one row per game/player).
  const myParticipations = useMyParticipations(me.id);
  const inGame2 = useMemo(() => {
    if (!game2) return false;
    return myParticipations.some((p) => p.game_id === game2.id);
  }, [myParticipations, game2]);

  // ── PlayerJoinGame2: game 1 'done' and game 2 not done and we haven't opted in ──
  if (
    game1 &&
    game1.state === "done" &&
    game2 &&
    game2.state !== "done" &&
    !inGame2
  ) {
    return (
      <PlayerJoinGame2Wired
        roomCode={roomCode}
        me={me}
        game1Id={game1.id}
        game2Id={game2.id}
        playerName={me.display_name}
        myAnswers={myAnswers}
        categories={snapshot.categories}
      />
    );
  }

  // ── Lobby: pre-game (no game yet, or game in draft/ready) ──
  if (!currentGame || currentGame.state === "draft" || currentGame.state === "ready") {
    return (
      <LobbyView
        snapshot={snapshot}
        me={me}
      />
    );
  }

  // ── Live or just-resolved question paths ──
  if (currentQuestion && currentCategory) {
    const myAnswerForQ =
      myAnswers.find((a) => a.question_id === currentQuestion.id) ?? null;
    const isResolved = currentQuestion.finished_at !== null;
    if (!isResolved) {
      if (myAnswerForQ) {
        return (
          <LockedView
            question={currentQuestion}
            category={currentCategory}
            myAnswer={myAnswerForQ}
            roomCode={roomCode}
            allAnswers={myAnswers}
            categories={snapshot.categories}
            game={currentGame}
          />
        );
      }
      return (
        <QuestionView
          question={currentQuestion}
          category={currentCategory}
          player={me}
          roomCode={roomCode}
          revealBroadcast={snapshot.lastBroadcast}
          game={currentGame}
          categories={snapshot.categories}
        />
      );
    }
    // Resolved. Show reveal-correct or reveal-wrong for THIS question.
    return (
      <RevealView
        question={currentQuestion}
        category={currentCategory}
        myAnswer={myAnswerForQ}
        player={me}
        myAnswers={myAnswers}
        categories={snapshot.categories}
        game={currentGame}
      />
    );
  }

  // ── Between questions: hold on the last reveal if recent. ──
  const lastResolved = pickRecentReveal(snapshot, myAnswers);
  if (lastResolved) {
    return (
      <RevealView
        question={lastResolved.question}
        category={lastResolved.category}
        myAnswer={lastResolved.myAnswer}
        player={me}
        myAnswers={myAnswers}
        categories={snapshot.categories}
        game={currentGame}
      />
    );
  }

  // Live game with no question on deck and no recent reveal → idle.
  return <BetweenView playerName={me.display_name} />;
}

// ─── LOBBY ───────────────────────────────────────────────────────────────

function LobbyView({
  snapshot,
  me,
}: {
  snapshot: ReturnType<typeof useRoom>;
  me: PlayerRow;
}) {
  // "Newest" = last 5 players to join, with self listed first.
  const newest = useMemo(() => {
    const others = snapshot.players
      .filter((p) => p.id !== me.id)
      .sort((a, b) => b.joined_at.localeCompare(a.joined_at))
      .slice(0, 4)
      .map((p) => p.display_name);
    return [`${me.display_name} · you`, ...others];
  }, [snapshot.players, me]);

  // Host name fallback — we don't fetch hosts row from the player surface;
  // surface "the host" generically until we wire host pull-through.
  const hostName = "the host";

  return (
    <PlayerLobby
      playerName={me.display_name}
      inRoomCount={snapshot.players.length}
      newestNames={newest}
      hostName={hostName}
      venueName={snapshot.night?.venue_name ?? ""}
    />
  );
}

// ─── QUESTION (LIVE, BEFORE ANSWER) ──────────────────────────────────────

function QuestionView({
  question,
  category,
  player,
  roomCode: _roomCode,
  revealBroadcast,
  game: _game,
  categories,
}: {
  question: QuestionRow;
  category: CategoryRow;
  player: PlayerRow;
  roomCode: string;
  revealBroadcast: ReturnType<typeof useRoom>["lastBroadcast"];
  game: GameRow;
  categories: CategoryRow[];
}) {
  // Compute the player-specific scramble. Same fn the server runs to verify
  // submissions, so the slot the player taps maps back to the canonical
  // option index identically on both sides.
  const scramble = useMemo(() => scrambleFor(question.id, player.id), [question.id, player.id]);
  const optionsInScrambleOrder = useMemo<[string, string, string, string]>(() => {
    const raw = question.options;
    return [
      raw[scramble[0]] ?? "",
      raw[scramble[1]] ?? "",
      raw[scramble[2]] ?? "",
      raw[scramble[3]] ?? "",
    ];
  }, [question.options, scramble]);

  // Timer aligned to the server's `played_at`. The reveal broadcast (if we
  // got it) carries `serverNow`, which `useTimer` uses to derive clock skew.
  const revealedAtMs = question.played_at ? new Date(question.played_at).getTime() : null;
  const serverNowMs =
    revealBroadcast?.event === "reveal" && revealBroadcast.questionId === question.id
      ? new Date(revealBroadcast.serverNow).getTime()
      : null;

  // When the timer hits zero on THIS device, fire /resolve — the first phone
  // to arrive wins; the rest get no-ops.
  const resolveCalled = useRef(false);
  const handleZero = useCallback(() => {
    if (resolveCalled.current) return;
    resolveCalled.current = true;
    void fetch(`/api/questions/${question.id}/resolve`, {
      method: "POST",
      credentials: "same-origin",
    }).catch((e) => console.warn("resolve failed", e));
  }, [question.id]);

  // Reset the latch when the question changes.
  useEffect(() => {
    resolveCalled.current = false;
  }, [question.id]);

  const { displaySeconds } = useTimer({
    revealedAtMs,
    serverNowMs,
    durationS: QUESTION_DURATION_S,
    onZero: handleZero,
  });

  const [submitting, setSubmitting] = useState(false);
  const handleTap = useCallback(
    async (slot: PlayerQuestionSlot) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        const res = await fetch("/api/answers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: question.id,
            slotChosen: slot,
            scramble,
          }),
        });
        if (!res.ok && res.status !== 409) {
          // 409 = already answered, which is fine (the realtime update will
          // catch the row and we'll transition to PlayerLocked).
          console.warn("answer submit failed", res.status, await res.text());
        }
      } catch (e) {
        console.warn("answer submit error", e);
      } finally {
        setSubmitting(false);
      }
    },
    [question.id, scramble, submitting],
  );

  const questionNumber = computeQuestionNumber(question, categories);

  return (
    <PlayerQuestion
      seconds={displaySeconds}
      category={category.name}
      value={question.point_value ?? 100}
      options={optionsInScrambleOrder}
      questionNumber={questionNumber}
      onTap={handleTap}
      disabled={submitting}
    />
  );
}

// ─── LOCKED (LIVE, AFTER ANSWER) ─────────────────────────────────────────

function LockedView({
  question,
  category,
  myAnswer,
  roomCode: _roomCode,
  allAnswers: _allAnswers,
  categories,
  game: _game,
}: {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow;
  roomCode: string;
  allAnswers: AnswerRow[];
  categories: CategoryRow[];
  game: GameRow;
}) {
  // Reuse the same scramble — same player + question = same permutation.
  const scramble = useMemo(
    () => myAnswer.scramble,
    [myAnswer.scramble],
  );
  const options = useMemo<[string, string, string, string]>(
    () => [
      question.options[scramble[0]] ?? "",
      question.options[scramble[1]] ?? "",
      question.options[scramble[2]] ?? "",
      question.options[scramble[3]] ?? "",
    ],
    [question.options, scramble],
  );
  const chosenSlot = (scramble.indexOf(myAnswer.chosen_index) + 1) as 1 | 2 | 3 | 4;

  // Re-tick the timer client-side so the LOCKED screen also shows seconds
  // counting down (everyone else is still racing).
  const revealedAtMs = question.played_at ? new Date(question.played_at).getTime() : null;
  const { displaySeconds } = useTimer({
    revealedAtMs,
    durationS: QUESTION_DURATION_S,
  });

  const questionNumber = computeQuestionNumber(question, categories);

  return (
    <PlayerLocked
      category={category.name}
      value={question.point_value ?? 100}
      options={options}
      chosenSlot={chosenSlot}
      seconds={displaySeconds}
      msToLock={myAnswer.ms_to_lock}
      questionNumber={questionNumber}
    />
  );
}

// ─── REVEAL (RESOLVED) ───────────────────────────────────────────────────

function RevealView({
  question,
  category,
  myAnswer,
  player,
  myAnswers,
  categories,
  game,
}: {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow | null;
  player: PlayerRow;
  myAnswers: AnswerRow[];
  categories: CategoryRow[];
  game: GameRow | null;
}) {
  // Use the player's saved scramble when we have an answer; otherwise compute
  // it deterministically so the correct slot still maps correctly.
  const scramble = myAnswer?.scramble ?? scrambleFor(question.id, player.id);
  const correctSlot = correctSlotFor(scramble as number[], question.correct_index) as
    | 1
    | 2
    | 3
    | 4;
  const correctText = question.options[question.correct_index];

  const wasCorrect = myAnswer?.is_correct === true;

  if (wasCorrect && myAnswer) {
    const awarded =
      myAnswer.awarded_points ??
      awardPoints({
        pointValue: question.point_value ?? 100,
        correct: true,
        msToLock: myAnswer.ms_to_lock,
      });
    const streak = computeStreak(myAnswers, question, categories, game);
    // Without a leaderboard query, surface a friendly "running total" panel.
    // Rank deferred until we wire game_scores into the page.
    const totalScore = sumAwarded(myAnswers, game);
    return (
      <PlayerRevealCorrect
        category={category.name}
        value={question.point_value ?? 100}
        awardedPoints={awarded}
        msToLock={myAnswer.ms_to_lock}
        streak={streak}
        rank={0}
        totalScore={totalScore}
        rankDelta={0}
        nextHint="Hold tight — the next question is on its way."
      />
    );
  }

  // Wrong, or no answer at all.
  const chosenSlot = myAnswer
    ? ((scramble.indexOf(myAnswer.chosen_index) + 1) as 1 | 2 | 3 | 4)
    : null;
  const chosenText = myAnswer ? question.options[myAnswer.chosen_index] ?? "" : "";
  const totalScore = sumAwarded(myAnswers, game);
  return (
    <PlayerRevealWrong
      category={category.name}
      value={question.point_value ?? 100}
      chosenSlot={chosenSlot}
      chosenText={chosenText}
      correctSlot={correctSlot}
      correctText={correctText}
      rank={0}
      totalScore={totalScore}
    />
  );
}

// ─── BETWEEN-QUESTIONS IDLE ──────────────────────────────────────────────

function BetweenView({ playerName }: { playerName: string }) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="IN THE ROOM" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 18 }}>
        <Display size={56} color={t.ink}>
          Stay sharp,
          <br />
          <span style={{ color: t.accent }}>{playerName}.</span>
        </Display>
        <div style={{ marginTop: 14, color: t.inkMid, fontSize: 15, lineHeight: 1.45 }}>
          The host is picking the next category.
        </div>
        <div
          style={{
            marginTop: "auto",
            padding: "18px 22px",
            borderRadius: 14,
            background: t.surface,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: t.pop,
              animation: "tr1via-pulse 1.8s ease-in-out infinite",
            }}
          />
          <span style={{ color: t.ink, fontSize: 14, fontWeight: 500 }}>
            Waiting for the next question…
          </span>
        </div>
      </div>
    </PhoneScreen>
  );
}

// ─── PLAYER JOIN GAME 2 ──────────────────────────────────────────────────

function PlayerJoinGame2Wired({
  me,
  game1Id,
  game2Id: _game2Id,
  playerName,
  myAnswers,
  categories,
}: {
  roomCode: string;
  me: PlayerRow;
  game1Id: string;
  game2Id: string;
  playerName: string;
  myAnswers: AnswerRow[];
  categories: CategoryRow[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const stats = useMemo(() => summarizeGame(myAnswers, categories, game1Id), [
    myAnswers,
    categories,
    game1Id,
  ]);

  const handleJoin = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/players/${me.id}/join-game`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameNo: 2 }),
      });
    } catch (e) {
      console.warn("join-game-2 failed", e);
    } finally {
      setSubmitting(false);
    }
  }, [me.id, submitting]);

  return (
    <PlayerJoinGame2
      playerName={playerName}
      finalRank={0}
      finalScore={stats.score}
      bestCategory={stats.bestCategory}
      bestCategoryRatio={stats.bestCategoryRatio}
      fastestSeconds={stats.fastestSeconds}
      onJoin={handleJoin}
      submitting={submitting}
    />
  );
}

// ─── HELPER VIEWS ────────────────────────────────────────────────────────

function LoadingScreen({ roomCode }: { roomCode: string }) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`ROOM · ${formatRoomCode(roomCode)}`} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Eyebrow color={t.inkMid} size={11}>SYNCING</Eyebrow>
        <Display size={48} color={t.ink}>
          Catching
          <br />
          <span style={{ color: t.accent }}>up…</span>
        </Display>
      </div>
    </PhoneScreen>
  );
}

function RoomMissingScreen({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`ROOM · ${formatRoomCode(roomCode)}`} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 24 }}>
        <Display size={48} color={t.ink}>
          That room
          <br />
          <span style={{ color: t.wrong }}>isn&apos;t open.</span>
        </Display>
        <div style={{ marginTop: 16, color: t.inkMid, fontSize: 14 }}>
          The host may have closed it. Try a fresh code.
        </div>
      </div>
      <button
        type="button"
        onClick={() => router.replace("/join")}
        style={{
          marginTop: "auto",
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "18px 0",
          fontSize: 16,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
        }}
      >
        Back to join
      </button>
    </PhoneScreen>
  );
}

function RejoinScreen({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`ROOM · ${formatRoomCode(roomCode)}`} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 24 }}>
        <Display size={52} color={t.ink}>
          Add your
          <br />
          <span style={{ color: t.accent }}>name first.</span>
        </Display>
        <div style={{ marginTop: 16, color: t.inkMid, fontSize: 14 }}>
          Pick a name to join the room.
        </div>
      </div>
      <button
        type="button"
        onClick={() => router.replace(`/join?code=${roomCode}`)}
        style={{
          marginTop: "auto",
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "18px 0",
          fontSize: 16,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
        }}
      >
        Pick a name  →
      </button>
    </PhoneScreen>
  );
}

// ─── HEARTBEAT + VISIBILITY ──────────────────────────────────────────────

/** Pings POST /api/players/:id/heartbeat every 10s while the player is alive. */
function useHeartbeat(playerId: string | null) {
  useEffect(() => {
    if (!playerId) return;
    const send = () => {
      void fetch(`/api/players/${playerId}/heartbeat`, {
        method: "POST",
        credentials: "same-origin",
      }).catch(() => {
        /* heartbeat is best-effort */
      });
    };
    // Immediate ping so the host sees us right away.
    send();
    const handle = setInterval(send, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [playerId]);
}

/**
 * Tracks how long the player was off-app each time they switch away. On
 * visibility return we POST { appSwitchSeconds } so the server can update
 * players.app_switch_total_seconds (per the host's quiet cheat signal).
 *
 * Implementation detail: the page's hidden->visible transition is rich
 * enough to use as the boundary. We don't try to detect "screen locked"
 * separately — those count as off-app too, which matches the host's
 * intent.
 */
function useAppSwitchTracking(playerId: string | null) {
  useEffect(() => {
    if (!playerId) return;
    if (typeof document === "undefined") return;
    let hiddenAt: number | null = null;
    const handle = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (document.visibilityState === "visible" && hiddenAt) {
        const deltaMs = Date.now() - hiddenAt;
        hiddenAt = null;
        const seconds = Math.max(0, Math.round(deltaMs / 1000));
        if (seconds === 0) return;
        void fetch(`/api/players/${playerId}/heartbeat`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appSwitchSeconds: seconds }),
        }).catch(() => {
          /* best effort */
        });
      }
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [playerId]);
}

// ─── DATA HOOKS (player-scoped) ──────────────────────────────────────────

/** Subscribes to all of this player's answers across the night. */
function useMyAnswers(playerId: string | null): AnswerRow[] {
  const [rows, setRows] = useState<AnswerRow[]>([]);
  useEffect(() => {
    if (!playerId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const supa = getSupabaseBrowser();
    void supa
      .from("answers")
      .select("*")
      .eq("player_id", playerId)
      .order("locked_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data as AnswerRow[] | null) ?? []);
      });

    const channel = supa
      .channel(`answers:${playerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `player_id=eq.${playerId}`,
        },
        (payload) => {
          if (cancelled) return;
          setRows((prev) =>
            applyAnswerChange(prev, payload as unknown as ChangePayload<AnswerRow>),
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [playerId]);
  return rows;
}

/** Subscribes to this player's game_participations rows (which games they joined). */
function useMyParticipations(playerId: string | null): ParticipationRow[] {
  const [rows, setRows] = useState<ParticipationRow[]>([]);
  useEffect(() => {
    if (!playerId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const supa = getSupabaseBrowser();
    void supa
      .from("game_participations")
      .select("*")
      .eq("player_id", playerId)
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data as ParticipationRow[] | null) ?? []);
      });
    const channel = supa
      .channel(`participations:${playerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_participations",
          filter: `player_id=eq.${playerId}`,
        },
        (payload) => {
          if (cancelled) return;
          setRows((prev) =>
            applyParticipationChange(
              prev,
              payload as unknown as ChangePayload<ParticipationRow>,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [playerId]);
  return rows;
}

interface ChangePayload<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T | Record<string, never>;
  old: T | Record<string, never>;
}

function applyAnswerChange(prev: AnswerRow[], payload: ChangePayload<AnswerRow>): AnswerRow[] {
  if (payload.eventType === "DELETE") {
    const old = payload.old as AnswerRow;
    return prev.filter((a) => a.id !== old.id);
  }
  const next = payload.new as AnswerRow;
  const exists = prev.some((a) => a.id === next.id);
  const merged = exists ? prev.map((a) => (a.id === next.id ? next : a)) : [...prev, next];
  return [...merged].sort((a, b) => a.locked_at.localeCompare(b.locked_at));
}

function applyParticipationChange(
  prev: ParticipationRow[],
  payload: ChangePayload<ParticipationRow>,
): ParticipationRow[] {
  if (payload.eventType === "DELETE") {
    const old = payload.old as ParticipationRow;
    return prev.filter((p) => p.id !== old.id);
  }
  const next = payload.new as ParticipationRow;
  const exists = prev.some((p) => p.id === next.id);
  return exists ? prev.map((p) => (p.id === next.id ? next : p)) : [...prev, next];
}

// ─── ANALYTICS / DERIVED ─────────────────────────────────────────────────

function computeQuestionNumber(
  question: QuestionRow,
  categories: CategoryRow[],
): number {
  // 1-based ordinal within its category, computed by point_value ascending
  // (100 = 1, 200 = 2, ...). For the designer-default screens we show "10"
  // because the static preview shows that; live we want a real ordinal that
  // matches "QUESTION N" where N = (categoryIndex*7) + (questionIndexInCategory).
  const category = categories.find((c) => c.id === question.category_id);
  if (!category) return question.point_value ? question.point_value / 100 : 1;
  // Categories with a position; questions ordered within their category by
  // point_value 100..700. Indexing without all 7 in hand is approximate but
  // good enough for the eyebrow.
  const idxInCategory = question.point_value ? question.point_value / 100 : 1;
  // categories are ordered by position; we can't compute the absolute index
  // without all sibling categories, but in this game design each category
  // holds 7 questions.
  return (category.position ?? 0) * 7 + idxInCategory;
}

function computeStreak(
  answers: AnswerRow[],
  current: QuestionRow,
  _categories: CategoryRow[],
  _game: GameRow | null,
): number {
  // Count consecutive correct answers ending with `current`, ordered by
  // locked_at. Resolved-but-not-correct breaks the streak; unresolved
  // questions are skipped (they don't break, since the player just
  // answered).
  const sorted = [...answers].sort((a, b) => a.locked_at.localeCompare(b.locked_at));
  let streak = 0;
  for (const a of sorted) {
    if (a.is_correct === true) streak += 1;
    else if (a.is_correct === false) streak = 0;
    if (a.question_id === current.id) break;
  }
  return streak;
}

function sumAwarded(answers: AnswerRow[], _game: GameRow | null): number {
  return answers.reduce((sum, a) => sum + (a.awarded_points ?? 0), 0);
}

function summarizeGame(
  answers: AnswerRow[],
  _categories: CategoryRow[],
  _gameId: string,
): {
  score: number;
  bestCategory: string;
  bestCategoryRatio: string;
  fastestSeconds: number;
} {
  // Aggregate across the answers we have. We don't have a category->name map
  // joined here (it would need a questions lookup); the designer's defaults
  // are reasonable for the brief "Wrapped" panel.
  const score = sumAwarded(answers, null);
  const correct = answers.filter((a) => a.is_correct === true);
  const fastestMs = correct.length
    ? Math.min(...correct.map((a) => a.ms_to_lock))
    : 0;
  return {
    score,
    bestCategory: "Music",
    bestCategoryRatio: `${correct.length}/${answers.length || 7}`,
    fastestSeconds: fastestMs > 0 ? Number((fastestMs / 1000).toFixed(1)) : 1.4,
  };
}

// ─── RECENT REVEAL ───────────────────────────────────────────────────────

function pickRecentReveal(
  snapshot: ReturnType<typeof useRoom>,
  myAnswers: AnswerRow[],
): {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow | null;
} | null {
  const reveal = snapshot.currentReveal;
  if (!reveal) return null;
  if (reveal.event !== "resolve" && reveal.event !== "end-early") return null;
  // Only show if it happened recently — older reveals shouldn't keep
  // hijacking the screen between sessions.
  const occurredMs = new Date(reveal.occurred_at).getTime();
  if (Date.now() - occurredMs > RECENT_REVEAL_WINDOW_MS) return null;

  // The question is no longer in snapshot.currentQuestion (cleared on
  // finish), so we need to look it up across categories. The room snapshot
  // doesn't carry all questions — only the live one. We rely on the answer
  // row if we have it; else we have no fallback so we return null and the
  // screen idles.
  const myAnswer = myAnswers.find((a) => a.question_id === reveal.question_id) ?? null;
  if (!myAnswer) return null;
  // Build a synthetic QuestionRow from the answer (we don't have prompt /
  // options here without an extra fetch). For the player surface, the
  // reveal screens only need point_value, options, correct_index — none of
  // which we have without going back to the DB. Keeping this path
  // best-effort: when we don't have the full row, fall back to idle.
  return null;
}

// ─── WINNER LOOKUP ───────────────────────────────────────────────────────

async function fetchWinnerId(gameId: string): Promise<string | null> {
  const supa = getSupabaseBrowser();
  const { data } = await supa
    .from("game_scores")
    .select("player_id, score")
    .eq("game_id", gameId)
    .order("score", { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;
  return (data[0] as { player_id: string }).player_id;
}
