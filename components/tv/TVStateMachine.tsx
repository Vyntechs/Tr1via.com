// TVStateMachine — the single pure renderer for the venue TV surface.
//
// Takes a TVSnapshot (the curated payload normally produced by /api/tv/:code/
// snapshot) and renders whichever TV component the moment calls for:
//
//   live game?  ┐
//     ├ live question?  → TVQuestion (with live lock-in pile)
//     │                    → TVReveal / TVRevealStumper on resolve
//     │
//     └ between questions → TVGrid
//   no game live?
//     ├ game 1 setup     → TVLobby
//     ├ game 1 done, no g2 → TVIntermission
//     └ game 2 done OR night closed → TVFinaleWinner
//
// Pure — no fetches, no subscriptions, no router. Just snapshot in → JSX out.
// Used in two places today:
//   1. app/tv/[code]/page.tsx — the standalone venue-TV route (anonymous;
//      pulls the snapshot via useTVRoom).
//   2. components/host/HostLiveConsole.tsx — embedded into the host's mid-
//      game console so the host's laptop, when HDMI'd to the venue TV,
//      shows both surfaces in one browser window without an iframe (the
//      host adapts its useRoom snapshot via lib/host/roomToTVSnapshot.ts).
//
// The 16:9 stage frame stays per-callsite: the standalone TV scales to the
// full viewport, the inline host embed sizes via its parent's grid.
"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  TVFinaleWinner,
  TVGrid,
  TVIntermission,
  TVLeaderboard,
  TVLobby,
  TVQuestion,
  TVReveal,
  TVRevealStumper,
  type TVGridCell,
  type TVGridLeaderRow,
  type TVIntermissionPodiumRow,
  type TVIntermissionStat,
  type TVLeaderboardRow,
  type TVLobbyWelcomeEvent,
  type TVQuestionTile,
  type TVRevealFastest,
  type TVStumperFastest,
} from "@/components/tv";
import { TVLockInCeremony, type CeremonyEvent } from "@/components/tv/TVLockInCeremony";
import type { MarqueeChip } from "@/components/tv/TVScoreboardMarquee";
import { formatRoomCode } from "@/lib/game/room-code";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { useTimer } from "@/lib/hooks/useTimer";
import { useLockInSync } from "@/lib/hooks/useLockInSync";
import { playerColorHex } from "@/lib/player/playerColor";
import { hasCeremony, hasMarquee } from "@/lib/theme/lockInCeremony";
import { shouldHoldReveal } from "@/lib/tv/revealPause";
import { selectLobbyTopics } from "@/lib/tv/lobbyTopics";
import type { ThemeKey } from "@/lib/theme/tokens";
import { fireJuneBeat } from "@/components/system";

const STUMPER_THRESHOLD = 4; // ≤ this many got it = use the stumper variant

export interface TVStateMachineProps {
  snapshot: TVSnapshot;
  /** Server timestamp of the most recent `reveal` broadcast — used to
   *  align the TV question timer against the broadcast moment instead of
   *  the (possibly slightly later) played_at column. Optional. */
  lastBroadcastRevealedAt?: string | null;
  /** Server's "now" at the moment the broadcast was sent — used to derive
   *  client-clock skew. Optional. */
  lastBroadcastServerNow?: string | null;
  /** Host-only: when provided, the in-grid cells become clickable buttons
   *  and fire this handler with the picked question id. The standalone
   *  `/tv/[code]` route omits it so the audience surface stays inert. */
  onGridCellClick?: (questionId: string) => void;
  /** Host-only: when true, the sticky-reveal branch is skipped and the
   *  grid renders instead — used after the host taps "Pick next →" during
   *  a stuck reveal frame so they can choose the next cell. The audience
   *  sees the same flip, which is intended ("the host is choosing the
   *  next one"). */
  hostAdvanced?: boolean;
  /** Magic-Welcome — when a new player just joined, the parent passes
   *  the event down so TVLobby can fire the slide-in overlay. The parent
   *  owns the timer (mounts the event for ~3s after a player-joined
   *  broadcast, then unmounts by passing null). */
  welcomeEvent?: TVLobbyWelcomeEvent | null;
  /** The resolved theme for this night — drives the question timer duration
   *  (30s for every theme). When omitted, useTimer falls back to the
   *  registry default (30s). */
  themeKey?: ThemeKey;
}

