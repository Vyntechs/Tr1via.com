// app/tv/[code]/page.tsx — the venue TV.
//
// One Client Component, no auth, no scrolling. It uses `useTVRoom` to pull
// a server-rendered snapshot of the night (the TV is anonymous so it can't
// read tables directly), then maps the snapshot to whichever TV screen the
// moment calls for:
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
// The 16:9 stage is fixed at 1280x720 and `aspect-ratio: 16/9` lets CSS
// scale it to fill the viewport (the venue TV runs in fullscreen on the
// host's laptop, so 100vw/100vh is the target).

"use client";

import { use, useEffect, useMemo } from "react";
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
  type TVIntermissionPodiumRow,
  type TVIntermissionStat,
  type TVLeaderboardRow,
  type TVQuestionTile,
  type TVRevealFastest,
  type TVStumperFastest,
} from "@/components/tv";
import { ThemeProvider } from "@/components/system";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";
import { formatRoomCode } from "@/lib/game/room-code";
import { useTVRoom, type TVSnapshot } from "@/lib/hooks/useTVRoom";
import { useTimer } from "@/lib/hooks/useTimer";

const STUMPER_THRESHOLD = 4; // ≤ this many got it = use the stumper variant

export default function TVPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const { status, snapshot, lastBroadcast } = useTVRoom(code);

  if (status === "loading") {
    return <TVMessageStage title="Loading..." subtitle="" />;
  }
  if (status === "not-found") {
    return (
      <TVMessageStage
        title="Room not found"
        subtitle={`Check tr1via.com/host — code ${formatRoomCode(code)} isn't open.`}
      />
    );
  }
  if (status === "error" || !snapshot) {
    return (
      <TVMessageStage
        title="Something's off."
        subtitle="Retrying… the venue TV will recover automatically when the connection comes back."
      />
    );
  }

  const themeKey: ThemeKey = isThemeKey(snapshot.night.themeKey)
    ? snapshot.night.themeKey
    : "house";

  return (
    <ThemeProvider themeKey={themeKey}>
      <TVStageFrame>
        <TVStateMachine snapshot={snapshot} lastBroadcastRevealedAt={
          lastBroadcast?.event === "reveal" ? lastBroadcast.revealedAt ?? null : null
        } lastBroadcastServerNow={
          lastBroadcast?.event === "reveal" ? lastBroadcast.serverNow ?? null : null
        } />
      </TVStageFrame>
    </ThemeProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stage frame: 16:9 contained inside the viewport, scaled to fit.
// ─────────────────────────────────────────────────────────────────────────

function TVStageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          // CSS clamp: take the largest 16:9 box that fits the viewport.
          // Computed from 100vw and 100vh: the limiting dimension wins.
          width: "min(100vw, calc(100vh * 16 / 9))",
          height: "min(100vh, calc(100vw * 9 / 16))",
          aspectRatio: "16 / 9",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// State machine: decides which TV screen to render from the snapshot.
// ─────────────────────────────────────────────────────────────────────────

function TVStateMachine({
  snapshot,
  lastBroadcastRevealedAt,
  lastBroadcastServerNow,
}: {
  snapshot: TVSnapshot;
  lastBroadcastRevealedAt: string | null;
  lastBroadcastServerNow: string | null;
}) {
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
  // with played_at set; we keep a sticky pointer for ~LEADERBOARD_HOLD_MS
  // after resolve so the TV shows reveal → leaderboard → grid.
  const liveQuestion = snapshot.questions.find(
    (q) => q.id === snapshot.liveQuestionId,
  ) ?? null;
  const targetQuestion = snapshot.questions.find(
    (q) => q.id === snapshot.targetQuestionId,
  ) ?? null;

  // The most recent reveals row tells us what we're in: reveal (mid-question),
  // resolve (just finished), undo (rewound — show question again), end-early
  // (closed → show resolve once it lands).
  const lastReveal = snapshot.reveals[0] ?? null;
  const lastResolve = snapshot.reveals.find((r) => r.event === "resolve") ?? null;

  // After a resolve event, the reveal frame should stay visible until the
  // host clicks the next cell. The previous auto-transition to a
  // leaderboard interstitial (LEADERBOARD_HOLD_MS) was confusing for the
  // demo flow — Brandon's customer saw the correct answer flicker and get
  // replaced by the leaderboard before she could read it. The reveal now
  // sticks until the next live question arrives (which the state machine
  // catches via `liveQuestion && !finishedAt`) OR the game ends.
  const stickyReveal = !!lastResolve;

  // ── Lobby branch ──
  if (!currentGame || currentGame.state === "draft" || currentGame.state === "ready") {
    if (intermission) {
      return <TVIntermissionView snapshot={snapshot} game1={game1} />;
    }
    return <TVLobbyView snapshot={snapshot} />;
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
    // Live question?
    if (liveQuestion && !liveQuestion.finishedAt) {
      return (
        <TVQuestionView
          snapshot={snapshot}
          question={liveQuestion}
          revealedAt={lastBroadcastRevealedAt ?? liveQuestion.playedAt}
          serverNow={lastBroadcastServerNow}
        />
      );
    }

    // Just resolved — show the reveal frame and KEEP it visible until the
    // host advances by clicking the next cell (which will arrive as a new
    // `liveQuestion` and trip the branch above). No auto-transition to a
    // leaderboard interstitial — the customer host explicitly wanted the
    // answer to stay readable until they move on.
    if (stickyReveal && targetQuestion && targetQuestion.finishedAt) {
      return <TVRevealView snapshot={snapshot} question={targetQuestion} />;
    }

    // No live question, no recent resolve → TVGrid.
    return <TVGridView snapshot={snapshot} game={currentGame} />;
  }

  // Default: lobby.
  return <TVLobbyView snapshot={snapshot} />;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers — view per state.
// ─────────────────────────────────────────────────────────────────────────

function TVLobbyView({ snapshot }: { snapshot: TVSnapshot }) {
  const formattedCode = formatRoomCode(snapshot.night.roomCode);
  const venue = snapshot.night.venueName.toUpperCase();
  const scheduled = formatScheduledDate(snapshot.night.scheduledAt);
  // Most recent joins first — that's the order Lobby's "tickers" expect.
  const roster = [...snapshot.players]
    .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .map((p) => p.displayName);

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
      joinUrl={joinUrl(snapshot.night.roomCode)}
      hostStatusLine="ROOM OPEN · STARTS WHEN HOST IS READY"
      gameStatusLine={gameStatus}
    />
  );
}

function TVGridView({
  snapshot,
  game,
}: {
  snapshot: TVSnapshot;
  game: { id: string };
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
      };
    });
  });

  const leader = topScore(snapshot);
  const boardLeft = cells.flat().filter((c) => !c.played).length;

  const upNext = (() => {
    const liveQuestion = snapshot.questions.find(
      (q) => q.id === snapshot.liveQuestionId,
    );
    if (!liveQuestion) return null;
    const cat = cats.find((c) => c.id === liveQuestion.categoryId);
    if (!cat) return null;
    return {
      category: cat.name,
      value: liveQuestion.pointValue ?? 0,
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
      leader={leader ?? undefined}
      boardLeft={boardLeft}
      upNext={upNext}
      footerLeft={liveQuestion(snapshot) ? "REVEAL TO BEGIN" : "WAITING ON HOST"}
      footerRight={`TR1VIA.COM · ${formatRoomCode(snapshot.night.roomCode)}`}
    />
  );
}

function TVQuestionView({
  snapshot,
  question,
  revealedAt,
  serverNow,
}: {
  snapshot: TVSnapshot;
  question: TVSnapshot["questions"][number];
  revealedAt: string | null;
  serverNow: string | null;
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
  const { displaySeconds } = useTimer({
    revealedAtMs: revealedMs,
    serverNowMs,
    durationS: 20,
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

  // Options layout: TVQuestion shows numbered 1..4 in *canonical* order on
  // the TV (the scramble is per-phone). So we render the question's options
  // straight from the row.
  const options = question.options.map((text, i) => ({ n: i + 1, text }));

  return (
    <TVQuestion
      category={category}
      value={question.pointValue ?? 100}
      question={question.prompt}
      options={options}
      seconds={Math.max(0, displaySeconds)}
      tiles={tiles}
      totalPlayers={snapshot.players.length}
      imageUrl={question.imageUrl}
    />
  );
}

function TVRevealView({
  snapshot,
  question,
}: {
  snapshot: TVSnapshot;
  question: TVSnapshot["questions"][number];
}) {
  const cat = snapshot.categories.find((c) => c.id === question.categoryId);
  const category = cat?.name ?? "Trivia";
  const game = snapshot.games.find((g) =>
    snapshot.categories.find((c) => c.gameId === g.id && c.id === question.categoryId),
  );

  const answers = snapshot.liveAnswers;
  const correctAnswers = answers.filter((a) => a.is_correct);
  const stumper = correctAnswers.length <= STUMPER_THRESHOLD;

  const headerEyebrow = `GAME ${game?.gameNo ?? 1} · ${category.toUpperCase()} · ${question.pointValue ?? 100} PTS`;
  const correctText = question.options[question.correctIndex];
  // Canonical 1-based number on the TV (scramble is per-phone; on the TV we
  // show the canonical position so the reveal lines up with TVQuestion's
  // option cards).
  const correctNumber = question.correctIndex + 1;

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
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────

function TVMessageStage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0E0805",
        color: "#F4E6C4",
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 56px",
      }}
    >
      <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.025em" }}>{title}</div>
      {subtitle && (
        <div style={{ marginTop: 18, fontSize: 22, color: "rgba(244,230,196,.62)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

function liveQuestion(snapshot: TVSnapshot) {
  return snapshot.questions.find((q) => q.id === snapshot.liveQuestionId) ?? null;
}

function topScore(snapshot: TVSnapshot): { name: string; score: number } | null {
  const top = snapshot.scores[0];
  return top ? { name: top.display_name, score: top.score } : null;
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
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tr1via.com";
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
