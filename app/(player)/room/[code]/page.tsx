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

import React, {
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
  fireJuneBeat,
  PyrotechnicsBeatConductor,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import {
  PlayerLobby,
  PlayerLockInBolt,
  PlayerQuestion,
  RoomMagicReactionControls,
  PlayerLocked,
  PlayerRevealCorrect,
  PlayerRevealCorrectSequence,
  PlayerRevealStandingsPanel,
  PlayerRevealWrong,
  PlayerJoinGame2,
  PlayerBetweenGames,
  type PlayerQuestionSlot,
} from "@/components/player";
import { useRoom } from "@/lib/hooks/useRoom";
import { useReachability } from "@/lib/realtime/reachability";
import { useRoomFallback } from "@/lib/room/roomFallbackStore";
import { useLockInSync } from "@/lib/hooks/useLockInSync";
import { useLockCount } from "@/lib/hooks/useLockCount";
import { shouldFireReveal, newLockIds } from "@/lib/player/waterPulse";
import { sumAwardedForGame } from "@/lib/player/revealTotal";
import { useTimer } from "@/lib/hooks/useTimer";
import { useDeviceSession } from "@/lib/hooks/useDeviceSession";
import { useAnswerSubmit } from "@/lib/hooks/useAnswerSubmit";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { scrambleFor, correctSlotFor } from "@/lib/game/scramble";
import { awardPoints } from "@/lib/game/score";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { playerColorHex } from "@/lib/player/playerColor";
import { selectBetweenGamesView, buildGame1Standings, type StandingRow } from "@/lib/player/betweenGames";
import { buildNeighborhood, buildNightStandings, type Neighborhood } from "@/lib/player/standings";
import { summarizeResolve, type ResolveSummary } from "@/lib/player/celebrationCopy";
import { gateBeatForPlayer, playerWasCorrect } from "@/lib/game/revealOutcome";
import { selectLobbyTopicsFromRoom, type LobbyTopic } from "@/lib/tv/lobbyTopics";
import { playWelcomeChime, triggerWelcomeHaptic } from "@/lib/audio/welcomeChime";
import {
  formatRoomCode,
  isValidRoomCode,
  parseRoomCode,
} from "@/lib/game/room-code";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { readThemeSeed, writeThemeSeed } from "@/lib/theme/themeSeed";
import { questionDurationFor, lockInCeremonyFor } from "@/lib/theme/lockInCeremony";
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

  // Seed the first paint from the /join → /room hand-off so the room shows the
  // night's real theme immediately instead of flashing resolveTheme's month/
  // default fallback while useRoom fetches the night row. Read once on mount.
  const [seededTheme] = useState<ThemeKey | null>(() => readThemeSeed(roomCode));

  const resolvedTheme: ThemeKey = resolveTheme(
    snapshot.night,
    { default_theme_key: snapshot.hostDefaultThemeKey },
  );
  // Until the night row loads, prefer the seed (correct) over the month/default
  // fallback. Once the night is in hand, the resolved theme is authoritative.
  const themeKey: ThemeKey = snapshot.night ? resolvedTheme : (seededTheme ?? resolvedTheme);

  // Keep the seed fresh so a same-tab refresh of /room stays flash-free.
  useEffect(() => {
    if (snapshot.night) writeThemeSeed(roomCode, resolvedTheme);
  }, [snapshot.night, roomCode, resolvedTheme]);

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
  const finalGameIds = useMemo<string[]>(() => {
    return snapshot.games.map((game) => game.id);
  }, [snapshot.games]);

  useEffect(() => {
    if (!snapshot.night?.closed_at) return;
    if (!me || finalGameIds.length === 0) return;
    // We need a night-wide leaderboard to know who's #1. We fire a small query
    // rather than threading it through useRoom — happens once on close.
    let cancelled = false;
    void (async () => {
      try {
        const winnerId = await fetchWinnerId(finalGameIds);
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
  }, [snapshot.night?.closed_at, me, finalGameIds, roomCode, router]);

  // ── Unreachable: the browser→Supabase reads are blocked (restrictive venue
  //    WiFi). Show an actionable "switch to a hotspot" screen instead of an
  //    endless "Catching up…" spinner or the misleading "isn't open" screen.
  //    Checked BEFORE loading/night-null because those would mask it. Clears on
  //    its own when useRoom's self-healing retry reconnects (no refresh). ──
  const reachability = useReachability();
  if (reachability === "unreachable") {
    return <UnreachableScreen roomCode={roomCode} />;
  }

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
  const roomMagicEnabled = Boolean(snapshot.night?.room_magic_enabled);

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

  // Map every picked question_id → its game_id for the whole night so the reveal
  // running total can be scoped to the CURRENT game — the phone must match the
  // TV's per-game leaderboard, not sum both games together (#2). The room
  // snapshot only carries the live + last-resolved question, so fetch the night's
  // question→category once (categories already carry game_id; players may read
  // id/category_id but not correct_index per the column grant). Refreshes if the
  // category set changes — game 2's categories are added during setup.
  const [questionGameMap, setQuestionGameMap] = useState<Map<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    const categories = snapshot.categories;
    if (categories.length === 0) return;
    const categoryGame = new Map(categories.map((c) => [c.id, c.game_id]));
    const categoryIds = categories.map((c) => c.id);
    let cancelled = false;
    const supa = getSupabaseBrowser();
    void (async () => {
      const { data } = await supa
        .from("questions")
        .select("id, category_id")
        .in("category_id", categoryIds);
      if (cancelled || !data) return;
      const map = new Map<string, string>();
      for (const row of data as Array<{ id: string; category_id: string }>) {
        const gameId = categoryGame.get(row.category_id);
        if (gameId) map.set(row.id, gameId);
      }
      setQuestionGameMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshot.categories]);

  // June: the water reflects the reveal the moment this phone enters it. The
  // snapshot clears currentQuestion when finished_at fires and holds the reveal
  // via lastResolvedQuestion, so read whichever carries the just-resolved id.
  // shouldFireReveal de-dups so it fires exactly once per resolved question.
  const lastRevealFiredRef = useRef<string | null>(null);
  const resolvedQId =
    (currentQuestion && currentQuestion.finished_at !== null
      ? currentQuestion.id
      : snapshot.lastResolvedQuestion?.id) ?? null;
  useEffect(() => {
    if (themeKey !== "june") return;
    if (shouldFireReveal(resolvedQId, lastRevealFiredRef.current)) {
      lastRevealFiredRef.current = resolvedQId;
      fireJuneBeat("reveal");
    }
  }, [themeKey, resolvedQId]);

  // June: every lock-in ripples this phone's water — the room's pulse felt on
  // your own screen. Own lock is known locally (instant); other players' locks
  // ride the existing lock-sync poll (raw realtime is the weak spot on phones).
  // de-dup by playerId so a lock ripples once; coalesce bursts to ~1/250ms so a
  // full room reads as a living surface, not noise.
  const rippledLocksRef = useRef<Set<string>>(new Set());
  const lastRippleAtRef = useRef<number>(0);
  const rippleForLocks = useCallback(
    (playerIds: string[]) => {
      if (themeKey !== "june") return;
      const fresh = newLockIds(playerIds, rippledLocksRef.current);
      if (fresh.length === 0) return;
      for (const id of fresh) rippledLocksRef.current.add(id);
      const now = Date.now();
      if (now - lastRippleAtRef.current < 250) return; // coalesce bursts
      lastRippleAtRef.current = now;
      fireJuneBeat("lock");
    },
    [themeKey],
  );

  // Each question is a fresh round of locks. Clear the set IN PLACE (not a new
  // Set) so the reference useLockInSync captured stays the same object and sees
  // the cleared state immediately, without needing a re-render.
  useEffect(() => {
    rippledLocksRef.current.clear();
  }, [currentQuestion?.id]);

  // Own lock — the moment my answer for the live question exists (instant).
  const myLiveLockId = useMemo(() => {
    if (!currentQuestion) return null;
    return myAnswers.some((a) => a.question_id === currentQuestion.id) ? me.id : null;
  }, [currentQuestion, myAnswers, me.id]);
  useEffect(() => {
    if (myLiveLockId) rippleForLocks([myLiveLockId]);
  }, [myLiveLockId, rippleForLocks]);

  // Other players' locks — reliable server poll (/api/games/:id/locks, scoped
  // to the current live question). Inactive for non-june themes (no polling).
  useLockInSync({
    gameId: currentGame?.id ?? "",
    active: themeKey === "june" && !!currentGame?.id,
    acknowledged: rippledLocksRef.current,
    onMissed: (lock) => rippleForLocks([lock.playerId]),
  });

  // ── load + subscribe to game_scores for the current game ───────────────
  // Same load+subscribe pattern HostLiveConsoleClient + the recap page use.
  // Tri-state: `null` = pending (haven't completed a fetch yet) so the reveal
  // surfaces render an unnumbered "in the mix" tag instead of "#0" while
  // the initial REST query is in flight, or when the player is missing from
  // the view (no game_participations row → silently absent forever).
  const [directScores, setDirectScores] = useState<GameScoreRow[] | null>(null);
  const currentGameId = currentGame?.id ?? null;
  // Degraded network: prefer the server-route scores over the direct
  // subscription. The subscription stays mounted so it's warm on recovery.
  const { backupMode: scoresBackupMode, payload: scoresPayload } = useRoomFallback();
  const scores = scoresBackupMode && scoresPayload ? scoresPayload.scores : directScores;
  useEffect(() => {
    if (!currentGameId) {
      setDirectScores(null);
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
      setDirectScores((data as GameScoreRow[] | null) ?? []);
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

  // Bolt ceremony: fires when the server confirms the player's answer.
  // Rendered once outside all branch returns (position:fixed, pointer-events:none)
  // so the overlay survives the QuestionView→LockedView switch on optimistic lock-in.
  // The phone bolt is a LIGHTNING visual, so it's gated to the lightning ceremony
  // (May) specifically — NOT generic hasCeremony(). July's ceremony is "fireworks",
  // and July phones get their earned reveal fireworks (Phase 3) instead of a strike;
  // a lightning bolt on the 4th would be off-theme.
  const [boltActive, setBoltActive] = useState(false);
  const handleServerConfirm = useCallback(() => {
    if (lockInCeremonyFor(themeKey).ceremony !== "lightning") return;
    setBoltActive(true);
  }, [themeKey]);
  // Reset if a new question arrives while the bolt is still playing.
  useEffect(() => {
    setBoltActive(false);
  }, [currentQuestion?.id]);

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

  // ── July fireworks (Phase 3) ───────────────────────────────────────────
  // The resolve broadcast carries per-player `awards` (already on the phone — no
  // new read). Derive the social counts straight from it for the matching
  // question. Read from state during render (not a ref) so it stays consistent;
  // if a later broadcast supersedes lastBroadcast, the line simply stops showing
  // (graceful) rather than rendering a stale/wrong count.
  const summaryFor = (qid: string | undefined): ResolveSummary | undefined => {
    const b = snapshot.lastBroadcast;
    if (!qid || !b || b.event !== "resolve" || b.questionId !== qid) return undefined;
    return summarizeResolve(b.awards);
  };

  // Did I get the just-resolved question right? Drives the correct-only salvo
  // gate below (a finale fires for everyone; a salvo fires only on a correct
  // phone). Mirrors RevealView's wasCorrect via the shared playerWasCorrect.
  const resolvedQuestion =
    snapshot.currentQuestion?.finished_at
      ? snapshot.currentQuestion
      : snapshot.lastResolvedQuestion;
  const myResolvedAnswer = resolvedQuestion
    ? myAnswers.find((a) => a.question_id === resolvedQuestion.id) ?? null
    : null;
  const amCorrect = playerWasCorrect(myResolvedAnswer, resolvedQuestion?.correct_index ?? null);
  const neighborhood: Neighborhood = buildNeighborhood(scores ?? [], me.id, 4);

  // ── Compute the screen content. The bolt overlay is rendered once below,
  //    outside this branch, so it persists across the QuestionView→LockedView
  //    transition that happens on optimistic lock-in.
  let inner: React.ReactNode;

  // ── Between games: 'join' recap (not opted in) or 'waiting' (opted in, G2 not started) ──
  //    selectBetweenGamesView returns null the moment game 2 goes live, so the
  //    question flow below resumes on its own — no separate auto-advance signal.
  const betweenView = selectBetweenGamesView({
    game1State: game1?.state ?? null,
    game2State: game2?.state ?? null,
    inGame2,
  });
  if (betweenView && game1 && game2) {
    inner = (
      <PlayerBetweenGamesWired
        roomCode={roomCode}
        me={me}
        game1Id={game1.id}
        game2Id={game2.id}
        playerName={me.display_name}
        myAnswers={myAnswers}
        categories={snapshot.categories}
        joined={betweenView === "waiting"}
        onJoinSuccess={() => setOptimisticInGame2(true)}
        // The same "Tonight's Topics" the TV/lobby show — here it resolves to the
        // UPCOMING game 2's ready categories (selectLobbyTopicsFromRoom skips the
        // done game 1) so both between-games looks can preview what's next.
        topics={selectLobbyTopicsFromRoom(snapshot)}
      />
    );
  } else if (!currentGame || currentGame.state === "draft" || currentGame.state === "ready") {
    // ── Lobby: pre-game (no game yet, or game in draft/ready) ──
    inner = (
      <LobbyView
        snapshot={snapshot}
        me={me}
      />
    );
  } else if (currentQuestion && currentCategory) {
    // ── Live or just-resolved question paths ──
    const myAnswerForQ =
      myAnswers.find((a) => a.question_id === currentQuestion.id) ?? null;
    const isResolved = currentQuestion.finished_at !== null;
    if (!isResolved) {
      if (myAnswerForQ) {
        inner = (
          <LockedView
            question={currentQuestion}
            category={currentCategory}
            myAnswer={myAnswerForQ}
            roomCode={roomCode}
            allAnswers={myAnswers}
            categories={snapshot.categories}
            game={currentGame}
            themeKey={themeKey}
            standings={buildGame1Standings(scores ?? [], me.id)}
            totalPlayers={scores && scores.length > 0 ? scores.length : snapshot.players.length}
            roomMagicEnabled={roomMagicEnabled}
          />
        );
      } else {
        inner = (
          <QuestionView
            question={currentQuestion}
            category={currentCategory}
            player={me}
            roomCode={roomCode}
            revealBroadcast={snapshot.lastBroadcast}
            game={currentGame}
            categories={snapshot.categories}
            onAnswerOptimistic={recordOptimisticAnswer}
            onServerConfirm={handleServerConfirm}
            themeKey={themeKey}
          />
        );
      }
    } else {
      // Resolved. Show reveal-correct or reveal-wrong for THIS question.
      inner = (
        <RevealView
          key={currentQuestion.id}
          question={currentQuestion}
          category={currentCategory}
          myAnswer={myAnswerForQ}
          player={me}
          myAnswers={myAnswers}
          categories={snapshot.categories}
          game={currentGame}
          questionGameMap={questionGameMap}
          rank={myRank}
          themeKey={themeKey}
          summary={summaryFor(currentQuestion.id)}
          neighborhood={neighborhood}
          roomMagicEnabled={roomMagicEnabled}
        />
      );
    }
  } else {
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
        inner = (
          <RevealView
            key={lastResolvedQuestion.id}
            question={lastResolvedQuestion}
            category={resolvedCategory}
            myAnswer={myAnswerForResolved}
            player={me}
            myAnswers={myAnswers}
            categories={snapshot.categories}
            game={currentGame}
            questionGameMap={questionGameMap}
            rank={myRank}
            themeKey={themeKey}
            summary={summaryFor(lastResolvedQuestion.id)}
            neighborhood={neighborhood}
            roomMagicEnabled={roomMagicEnabled}
          />
        );
      }
    }

    // Live game with no question on deck and no recent reveal → idle.
    if (!inner) inner = <BetweenView playerName={me.display_name} />;
  }

  return (
    <>
      {boltActive && me && (
        <PlayerLockInBolt
          active={true}
          tint={playerColorHex(me.id)}
          onComplete={() => setBoltActive(false)}
        />
      )}
      {inner}
      {/* July: schedule the synchronized firework beat for THIS phone. A finale
          (game end) fires for everyone; a per-question salvo fires only when I
          got it right (gateBeatForPlayer). Render-less; no-op on non-July. */}
      {themeKey === "july" && (
        <PyrotechnicsBeatConductor
          beat={gateBeatForPlayer(
            snapshot.lastFireworksBeat,
            amCorrect,
            resolvedQuestion?.id ?? null,
          )}
        />
      )}
    </>
  );
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

  // The same "Tonight's Topics" the venue TV shows — the upcoming game's
  // ready categories — surfaced on the phone so a just-joined player sees
  // what tonight is about while waiting for the host to start.
  const topics = useMemo(() => selectLobbyTopicsFromRoom(snapshot), [snapshot]);

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
        topics={topics}
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
  onServerConfirm,
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
  /** Called the moment the server confirms the answer. Used to fire
   *  the bolt ceremony from the parent, which survives this unmount. */
  onServerConfirm: () => void;
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
  const { submit, status: submitStatus, retry, confirmedAt } = useAnswerSubmit({
    questionId: question.id,
    scramble: Array.from(scramble),
  });

  // Propagate server confirmation up to the parent (RoomStateMachine) so
  // the bolt overlay can survive the QuestionView→LockedView unmount.
  // confirmedAt fires ~150-300ms after the tap; by that point QuestionView
  // may already be gone if the optimistic answer flipped the parent screen.
  useEffect(() => {
    if (!confirmedAt) return;
    onServerConfirm();
    // onServerConfirm identity is stable (useCallback in parent); confirmedAt
    // transitions null→number exactly once per question mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedAt]);

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
  game,
  themeKey,
  standings,
  totalPlayers,
  roomMagicEnabled,
}: {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow;
  roomCode: string;
  allAnswers: AnswerRow[];
  categories: CategoryRow[];
  game: GameRow;
  themeKey?: ThemeKey;
  standings?: { top: StandingRow[]; you: StandingRow | null };
  /** Players who can answer this question — denominator for the live bar. */
  totalPlayers: number;
  roomMagicEnabled: boolean;
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

  // Live "X of Y locked in" — poll the canonical locks list while this screen
  // is mounted (the player has locked and is watching the room catch up).
  const lockedCount = useLockCount({ gameId: game.id, active: true });

  return (
    <PlayerLocked
      category={category.name}
      value={question.point_value ?? 100}
      options={options}
      chosenSlot={chosenSlot}
      seconds={displaySeconds}
      msToLock={myAnswer.ms_to_lock}
      questionNumber={questionNumber}
      lockedCount={lockedCount}
      totalPlayers={totalPlayers}
      standings={standings}
      roomMagicEnabled={roomMagicEnabled}
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
  questionGameMap,
  rank,
  themeKey,
  summary,
  neighborhood,
  roomMagicEnabled,
}: {
  question: QuestionRow;
  category: CategoryRow;
  myAnswer: AnswerRow | null;
  player: PlayerRow;
  myAnswers: AnswerRow[];
  categories: CategoryRow[];
  game: GameRow | null;
  /** question_id → game_id for the whole night; scopes the running total to the
   *  current game so the phone matches the TV's per-game leaderboard (#2). */
  questionGameMap: ReadonlyMap<string, string>;
  /** Player's 1-based rank from game_scores. `null` while the scores
   *  fetch hasn't landed or the player isn't in the view — propagates
   *  down to PlayerRevealCorrect/Wrong which render "in the mix". */
  rank: number | null;
  /** Active theme — gates the July dark→bright correct sequence. */
  themeKey: ThemeKey;
  /** Per-question resolve counts (correct/answered) for the social lines. */
  summary: ResolveSummary | undefined;
  /** ±4 standings shown inside the reveal hold. */
  neighborhood: Neighborhood;
  /** Night-level Room Magic flag. Controls still mount only post-resolve. */
  roomMagicEnabled: boolean;
}) {
  // Use the player's saved scramble when we have an answer; otherwise compute
  // it deterministically so the correct slot still maps correctly.
  const scramble = myAnswer?.scramble ?? scrambleFor(question.id, player.id);

  // The answer (correct_index) reaches the player post-resolve via the resolve/
  // end-early broadcast hint or the 'resolve' reveal metadata — players can't
  // read it off the questions row (migration 0014). In the rare window before it
  // lands (a transient reveal-read miss, or a not-yet-joined spectator), do NOT
  // compute a right/wrong verdict: with correct_index absent, `wasCorrect` below
  // would flip a player who picked correctly to "WRONG" with a blank answer —
  // the exact live complaint documented at `wasCorrect`. Hold on a neutral frame
  // instead; the broadcast / 15s heartbeat fills correct_index in (usually
  // instant), and this re-renders into the real reveal.
  if (typeof question.correct_index !== "number") {
    return <RevealPendingView category={category.name} />;
  }

  const correctSlot = correctSlotFor(scramble as number[], question.correct_index) as
    | 1
    | 2
    | 3
    | 4;
  const correctText = question.options[question.correct_index];
  const roomMagicControls =
    roomMagicEnabled && question.finished_at ? (
      <RoomMagicReactionControls questionId={question.id} enabled={true} />
    ) : null;

  // Source the right/wrong decision from the data already on hand — the
  // player's own chosen_index plus the question's correct_index — rather
  // than waiting on the server-set `is_correct` echo. The resolve route
  // does set is_correct true/false on the answer row, but it lands via a
  // separate REST refetch keyed off the resolve broadcast (see
  // `useMyAnswers`). For a few hundred ms after the broadcast arrives,
  // is_correct is still null — `null === true` evaluates to false, so
  // players who picked correctly briefly see PlayerRevealWrong. Reported
  // live by Brandon during the first host's first night: "customers complain of
  // ... they got the wrong answer even when they selected the right
  // answer." Trust either source; OR-logic means any signal of correct
  // wins. Still respects post-resolve overrides (e.g., host mark-correct)
  // — those flip is_correct=true and the first branch fires.
  const wasCorrect =
    myAnswer != null &&
    (myAnswer.is_correct === true ||
      myAnswer.chosen_index === question.correct_index);

  if (wasCorrect && myAnswer) {
    const standingsPanel = (
      <PlayerRevealStandingsPanel
        rows={neighborhood.rows}
        meRank={neighborhood.meRank}
        total={neighborhood.total}
        surface="payoff"
      />
    );
    const awarded =
      myAnswer.awarded_points ??
      awardPoints({
        pointValue: question.point_value ?? 100,
        correct: true,
        msToLock: myAnswer.ms_to_lock,
      });
    const streak = computeStreak(myAnswers, question, categories, game);
    // #108's per-game total (cross-game-safe) feeding July's payoff structure.
    const totalScore = sumAwardedForGame(myAnswers, game?.id ?? null, questionGameMap);
    const payoffProps = {
      category: category.name,
      value: question.point_value ?? 100,
      awardedPoints: awarded,
      msToLock: myAnswer.ms_to_lock,
      streak,
      rank,
      totalScore,
      rankDelta: 0,
      nextHint: "Hold tight — the next question is on its way.",
      roomMagicControls,
      standingsPanel,
    };
    // July: a dark fireworks moment (ignited in sync with the TV by the gated
    // conductor) → the bright payoff. Other themes go straight to the payoff.
    return themeKey === "july" ? (
      <PlayerRevealCorrectSequence
        correctCount={summary?.correctCount}
        payoffProps={payoffProps}
      />
    ) : (
      <PlayerRevealCorrect {...payoffProps} correctCount={summary?.correctCount} />
    );
  }

  // Wrong, or no answer at all.
  const chosenSlot = myAnswer
    ? ((scramble.indexOf(myAnswer.chosen_index) + 1) as 1 | 2 | 3 | 4)
    : null;
  const chosenText = myAnswer ? question.options[myAnswer.chosen_index] ?? "" : "";
  const totalScore = sumAwardedForGame(myAnswers, game?.id ?? null, questionGameMap);
  const standingsPanel = (
    <PlayerRevealStandingsPanel
      rows={neighborhood.rows}
      meRank={neighborhood.meRank}
      total={neighborhood.total}
      surface="theme"
    />
  );
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
      correctCount={summary?.correctCount}
      answeredCount={summary?.answeredCount}
      roomMagicControls={roomMagicControls}
      standingsPanel={standingsPanel}
    />
  );
}

// ─── REVEAL PENDING ──────────────────────────────────────────────────────
// Brief holding frame for the window after a question resolves but before the
// answer (correct_index) has reached this device — see RevealView's guard.
// Never shows a right/wrong verdict, so a correct player is never flashed as
// "wrong" while the answer is still in flight.

function RevealPendingView({ category }: { category: string }) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={category.toUpperCase()} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Display size={52} color={t.ink}>
          Revealing the
          <br />
          <span style={{ color: t.accent }}>answer…</span>
        </Display>
        <div style={{ marginTop: 14, color: t.inkMid, fontSize: 15, lineHeight: 1.45 }}>
          Locking in the results.
        </div>
      </div>
    </PhoneScreen>
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

function PlayerBetweenGamesWired({
  me,
  game1Id,
  game2Id: _game2Id,
  playerName,
  myAnswers,
  categories,
  joined,
  onJoinSuccess,
  topics,
}: {
  roomCode: string;
  me: PlayerRow;
  game1Id: string;
  game2Id: string;
  playerName: string;
  myAnswers: AnswerRow[];
  categories: CategoryRow[];
  /** Player has opted into game 2 and is waiting for it to start → render the
   *  Between Games screen (Look B). Otherwise the join recap (Look A). */
  joined: boolean;
  /** Called once the join API returns OK so the parent can flip
   *  optimistic state and stop rendering this screen. */
  onJoinSuccess?: () => void;
  /** Upcoming game 2's ready topics — previewed on both looks. */
  topics: LobbyTopic[];
}) {
  const [submitting, setSubmitting] = useState(false);

  // RoomSnapshot doesn't carry every question for the night (only the live
  // and most-recently-resolved one), but the wrap screen needs to know which
  // category each answered question belongs to so the "best category" stat
  // can pick from the actually-played categories instead of a placeholder.
  // One-shot fetch on mount — game 1 is done at this point so the data is
  // settled (no realtime subscription needed).
  const [questionCategoryMap, setQuestionCategoryMap] = useState<
    Map<string, string>
  >(new Map());
  useEffect(() => {
    let cancelled = false;
    const supa = getSupabaseBrowser();
    const game1CategoryIds = categories
      .filter((c) => c.game_id === game1Id)
      .map((c) => c.id);
    if (game1CategoryIds.length === 0) return;
    async function load() {
      const { data } = await supa
        .from("questions")
        .select("id, category_id")
        .in("category_id", game1CategoryIds);
      if (cancelled || !data) return;
      const map = new Map<string, string>();
      for (const row of data as Array<{ id: string; category_id: string }>) {
        map.set(row.id, row.category_id);
      }
      setQuestionCategoryMap(map);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [categories, game1Id]);

  const stats = useMemo(
    () => summarizeGame(myAnswers, categories, questionCategoryMap),
    [myAnswers, categories, questionCategoryMap],
  );

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

  // Full ranked standings for the "waiting" (joined) look — reuses the same
  // game-1 leaderboard already loaded above for the final-rank stat.
  const standings = useMemo(
    () => buildGame1Standings(game1Scores ?? [], me.id),
    [game1Scores, me.id],
  );

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

  if (joined) {
    return (
      <PlayerBetweenGames
        playerName={playerName}
        top={standings.top}
        you={standings.you}
        topics={topics}
      />
    );
  }

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
      topics={topics}
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

function UnreachableScreen({ roomCode }: { roomCode: string }) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`ROOM · ${formatRoomCode(roomCode)}`} />
      <div
        data-testid="player-unreachable"
        role="status"
        aria-live="polite"
        style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 24 }}
      >
        <Eyebrow color={t.wrong} size={11}>
          CAN&apos;T REACH THE SERVER
        </Eyebrow>
        <Display size={48} color={t.ink}>
          Switch to a
          <br />
          <span style={{ color: t.accent }}>hotspot.</span>
        </Display>
        <div style={{ marginTop: 16, color: t.inkMid, fontSize: 15, lineHeight: 1.45 }}>
          This Wi-Fi is blocking the game. Switch this phone to a personal
          hotspot or cellular data — you&apos;ll reconnect automatically, no
          refresh needed.
        </div>
        <div
          style={{
            marginTop: "auto",
            padding: "16px 20px",
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
            Trying to reconnect…
          </span>
        </div>
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
  // Degraded network: prefer the server-route payload (this player's answers)
  // over the direct subscription, which is stalling. The subscription keeps
  // running so it's warm when realtime recovers.
  const { backupMode, payload } = useRoomFallback();
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
  return backupMode && payload ? payload.myAnswers : rows;
}

/** Subscribes to this player's game_participations rows (which games they joined). */
function useMyParticipations(playerId: string | null): ParticipationRow[] {
  const [rows, setRows] = useState<ParticipationRow[]>([]);
  const { backupMode, payload } = useRoomFallback();
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
  return backupMode && payload ? payload.myParticipations : rows;
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

// The recap/summary sums every answer it's handed (its caller already scopes to
// one game), so it passes gameId=null + this empty map. The LIVE reveal instead
// uses sumAwardedForGame with the real night-wide question→game map (#2).
const EMPTY_QUESTION_GAME_MAP: ReadonlyMap<string, string> = new Map();

function summarizeGame(
  answers: AnswerRow[],
  categories: CategoryRow[],
  questionCategoryMap: Map<string, string>,
): {
  score: number;
  bestCategory: string;
  bestCategoryRatio: string;
  fastestSeconds: number;
} {
  const score = sumAwardedForGame(answers, null, EMPTY_QUESTION_GAME_MAP);
  const correct = answers.filter((a) => a.is_correct === true);
  const fastestMs = correct.length
    ? Math.min(...correct.map((a) => a.ms_to_lock))
    : 0;

  // Best category: group the player's answers by category, pick the bucket
  // with the most correct answers (primary), most points (tiebreak 1), most
  // attempts (tiebreak 2), alphabetical name (tiebreak 3 for determinism).
  // If the question→category map hasn't loaded yet or the player has no
  // answers at all, show "—" / "0/0" rather than a placeholder name that
  // could mislead the player about what they played.
  const perCategory = new Map<
    string,
    { correct: number; attempts: number; points: number }
  >();
  for (const a of answers) {
    const categoryId = questionCategoryMap.get(a.question_id);
    if (!categoryId) continue;
    const bucket = perCategory.get(categoryId) ?? {
      correct: 0,
      attempts: 0,
      points: 0,
    };
    bucket.attempts += 1;
    if (a.is_correct === true) bucket.correct += 1;
    bucket.points += a.awarded_points ?? 0;
    perCategory.set(categoryId, bucket);
  }

  let bestCategoryId: string | null = null;
  let bestBucket: { correct: number; attempts: number; points: number } | null =
    null;
  for (const [categoryId, bucket] of perCategory) {
    if (!bestBucket) {
      bestCategoryId = categoryId;
      bestBucket = bucket;
      continue;
    }
    const better =
      bucket.correct > bestBucket.correct ||
      (bucket.correct === bestBucket.correct &&
        bucket.points > bestBucket.points) ||
      (bucket.correct === bestBucket.correct &&
        bucket.points === bestBucket.points &&
        bucket.attempts > bestBucket.attempts) ||
      (bucket.correct === bestBucket.correct &&
        bucket.points === bestBucket.points &&
        bucket.attempts === bestBucket.attempts &&
        (categories.find((c) => c.id === categoryId)?.name ?? "") <
          (categories.find((c) => c.id === bestCategoryId)?.name ?? ""));
    if (better) {
      bestCategoryId = categoryId;
      bestBucket = bucket;
    }
  }

  const bestCategoryName = bestCategoryId
    ? (categories.find((c) => c.id === bestCategoryId)?.name ?? "—")
    : "—";
  const bestCategoryRatio = bestBucket
    ? `${bestBucket.correct}/${bestBucket.attempts}`
    : "0/0";

  return {
    score,
    bestCategory: bestCategoryName,
    bestCategoryRatio,
    fastestSeconds: fastestMs > 0 ? Number((fastestMs / 1000).toFixed(1)) : 0,
  };
}

// pickRecentReveal removed: its job is now handled by useRoom's
// lastResolvedQuestion + the new RevealView fallback in RoomBody.

// ─── WINNER LOOKUP ───────────────────────────────────────────────────────

async function fetchWinnerId(gameIds: string[]): Promise<string | null> {
  const supa = getSupabaseBrowser();
  const { data } = await supa
    .from("game_scores")
    .select("*")
    .in("game_id", gameIds);
  if (!data || data.length === 0) return null;
  const [winner] = buildNightStandings(data as GameScoreRow[]);
  return winner?.player_id ?? null;
}