export function TVStateMachine({
  snapshot,
  lastBroadcastRevealedAt = null,
  lastBroadcastServerNow = null,
  onGridCellClick,
  hostAdvanced = false,
  welcomeEvent = null,
  themeKey,
}: TVStateMachineProps) {
  const games = snapshot.games;
  const game1 = games.find((g) => g.gameNo === 1) ?? null;
  const game2 = games.find((g) => g.gameNo === 2) ?? null;
  const currentGame = games.find((g) => g.id === snapshot.currentGameId) ?? null;

  const nightClosed = snapshot.night.closedAt !== null;
  const isFinale =
    nightClosed ||
    (game2?.state === "done") ||
    // Edge case: only game 1 exists and it's done → still treat as finale.
    (game1?.state === "done" && !game2);

  const intermission =
    game1?.state === "done" &&
    !!game2 &&
    game2.state !== "done" &&
    !isFinale;

  // Live question handling. A "current" question is one whose row exists
  // with played_at set; we keep a sticky pointer for the resolve frame
  // so the TV shows reveal → grid (host advances by clicking next cell).
  const liveQuestion = snapshot.questions.find(
    (q) => q.id === snapshot.liveQuestionId,
  ) ?? null;
  const targetQuestion = snapshot.questions.find(
    (q) => q.id === snapshot.targetQuestionId,
  ) ?? null;

  const lastResolve = snapshot.reveals.find((r) => r.event === "resolve") ?? null;

  // After a resolve event, the reveal frame should stay visible until the
  // host clicks the next cell. The previous auto-transition to a
  // leaderboard interstitial (LEADERBOARD_HOLD_MS) was confusing for the
  // demo flow — Brandon's customer saw the correct answer flicker and get
  // replaced by the leaderboard before she could read it. The reveal now
  // sticks until the next live question arrives (which the state machine
  // catches via `liveQuestion && !finishedAt`) OR the game ends.
  const stickyReveal = !!lastResolve && !hostAdvanced;

  // Ceremony-queue pending count — TVQuestionView reports this up via a
  // ref callback so the reveal branch can hold the transition for up to
  // 3 s while ceremonies drain (May/Storm only).
  const pendingCeremonyCountRef = useRef(0);
  const onPendingCountChange = useCallback((count: number) => {
    pendingCeremonyCountRef.current = count;
  }, []);

  // Track when the question first resolves (finishedAt becomes non-null)
  // so shouldHoldReveal can enforce the 3-second hard cap.
  const resolvedAtRef = useRef<number | null>(null);
  const lastTargetIdRef = useRef<string | null>(null);
  useEffect(() => {
    const resolvedId = targetQuestion?.id ?? null;
    const resolvedAt = targetQuestion?.finishedAt ?? null;
    // Reset when a new question becomes the target.
    if (resolvedId !== lastTargetIdRef.current) {
      lastTargetIdRef.current = resolvedId;
      resolvedAtRef.current = null;
    }
    // Stamp the moment we first observe finishedAt being set.
    if (resolvedAt !== null && resolvedAtRef.current === null) {
      resolvedAtRef.current = Date.now();
    }
  });

  // ── Lobby branch ──
  if (!currentGame || currentGame.state === "draft" || currentGame.state === "ready") {
    if (intermission) {
      return <TVIntermissionView snapshot={snapshot} game1={game1} />;
    }
    return <TVLobbyView snapshot={snapshot} welcomeEvent={welcomeEvent} />;
  }

  // ── Done game branches ──
  if (currentGame.state === "done") {
    if (isFinale) {
      return <TVFinaleView snapshot={snapshot} />;
    }
    if (intermission) {
      return <TVIntermissionView snapshot={snapshot} game1={game1} />;
    }
    // Fallback to leaderboard for the just-finished game.
    return <TVLeaderboardView snapshot={snapshot} game={currentGame} />;
  }

  // ── Live game branches ──
  if (currentGame.state === "live") {
    // Live question (still open — finishedAt not yet set)?
    if (liveQuestion && !liveQuestion.finishedAt) {
      return (
        <TVQuestionView
          key={liveQuestion.id}
          snapshot={snapshot}
          question={liveQuestion}
          revealedAt={lastBroadcastRevealedAt ?? liveQuestion.playedAt}
          serverNow={lastBroadcastServerNow}
          themeKey={themeKey}
          onPendingCountChange={onPendingCountChange}
        />
      );
    }

    // Just resolved — show the reveal frame and KEEP it visible until the
    // host advances by clicking the next cell (which will arrive as a new
    // `liveQuestion` and trip the branch above). No auto-transition to a
    // leaderboard interstitial — the customer host explicitly wanted the
    // answer to stay readable until they move on.
    //
    // Ceremony-queue pause (May/Storm only): if lock-in ceremonies are still
    // pending when the question resolves, hold reveal for up to 3 s so every
    // player gets their ceremony before the answer flips into view.
    if (stickyReveal && targetQuestion && targetQuestion.finishedAt) {
      const hold = shouldHoldReveal({
        timerExpired: true, // finishedAt being set means the timer has expired
        pendingCount: pendingCeremonyCountRef.current,
        expiredAtMs: resolvedAtRef.current,
        nowMs: Date.now(),
        ceremonyEnabled: hasCeremony(themeKey),
      });
      if (hold) {
        // Keep TVQuestionView alive during the ceremony drain window. We
        // pass finishedAt=null-equivalent by keeping liveQuestion in scope,
        // but since liveQuestion.finishedAt IS set here, we render with the
        // live question data. The question still displays; ceremonies overlay.
        // Use targetQuestion as the question since liveQuestion may be null.
        return (
          <TVQuestionView
            key={`${targetQuestion.id}-hold`}
            snapshot={snapshot}
            question={targetQuestion}
            revealedAt={lastBroadcastRevealedAt ?? targetQuestion.playedAt}
            serverNow={lastBroadcastServerNow}
            themeKey={themeKey}
            onPendingCountChange={onPendingCountChange}
          />
        );
      }
      return <TVRevealView snapshot={snapshot} question={targetQuestion} themeKey={themeKey} />;
    }

    // No live question, no recent resolve → the Jeopardy grid is the
    // canonical picking surface for the entire game. The "Section
    // Complete" cinematic that fires when a category just cleared is
    // layered as an overlay by the parent (HostLiveConsole or
    // /tv/[code]) — see useSectionCompleteCelebration. The state machine
    // stays pure and doesn't manage that overlay.
    return (
      <TVGridView
        snapshot={snapshot}
        game={currentGame}
        onCellClick={onGridCellClick}
      />
    );
  }

  // Default: lobby.
  return <TVLobbyView snapshot={snapshot} welcomeEvent={welcomeEvent} />;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — view per state.
// ─────────────────────────────────────────────────────────────────────────

function TVLobbyView({
  snapshot,
  welcomeEvent = null,
}: {
  snapshot: TVSnapshot;
  welcomeEvent?: TVLobbyWelcomeEvent | null;
}) {
  const formattedCode = formatRoomCode(snapshot.night.roomCode);
  const venue = snapshot.night.venueName.toUpperCase();
  const scheduled = formatScheduledDate(snapshot.night.scheduledAt);
  // Most recent joins first — that's the order Lobby's "tickers" expect.
  const sortedPlayers = [...snapshot.players].sort((a, b) =>
    b.joinedAt.localeCompare(a.joinedAt),
  );
  const roster = sortedPlayers.map((p) => p.displayName);
  const rosterPlayerIds = sortedPlayers.map((p) => p.id);

  const game1 = snapshot.games.find((g) => g.gameNo === 1) ?? null;
  const gameStatus =
    game1?.state === "ready"
      ? "GAME 1 OF 2 · READY"
      : game1?.state === "live"
        ? "GAME 1 OF 2 · LIVE"
        : "GAME 1 OF 2 · WAITING";

  return (
    <TVLobby
      venueName={venue}
      scheduledDate={scheduled}
      roomCode={formattedCode}
      inRoomCount={snapshot.players.length}
      roster={roster}
      rosterPlayerIds={rosterPlayerIds}
      joinUrl={joinUrl(snapshot.night.roomCode)}
      hostStatusLine="ROOM OPEN · STARTS WHEN HOST IS READY"
      gameStatusLine={gameStatus}
      topics={selectLobbyTopics(snapshot)}
      welcomeEvent={welcomeEvent}
    />
  );
}

function TVGridView({
  snapshot,
  game,
  onCellClick,
}: {
  snapshot: TVSnapshot;
  game: { id: string };
  onCellClick?: (questionId: string) => void;
}) {
  const cats = snapshot.categories
    .filter((c) => c.gameId === game.id)
    .sort((a, b) => a.position - b.position);
  const categoryNames = cats.map((c) => c.name);
  const values = uniqueAscendingPointValues(snapshot, cats);

  const cells: TVGridCell[][] = cats.map((cat) => {
    const catQuestions = snapshot.questions
      .filter((q) => q.categoryId === cat.id && q.isPicked)
      .sort((a, b) => (a.pointValue ?? 0) - (b.pointValue ?? 0));
    return values.map((v) => {
      const q = catQuestions.find((cq) => cq.pointValue === v);
      return {
        played: q ? q.finishedAt !== null : false,
        // No persistent "selected" notion — we light up the live one when
        // there is one. Otherwise nothing is selected.
        selected: q ? q.id === snapshot.liveQuestionId : false,
        value: v,
        questionId: q?.id ?? null,
      };
    });
  });

  const leaders = topScores(snapshot);
  const boardLeft = cells.flat().filter((c) => !c.played).length;

  const upNext = (() => {
    const live = snapshot.questions.find(
      (q) => q.id === snapshot.liveQuestionId,
    );
    if (!live) return null;
    const cat = cats.find((c) => c.id === live.categoryId);
    if (!cat) return null;
    return {
      category: cat.name,
      value: live.pointValue ?? 0,
      sub: "standing by to reveal",
    };
  })();

  const total = snapshot.players.length;
  const totalAnswered = snapshot.scores.reduce((sum, s) => sum + s.answered_count, 0);
  const totalPossible = snapshot.scores.length * cells.flat().filter((c) => c.played).length;

  return (
    <TVGrid
      gameStatusLine={`GAME ${game.id === snapshot.games.find((g) => g.gameNo === 2)?.id ? "2" : "1"} · ${total} PLAYERS`}
      rightHeaderLine={`${totalAnswered} OF ${Math.max(totalAnswered, totalPossible)} ANSWERED`}
      categories={categoryNames.length > 0 ? categoryNames : undefined}
      cells={cells.length > 0 ? cells : undefined}
      values={values.length > 0 ? values : undefined}
      leaders={leaders}
      boardLeft={boardLeft}
      upNext={upNext}
      footerLeft={pickLiveQuestion(snapshot) ? "REVEAL TO BEGIN" : "WAITING ON HOST"}
      footerRight={`TR1VIA.COM · ${formatRoomCode(snapshot.night.roomCode)}`}
      onCellClick={onCellClick}
    />
  );
}

function TVQuestionView({
  snapshot,
  question,
  revealedAt,
  serverNow,
  themeKey,
  onPendingCountChange,
}: {
  snapshot: TVSnapshot;
  question: TVSnapshot["questions"][number];
  revealedAt: string | null;
  serverNow: string | null;
  themeKey?: ThemeKey;
  /** Fires whenever the ceremony queue length changes — lets the parent
   *  state machine gate the reveal transition during the drain window. */
  onPendingCountChange?: (count: number) => void;
}) {
  const cat = snapshot.categories.find((c) => c.id === question.categoryId);
  const category = cat?.name ?? "Trivia";

  // Live countdown — uses broadcast timestamps when available, falls back to
  // the durable played_at column otherwise.
  const revealedMs = revealedAt
    ? new Date(revealedAt).getTime()
    : question.playedAt
      ? new Date(question.playedAt).getTime()
      : null;
  const serverNowMs = serverNow ? new Date(serverNow).getTime() : null;
  // TV/host-laptop is the documented fallback for resolving a live question
  // when the player's phone dies (force-closed Safari, lost network, iOS
  // backgrounding the tab, etc.). The /api/questions/[id]/resolve endpoint
  // is idempotent — its RPC does a "select … for update" so a second caller
  // is a no-op. Without this onZero, a force-closed phone means the timer
  // hits 0 and the game stalls — host has to manually click "End early".
  const { displaySeconds } = useTimer({
    revealedAtMs: revealedMs,
    serverNowMs,
    themeKey,
    onZero: () => {
      void fetch(`/api/questions/${question.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {
        // Network/transient failure: phones or host's manual End-early
        // button remain as fallbacks. Logging would be noise.
      });
    },
  });

  const tiles: TVQuestionTile[] = useMemo(() => {
    // The TV shows tiles in the order they arrive — newest at the end so
    // LockInPileUp's "fresh landers" animation hits the last three each
    // time a new answer lands.
    return [...snapshot.liveAnswers]
      .sort((a, b) => a.ms_to_lock - b.ms_to_lock)
      .map((a) => ({
        id: a.id,
        name: a.player_name,
        t: `${(a.ms_to_lock / 1000).toFixed(1)}s`,
      }));
  }, [snapshot.liveAnswers]);

  // Build marquee chips from the full player roster — scores come from
  // snapshot.scores (keyed by player_id, updated at reveal, static mid-question).
  const marqueeChips: MarqueeChip[] = useMemo(() => {
    if (!hasMarquee(themeKey)) return [];
    return snapshot.players.map((p, i) => {
      const scoreRow = snapshot.scores.find((s) => s.player_id === p.id);
      return {
        playerId: p.id,
        name: p.displayName.toUpperCase(),
        color: playerColorHex(p.id),
        score: scoreRow?.score ?? 0,
        joinIndex: i,
      };
    });
  }, [snapshot.players, snapshot.scores, themeKey]);

  // Track which players have locked in (any answer in liveAnswers) so we can
  // diff against previously-seen locks and enqueue ceremony events.
  const lockedAnswers = snapshot.liveAnswers;

  const [ceremonyQueue, setCeremonyQueue] = useState<CeremonyEvent[]>([]);
  const [spotlightedPlayerId, setSpotlightedPlayerId] = useState<string | null>(null);
  const [speedBonusPlayerId, setSpeedBonusPlayerId] = useState<string | null>(null);
  // seenLocksRef tracks player ids we've already queued so snapshot re-fetches
  // (which repeat the full liveAnswers list) don't double-fire ceremonies.
  const seenLocksRef = useRef<Set<string>>(new Set());
  // June de-dups its lock-in sky pulse separately from the May ceremony queue.
  const juneSeenLocksRef = useRef<Set<string>>(new Set());

  // Enqueue a ceremony event for each newly-seen lock-in.
  useEffect(() => {
    // June warms the sky on every new lock-in, independent of the May-only
    // ceremony queue, de-duped via its own ref so snapshot re-fetches don't
    // re-pulse for the same player.
    if (themeKey === "june") {
      const newlyLockedJune = lockedAnswers.filter((a) => !juneSeenLocksRef.current.has(a.player_id));
      if (newlyLockedJune.length > 0) {
        for (const a of newlyLockedJune) juneSeenLocksRef.current.add(a.player_id);
        fireJuneBeat("lock");
      }
    }
    if (!hasCeremony(themeKey)) return;
    const newlyLocked = lockedAnswers.filter((a) => !seenLocksRef.current.has(a.player_id));
    for (const a of newlyLocked) seenLocksRef.current.add(a.player_id);
    if (newlyLocked.length > 0) {
      setCeremonyQueue((q) => [
        ...q,
        ...newlyLocked.map((a) => ({
          playerId: a.player_id,
          tint: playerColorHex(a.player_id),
          msToLock: a.ms_to_lock,
          receivedAtMs: Date.now(),
        })),
      ]);
    }
  }, [lockedAnswers, themeKey]);

  // Polling fallback — catches any lock-ins the realtime channel dropped.
  // Fires onMissed for locks the snapshot hasn't delivered yet; the callback
  // here mirrors what the useEffect above does for realtime arrivals.
  useLockInSync({
    gameId: snapshot.currentGameId ?? "",
    active: hasCeremony(themeKey) && !!snapshot.currentGameId,
    acknowledged: seenLocksRef.current,
    onMissed: (lock) => {
      setCeremonyQueue((q) => [
        ...q,
        {
          playerId: lock.playerId,
          tint: playerColorHex(lock.playerId),
          msToLock: lock.msToLock,
          receivedAtMs: Date.now(),
        },
      ]);
      seenLocksRef.current.add(lock.playerId);
    },
  });

  const handleSpotlight = useCallback((playerId: string | null) => {
    setSpotlightedPlayerId(playerId);
    if (playerId === null) {
      setSpeedBonusPlayerId(null);
      return;
    }
    // Grant speed bonus only when the lock came in under 5 seconds.
    const ev = ceremonyQueue.find((e) => e.playerId === playerId);
    setSpeedBonusPlayerId(ev && ev.msToLock < 5000 ? playerId : null);
  }, [ceremonyQueue]);

  const handleEventComplete = useCallback((playerId: string) => {
    setCeremonyQueue((q) => q.filter((e) => e.playerId !== playerId));
  }, []);

  // Report pending ceremony count to the parent state machine so it can
  // gate the reveal transition during the drain window.
  useEffect(() => {
    onPendingCountChange?.(ceremonyQueue.length);
  }, [ceremonyQueue.length, onPendingCountChange]);

  // Decorate chips with speedBonus so the +SPD badge fires when spotlighted.
  const decoratedChips: MarqueeChip[] = useMemo(
    () => marqueeChips.map((c) => ({ ...c, speedBonus: c.playerId === speedBonusPlayerId })),
    [marqueeChips, speedBonusPlayerId],
  );

  // Options layout: TVQuestion shows numbered 1..4 in *canonical* order on
  // the TV (the scramble is per-phone). So we render the question's options
  // straight from the row.
  const options = question.options.map((text, i) => ({ n: i + 1, text }));

  return (
    <>
      {hasCeremony(themeKey) && (
        <TVLockInCeremony
          events={ceremonyQueue}
          onEventComplete={handleEventComplete}
          onSpotlight={handleSpotlight}
        />
      )}
      <TVQuestion
        category={category}
        value={question.pointValue ?? 100}
        question={question.prompt}
        options={options}
        seconds={Math.max(0, displaySeconds)}
        tiles={tiles}
        totalPlayers={snapshot.players.length}
        imageUrl={question.imageUrl}
        themeKey={themeKey}
        marqueeChips={decoratedChips}
        spotlightedPlayerId={spotlightedPlayerId}
        lockInAnnouncement={
          spotlightedPlayerId
            ? `${snapshot.players.find((p) => p.id === spotlightedPlayerId)?.displayName ?? ""} locked in`
            : undefined
        }
      />
    </>
  );
}

function TVRevealView({
  snapshot,
  question,
  themeKey,
}: {
  snapshot: TVSnapshot;
  question: TVSnapshot["questions"][number];
  themeKey?: ThemeKey;
}) {
  useEffect(() => {
    if (themeKey === "june") fireJuneBeat("reveal");
  }, [themeKey]);

  const cat = snapshot.categories.find((c) => c.id === question.categoryId);
  const category = cat?.name ?? "Trivia";
  const game = snapshot.games.find((g) =>
    snapshot.categories.find((c) => c.gameId === g.id && c.id === question.categoryId),
  );

  const answers = snapshot.liveAnswers;
  const correctAnswers = answers.filter((a) => a.is_correct);
  const stumper = correctAnswers.length <= STUMPER_THRESHOLD;

  const headerEyebrow = `GAME ${game?.gameNo ?? 1} · ${category.toUpperCase()} · ${question.pointValue ?? 100} PTS`;
  // The reveal only renders for a RESOLVED question, so correctIndex is set by
  // now (the public feed withholds it until finished — see serializeBoardQuestion).
  // Guard defensively in case a not-yet-finished row ever reaches here.
  const correctText =
    question.correctIndex !== null ? question.options[question.correctIndex] : "";
  // Canonical 1-based number on the TV (scramble is per-phone; on the TV we
  // show the canonical position so the reveal lines up with TVQuestion's
  // option cards).
  const correctNumber =
    question.correctIndex !== null ? question.correctIndex + 1 : 0;

  if (stumper) {
    const nailed: TVStumperFastest[] = correctAnswers
      .sort((a, b) => a.ms_to_lock - b.ms_to_lock)
      .map((a) => ({
        name: a.player_name,
        time: `${(a.ms_to_lock / 1000).toFixed(1)}s`,
      }));
    return (
      <TVRevealStumper
        headerEyebrow={headerEyebrow}
        category={category}
        question={question.prompt}
        correctNumber={correctNumber}
        correctText={correctText}
        fact={question.factBlurb ?? undefined}
        gotIt={correctAnswers.length}
        ofTotal={snapshot.players.length}
        whoNailedIt={nailed}
      />
    );
  }

  const fastest: TVRevealFastest[] = correctAnswers
    .sort((a, b) => a.ms_to_lock - b.ms_to_lock)
    .slice(0, 5)
    .map((a) => ({
      name: a.player_name,
      time: `${(a.ms_to_lock / 1000).toFixed(1)}s`,
    }));

  const fastestMs = correctAnswers[0]?.ms_to_lock ?? null;
  const fastestStr = fastestMs !== null ? `${(fastestMs / 1000).toFixed(1)}s` : "—";

  return (
    <TVReveal
      headerEyebrow={headerEyebrow}
      question={question.prompt}
      correctNumber={correctNumber}
      correctText={correctText}
      fact={question.factBlurb ?? undefined}
      gotIt={correctAnswers.length}
      ofTotal={snapshot.players.length}
      fastest={fastestStr}
      speedBonus={(() => {
        // The actual speed bonus that the leader earned — computed by the
        // server when the question resolved. We approximate visually from
        // the question's point_value: per the rules, the bonus is +10% of
        // the point value for sub-5s correct answers.
        if (fastestMs === null || fastestMs > 5000) return "—";
        const bonus = Math.round((question.pointValue ?? 100) * 0.1);
        return `+${bonus}`;
      })()}
      fastestFive={fastest}
    />
  );
}

function TVLeaderboardView({
  snapshot,
  game,
}: {
  snapshot: TVSnapshot;
  game: { id: string; gameNo?: 1 | 2 };
}) {
  const gameNo = snapshot.games.find((g) => g.id === game.id)?.gameNo ?? 1;
  const rows: TVLeaderboardRow[] = snapshot.scores
    .slice(0, 10)
    .map((s, idx) => ({
      rank: idx + 1,
      name: s.display_name,
      score: s.score,
    }));

  const answered = snapshot.scores.reduce((sum, s) => sum + s.answered_count, 0);

  return (
    <TVLeaderboard
      headerLeft={`GAME ${gameNo} · STANDINGS`}
      headerRight={`${snapshot.players.length} PLAYERS · ${answered} ANSWERED`}
      footerLeft="HOST WILL ADVANCE WHEN READY"
      footerRight={`TR1VIA.COM · ${formatRoomCode(snapshot.night.roomCode)}`}
      rows={rows}
    />
  );
}

function TVIntermissionView({
  snapshot,
  game1,
}: {
  snapshot: TVSnapshot;
  game1: { id: string } | null;
}) {
  const game2 = snapshot.games.find((g) => g.gameNo === 2) ?? null;
  // Top 3 from game 1 — fetched from the snapshot's game_scores.
  const game1Scores = game1
    ? snapshot.scores
    : [];
  const podium: TVIntermissionPodiumRow[] = game1Scores
    .slice(0, 3)
    .map((s, idx) => ({
      rank: idx + 1,
      name: s.display_name,
      score: s.score,
    }));

  // Best stats across game 1 for the "in numbers" block.
  const fastestMs = Math.min(
    ...game1Scores.map((s) => s.fastest_correct_ms ?? Infinity),
  );
  const stats: TVIntermissionStat[] = [
    {
      l: "FASTEST",
      v: Number.isFinite(fastestMs)
        ? `${(fastestMs / 1000).toFixed(1)}s`
        : "—",
    },
    {
      l: "PLAYERS",
      v: String(snapshot.players.length),
    },
    {
      l: "AVG SCORE",
      v: game1Scores.length > 0
        ? String(Math.round(game1Scores.reduce((s, r) => s + r.score, 0) / game1Scores.length))
        : "—",
    },
  ];

  // game_participations isn't exposed in the snapshot — readyCount is best
  // approximated by "players who are still in" (i.e. haven't been removed
  // and have a recent last_seen). We use the total roster count here.
  const readyCount = snapshot.players.length;

  return (
    <TVIntermission
      headerLeft="GAME 1 · COMPLETE"
      headerRight={
        game2?.state === "ready"
          ? "GAME 2 · READY"
          : "GAME 2 LAUNCHES WHEN HOST SAYS GO"
      }
      footerLeft={`TR1VIA.COM · ${formatRoomCode(snapshot.night.roomCode)} · ROOM STILL OPEN`}
      footerRight="HOST STARTS GAME 2 WHEN ENOUGH ARE IN"
      podium={podium}
      readyCount={readyCount}
      totalCount={snapshot.players.length}
      roomCode={formatRoomCode(snapshot.night.roomCode)}
      joinUrl={joinUrl(snapshot.night.roomCode)}
      nightStats={stats}
    />
  );
}

function TVFinaleView({ snapshot }: { snapshot: TVSnapshot }) {
  const sorted = snapshot.scores;
  const top = sorted[0] ?? null;
  const podium = sorted.slice(1, 3).map((s, idx) => ({
    rank: idx + 2,
    name: s.display_name,
    score: s.score,
  }));

  const winner = top
    ? {
        name: top.display_name,
        score: top.score,
        correct: top.correct_count,
        of: top.answered_count,
        streak: undefined,
        fastest: top.fastest_correct_ms
          ? `${(top.fastest_correct_ms / 1000).toFixed(1)}s`
          : undefined,
      }
    : undefined;

  const fastestEver = sorted
    .filter((s) => s.fastest_correct_ms !== null)
    .sort((a, b) => (a.fastest_correct_ms ?? 0) - (b.fastest_correct_ms ?? 0))[0];
  const stats = [
    { l: "PLAYERS", v: String(snapshot.players.length) },
    {
      l: "QUESTIONS",
      v: String(snapshot.questions.filter((q) => q.finishedAt !== null).length),
    },
    {
      l: "FASTEST EVER",
      v: fastestEver?.fastest_correct_ms
        ? `${(fastestEver.fastest_correct_ms / 1000).toFixed(1)}s · ${fastestEver.display_name}`
        : "—",
    },
  ];

  const scheduled = formatScheduledDate(snapshot.night.scheduledAt);
  return (
    <TVFinaleWinner
      headerEyebrow={`${snapshot.night.venueName.toUpperCase()} · ${scheduled}`}
      winner={winner}
      podium={podium}
      nightStats={stats}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────

function pickLiveQuestion(snapshot: TVSnapshot) {
  return snapshot.questions.find((q) => q.id === snapshot.liveQuestionId) ?? null;
}

function topScores(snapshot: TVSnapshot): TVGridLeaderRow[] {
  // snapshot.scores is pre-sorted score-descending by both snapshot builders
  // (roomToTVSnapshot + the /tv/[code] snapshot route), so the first four rows
  // are the true top four.
  return snapshot.scores.slice(0, 4).map((s, idx) => ({
    rank: idx + 1,
    name: s.display_name,
    score: s.score,
  }));
}

function uniqueAscendingPointValues(
  snapshot: TVSnapshot,
  cats: TVSnapshot["categories"],
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const catIds = new Set(cats.map((c) => c.id));
  const sorted = snapshot.questions
    .filter((q) => q.isPicked && catIds.has(q.categoryId) && q.pointValue !== null)
    .sort((a, b) => (a.pointValue ?? 0) - (b.pointValue ?? 0));
  for (const q of sorted) {
    const v = q.pointValue;
    if (v !== null && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.length > 0 ? out : [];
}

function joinUrl(roomCode: string): string {
  // Use whatever origin the host laptop is actually serving from so the
  // QR works correctly on prod, preview deploys, and local tunnels —
  // without needing a per-deployment env var. QRBlock renders client-side
  // (canvas), so window.location.origin is what actually ends up in the
  // scannable code. The SSR fallback only matters for the initial HTML
  // before hydration, where we prefer the explicit env var, then the
  // production canonical, then localhost as a last-ditch dev default.
  if (typeof window !== "undefined") {
    return `${window.location.origin}/join?code=${roomCode}`;
  }
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://tr1via.com");
  return `${site}/join?code=${roomCode}`;
}

function formatScheduledDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()] ?? "";
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getMonth()] ?? "";
  return `${weekday} ${month} ${d.getDate()}`;
}
