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
import { useAnswerSubmit } from "@/lib/hooks/useAnswerSubmit";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { scrambleFor, correctSlotFor } from "@/lib/game/scramble";
import { awardPoints } from "@/lib/game/score";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { playerColorHex } from "@/lib/player/playerColor";
import { playWelcomeChime, triggerWelcomeHaptic } from "@/lib/audio/welcomeChime";
import {
  formatRoomCode,
  isValidRoomCode,
  parseRoomCode,
} from "@/lib/game/room-code";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  GameScoreRow,
  ParticipationRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

const HEARTBEAT_INTERVAL_MS = 10_000;

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
  const { deviceId, isLoading: deviceLoading } = useDeviceSession();
  const snapshot = useRoom({ roomCode, deviceId });

  const themeKey: ThemeKey = resolveTheme(
    snapshot.night,
    { default_theme_key: snapshot.hostDefaultThemeKey },
  );

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
  useHeartbeat(me?.id ?? null, roomCode);
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
  themeKey,
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
  //
  // Pass lastBroadcast.serverNow as a refetch trigger — every reveal /
  // resolve / undo / end-early broadcast bumps it, and useMyAnswers re-pulls
  // the latest rows from REST. Necessary because postgres_changes on the
  // answers UPDATE (where is_correct + awarded_points get filled in by the
  // resolve route) silently drops for device-cookie sessions.
  const realAnswers = useMyAnswers(me.id, snapshot.lastBroadcast?.serverNow ?? null);

  // Optimistic local copy of answers the player just submitted. Lets the UI
  // flip to PlayerLocked the moment the tap fires, without waiting for the
  // postgres_changes round-trip (which is unreliable for device-cookie
  // sessions — the cookie can't ride the WebSocket). Eventually the real
  // row arrives from useMyAnswers and supersedes the optimistic one.
  const [optimisticAnswers, setOptimisticAnswers] = useState<AnswerRow[]>([]);
  const recordOptimisticAnswer = useCallback(
    (row: AnswerRow) => {
      setOptimisticAnswers((prev) => {
        const without = prev.filter((p) => p.question_id !== row.question_id);
        return [...without, row];
      });
    },
    [],
  );
  // Drop optimistic answers once the real DB row arrives for the same question.
  useEffect(() => {
    if (optimisticAnswers.length === 0) return;
    const realIds = new Set(realAnswers.map((a) => a.question_id));
    if (optimisticAnswers.some((o) => realIds.has(o.question_id))) {
      setOptimisticAnswers((prev) => prev.filter((o) => !realIds.has(o.question_id)));
    }
  }, [realAnswers, optimisticAnswers]);
  const myAnswers = useMemo<AnswerRow[]>(() => {
    if (optimisticAnswers.length === 0) return realAnswers;
    const realIds = new Set(realAnswers.map((a) => a.question_id));
    const merged: AnswerRow[] = [...realAnswers];
    for (const opt of optimisticAnswers) {
      if (!realIds.has(opt.question_id)) merged.push(opt);
    }
    return merged.sort((a, b) => a.locked_at.localeCompare(b.locked_at));
  }, [realAnswers, optimisticAnswers]);

  // ── load + subscribe to game_scores for the current game ───────────────
  // Same load+subscribe pattern HostLiveConsoleClient + the recap page use.
  // Tri-state: `null` = pending (haven't completed a fetch yet) so the reveal
  // surfaces render an unnumbered "in the mix" tag instead of "#0" while
  // the initial REST query is in flight, or when the player is missing from
  // the view (no game_participations row → silently absent forever).
  const [scores, setScores] = useState<GameScoreRow[] | null>(null);
  const currentGameId = currentGame?.id ?? null;
  useEffect(() => {
    if (!currentGameId) {
      setScores(null);
      return;
    }
    const gameId = currentGameId;
    let cancelled = false;
    const supa = getSupabaseBrowser();
    async function load() {
      const { data } = await supa
        .from("game_scores")
        .select("*")
        .eq("game_id", gameId)
        .order("score", { ascending: false });
      if (cancelled) return;
      setScores((data as GameScoreRow[] | null) ?? []);
    }
    void load();
    const channel = supa
      .channel(`player-scores:${gameId}`)
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
        { event: "*", schema: "public", table: "game_participations" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [currentGameId]);

  // 1-based rank, or `null` if the scores fetch hasn't landed yet OR the
  // player isn't in the view (missing participation row). `null` propagates
  // down to the reveal components, which render "in the mix" instead of "#0".
  const myRank = useMemo<number | null>(() => {
    if (scores === null) return null;
    const idx = scores.findIndex((s) => s.player_id === me.id);
    return idx >= 0 ? idx + 1 : null;
  }, [scores, me.id]);

  // Player's game-2 opt-in (separate read; one row per game/player).
  const myParticipations = useMyParticipations(me.id);
  // Optimistic flag: postgres_changes for game_participations doesn't reach
  // device-cookie sessions (RLS evaluation differs from REST). When the
  // player taps Join Game 2, the API succeeds but the local hook never sees
  // the new row, so the screen would never advance. Flip this on success so
  // the state machine moves forward immediately. Same pattern as the
  // optimistic answer fix.
  const [optimisticInGame2, setOptimisticInGame2] = useState(false);
  const inGame2 = useMemo(() => {
    if (optimisticInGame2) return true;
    if (!game2) return false;
    return myParticipations.some((p) => p.game_id === game2.id);
  }, [myParticipations, game2, optimisticInGame2]);

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
        onJoinSuccess={() => setOptimisticInGame2(true)}
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
            themeKey={themeKey}
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
          onAnswerOptimistic={recordOptimisticAnswer}
          themeKey={themeKey}
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
        rank={myRank}
      />
    );
  }

  // ── Between questions: hold on the last reveal until the host moves on. ──
  // useRoom keeps the most-recently-finished question in lastResolvedQuestion
  // (separate from currentQuestion which is cleared when finished_at fires).
  // Render the reveal frame for it so the player sees correct/wrong + score
  // before the host clicks the next cell.
  const lastResolvedQuestion = snapshot.lastResolvedQuestion;
  if (lastResolvedQuestion) {
    const resolvedCategory = snapshot.categories.find(
      (c) => c.id === lastResolvedQuestion.category_id,
    );
    if (resolvedCategory) {
      const myAnswerForResolved =
        myAnswers.find((a) => a.question_id === lastResolvedQuestion.id) ?? null;
      return (
        <RevealView
          question={lastResolvedQuestion}
          category={resolvedCategory}
          myAnswer={myAnswerForResolved}
          player={me}
          myAnswers={myAnswers}
          categories={snapshot.categories}
          game={currentGame}
          rank={myRank}
        />
      );
    }
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

  // Magic-Welcome moment for THIS player on THEIR phone — color flash
  // + chime + (Android) haptic, fired exactly once per join.
  const showOwnWelcome = useOwnWelcomeMoment(me, snapshot.night?.id ?? null);

  return (
    <>
      <PlayerLobby
        playerName={me.display_name}
        inRoomCount={snapshot.players.length}
        newestNames={newest}
        hostName={hostName}
        venueName={snapshot.night?.venue_name ?? ""}
      />
      {showOwnWelcome ? <OwnWelcomeFlash playerId={me.id} /> : null}
    </>
  );
}

/**
 * Fires the joining player's OWN welcome moment exactly once per night
 * per player. The first time `me` resolves on the room route, we play
 * the chime + haptic and mount a brief color flash overlay.
 *
 * Gated by sessionStorage so reloading the room page doesn't refire
 * the welcome. Cleared on session end (closing the browser tab) so a
 * different player on the same device after the night ends still gets
 * their own welcome the next time.
 *
 * Returns true while the color-flash overlay should render (~700ms).
 */
function useOwnWelcomeMoment(me: PlayerRow, nightId: string | null): boolean {
  const [active, setActive] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!nightId) return;
    if (typeof window === "undefined") return;
    const key = `tr1via:welcome:${nightId}:${me.id}`;
    try {
      if (window.sessionStorage.getItem(key) === "1") return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage can throw in privacy modes — still play the
      // welcome, just don't suppress duplicate fires.
    }

    // Color flash + chime + haptic. Chime runs through the lazy
    // Web Audio context — iOS needs a recent user gesture, and the
    // /join → POST → /room redirect chain preserves that gesture
    // attribution within the same tab session.
    try {
      playWelcomeChime();
    } catch {
      /* silent */
    }
    triggerWelcomeHaptic();
    setActive(true);
    const dur = reduced ? 400 : 700;
    const handle = window.setTimeout(() => setActive(false), dur);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, nightId]);

  return active;
}

/**
 * A 700ms full-screen color wash with the player's color, captioned
 * "You're in. The room sees you." Fades in over 80ms and out over
 * 280ms. On iOS where the haptic is absent, this carries more visual
 * weight (per the brief).
 */
function OwnWelcomeFlash({ playerId }: { playerId: string }) {
  const color = playerColorHex(playerId);
  return (
    <div
      data-testid="own-welcome-flash"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: color,
        color: "#0E0805",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        animation: "tr1via-own-welcome 700ms ease-out forwards",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 700,
          fontSize: 28,
          letterSpacing: "-0.02em",
          textAlign: "center",
          padding: "0 28px",
          opacity: 0,
          animation: "tr1via-own-welcome-text 700ms ease-out forwards",
          animationDelay: "60ms",
        }}
      >
        You&rsquo;re in.
        <br />
        <span style={{ fontWeight: 500, color: "rgba(14,8,5,.78)" }}>
          The room sees you.
        </span>
      </div>
      <style>{`
        @keyframes tr1via-own-welcome {
          0%   { opacity: 0; }
          12%  { opacity: 1; }
          60%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes tr1via-own-welcome-text {
          0%   { opacity: 0; transform: translateY(6px); }
          30%  { opacity: 1; transform: translateY(0); }
          80%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="own-welcome-flash"] {
            animation: tr1via-own-welcome-instant 700ms linear forwards !important;
          }
          @keyframes tr1via-own-welcome-instant {
            0%, 90% { opacity: 1; }
            100%    { opacity: 0; }
          }
        }
      `}</style>
    </div>
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
  onAnswerOptimistic,
  themeKey,
}: {
  question: QuestionRow;
  category: CategoryRow;
  player: PlayerRow;
  roomCode: string;
  revealBroadcast: ReturnType<typeof useRoom>["lastBroadcast"];
  game: GameRow;
  categories: CategoryRow[];
  onAnswerOptimistic: (row: AnswerRow) => void;
  themeKey?: ThemeKey;
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
    durationS: questionDurationFor(themeKey),
    onZero: handleZero,
  });

  // Optimistic submit with exponential-backoff retry on transient failures.
  // The UI flips to "locked" the moment the player taps; the hook keeps
  // retrying in the background. A failed-after-retries state surfaces a
  // small retry prompt the player can tap to re-attempt manually.
  const { submit, status: submitStatus, retry } = useAnswerSubmit({
    questionId: question.id,
    scramble: Array.from(scramble),
  });
  const handleTap = useCallback(
    (slot: PlayerQuestionSlot) => {
      // Record optimistic answer locally so the page transitions to PlayerLocked
      // IMMEDIATELY, without waiting for postgres_changes (which is unreliable
      // for device-cookie sessions). The real row from useMyAnswers will
      // arrive moments later and supersede this one.
      const nowMs = Date.now();
      const msToLock = revealedAtMs !== null ? Math.max(0, nowMs - revealedAtMs) : 0;
      const chosenIndex = scramble[slot - 1] as 0 | 1 | 2 | 3;
      onAnswerOptimistic({
        id: `optimistic-${question.id}-${player.id}`,
        question_id: question.id,
        player_id: player.id,
        chosen_index: chosenIndex,
        scramble: [scramble[0], scramble[1], scramble[2], scramble[3]] as [number, number, number, number],
        locked_at: new Date(nowMs).toISOString(),
        ms_to_lock: msToLock,
        is_correct: null,
        awarded_points: null,
      });
      submit(slot);
    },
    [submit, onAnswerOptimistic, scramble, question.id, player.id, revealedAtMs],
  );

  const questionNumber = computeQuestionNumber(question, categories);

  return (
    <>
      <PlayerQuestion
        seconds={displaySeconds}
        category={category.name}
        value={question.point_value ?? 100}
        options={optionsInScrambleOrder}
        questionNumber={questionNumber}
        prompt={question.prompt}
        imageUrl={question.image_url}
        onTap={handleTap}
        disabled={submitStatus === "pending" || submitStatus === "sent"}
      />
      {submitStatus === "failed" && (
        <button
          type="button"
          onClick={retry}
          aria-label="Retry sending your answer"
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            background: "var(--wrong)",
            color: "#FFF",
            border: "none",
            borderRadius: 99,
            padding: "12px 22px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
            cursor: "pointer",
          }}
        >
          Couldn&rsquo;t send · Tap to retry
        </button>
      )}
    </>
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
  themeKey,
}: {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow;
  roomCode: string;
  allAnswers: AnswerRow[];
  categories: CategoryRow[];
  game: GameRow;
  themeKey?: ThemeKey;
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
  // counting down (everyone else is still racing). Also fire /resolve when
  // the timer hits zero — same handler as QuestionView. Without this, if
  // every player locks in early there is nobody mounted in QuestionView to
  // trigger the resolve, the server never sets finished_at, and every
  // phone sits on "Waiting for the room to lock in…" indefinitely. The
  // resolve route is idempotent — first call wins, the rest no-op.
  const revealedAtMs = question.played_at ? new Date(question.played_at).getTime() : null;
  const resolveCalled = useRef(false);
  const handleZero = useCallback(() => {
    if (resolveCalled.current) return;
    resolveCalled.current = true;
    void fetch(`/api/questions/${question.id}/resolve`, {
      method: "POST",
      credentials: "same-origin",
    }).catch((e) => console.warn("resolve failed (locked)", e));
  }, [question.id]);
  useEffect(() => {
    resolveCalled.current = false;
  }, [question.id]);
  const { displaySeconds } = useTimer({
    revealedAtMs,
    durationS: questionDurationFor(themeKey),
    onZero: handleZero,
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
  rank,
}: {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow | null;
  player: PlayerRow;
  myAnswers: AnswerRow[];
  categories: CategoryRow[];
  game: GameRow | null;
  /** Player's 1-based rank from game_scores. `null` while the scores
   *  fetch hasn't landed or the player isn't in the view — propagates
   *  down to PlayerRevealCorrect/Wrong which render "in the mix". */
  rank: number | null;
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
    const totalScore = sumAwarded(myAnswers, game);
    return (
      <PlayerRevealCorrect
        category={category.name}
        value={question.point_value ?? 100}
        awardedPoints={awarded}
        msToLock={myAnswer.ms_to_lock}
        streak={streak}
        rank={rank}
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
      rank={rank}
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
  onJoinSuccess,
}: {
  roomCode: string;
  me: PlayerRow;
  game1Id: string;
  game2Id: string;
  playerName: string;
  myAnswers: AnswerRow[];
  categories: CategoryRow[];
  /** Called once the join API returns OK so the parent can flip
   *  optimistic state and stop rendering this screen. */
  onJoinSuccess?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const stats = useMemo(() => summarizeGame(myAnswers, categories, game1Id), [
    myAnswers,
    categories,
    game1Id,
  ]);

  // The parent RoomStateMachine's scores subscription is scoped to
  // `currentGame` which here is game 2 (game 1 is done) — wrong game for this
  // screen. Scope a separate load+subscribe to game 1's scores so we can
  // render the player's game-1 final placement. Tri-state `null` = pending
  // → renders "Wrapped. Nice run." instead of "#0" while in flight.
  const [game1Scores, setGame1Scores] = useState<GameScoreRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const supa = getSupabaseBrowser();
    async function load() {
      const { data } = await supa
        .from("game_scores")
        .select("*")
        .eq("game_id", game1Id)
        .order("score", { ascending: false });
      if (cancelled) return;
      setGame1Scores((data as GameScoreRow[] | null) ?? []);
    }
    void load();
    const channel = supa
      .channel(`player-join-g2-scores:${game1Id}`)
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
        { event: "*", schema: "public", table: "game_participations" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [game1Id]);

  const finalRank = useMemo<number | null>(() => {
    if (game1Scores === null) return null;
    const idx = game1Scores.findIndex((s) => s.player_id === me.id);
    return idx >= 0 ? idx + 1 : null;
  }, [game1Scores, me.id]);

  const handleJoin = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/players/${me.id}/join-game`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameNo: 2 }),
      });
      if (res.ok) onJoinSuccess?.();
    } catch (e) {
      console.warn("join-game-2 failed", e);
    } finally {
      setSubmitting(false);
    }
  }, [me.id, submitting, onJoinSuccess]);

  return (
    <PlayerJoinGame2
      playerName={playerName}
      finalRank={finalRank}
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

/**
 * Pings POST /api/players/:id/heartbeat every 10s while the player is alive.
 *
 * The route returns 410 Gone when the host has kicked this player. The phone
 * uses that as the durable signal to exit — postgres_changes is unreliable
 * for device-cookie sessions (RLS quirk), so the periodic heartbeat doubles
 * as a removal check. On 410 we hard-navigate to /join so the player either
 * rejoins under a fresh row OR sees that the room is closed.
 */
function useHeartbeat(playerId: string | null, roomCode: string) {
  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    const send = async () => {
      try {
        const res = await fetch(`/api/players/${playerId}/heartbeat`, {
          method: "POST",
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (res.status === 410 && typeof window !== "undefined") {
          window.location.assign(`/join?code=${roomCode}`);
        }
      } catch {
        /* heartbeat is best-effort */
      }
    };
    // Immediate ping so the host sees us right away.
    void send();
    const handle = setInterval(() => void send(), HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [playerId, roomCode]);
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

/**
 * Subscribes to all of this player's answers across the night.
 *
 * `refreshKey` is an external bump (typically the most recent broadcast's
 * serverNow) — when it changes, we re-fetch from REST in addition to the
 * postgres_changes subscription. This compensates for the known device-
 * cookie-session RLS quirk: postgres_changes UPDATEs on the answers row
 * (where the resolve route sets is_correct + awarded_points) often DON'T
 * land for player sessions, so the local row stays at is_correct=null and
 * RevealView falls into PlayerRevealWrong for everyone. A REST refetch on
 * the resolve broadcast pulls the authoritative state.
 */
function useMyAnswers(playerId: string | null, refreshKey: string | null): AnswerRow[] {
  const [rows, setRows] = useState<AnswerRow[]>([]);
  useEffect(() => {
    if (!playerId) {
      setRows([]);
      return;
    }
    const pid = playerId;
    let cancelled = false;
    const supa = getSupabaseBrowser();
    async function refetch() {
      const { data } = await supa
        .from("answers")
        .select("*")
        .eq("player_id", pid)
        .order("locked_at", { ascending: true });
      if (cancelled) return;
      setRows((data as AnswerRow[] | null) ?? []);
    }
    void refetch();

    const channel = supa
      .channel(`answers:${pid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `player_id=eq.${pid}`,
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
  }, [playerId, refreshKey]);
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

// pickRecentReveal removed: its job is now handled by useRoom's
// lastResolvedQuestion + the new RevealView fallback in RoomBody.

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
