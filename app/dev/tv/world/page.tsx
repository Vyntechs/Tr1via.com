// Internal preview: the real venue-TV renderer (TVStateMachine inside the
// same 1600×900 scaled stage the TV route uses), fed a believable demo
// night instead of a database. Walk every moment of the night per theme.
//
//   /dev/tv/world?moment=question&s=14&locked=17&players=29&theme=october
//   /dev/tv/world?play=1            ← plays one question start to finish
//
// moment: lobby | board | question | reveal | between-games | winner
// s:      seconds left on the clock (question only; the clock keeps running)
// locked: how many players have locked in (question / reveal)
// tier:   still → the host phone preview's no-animation version
// long:   1 → worst-case content (long question + photo + long answers + fact)
// play:   9 s left → lock-ins arrive → last five seconds → time's up →
//         the reveal lands 0.6 s after zero (like the real game) → board.
// host:   1 → inside the host's laptop console (TV panel + control strip,
//         not a fixed 16:9 stage), to check the world fits any window.
// tour:   1 → plays whole nights on a loop, in ONE page (the world never
//         remounts, like a real show): players join, the board, questions
//         that run out, early reveals, rapid screen flips, between games and
//         the winner, with 0-150 players and long content in turn. For long
//         stress runs (tests/e2e/october-soak.spec.ts).

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ScaledTVCanvas, TVStateMachine } from "@/components/tv";
import { HostLiveConsole } from "@/components/host/HostLiveConsole";
import { ThemeProvider } from "@/components/system";
import { demoNight, type DemoMoment } from "@/lib/experience/demoNight";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";

const MOMENTS: DemoMoment[] = ["lobby", "board", "question", "reveal", "between-games", "winner"];
const PLAY_START_SECONDS = 9;

export default function TVWorldPreviewPage() {
  return (
    <Suspense fallback={null}>
      <TVWorldPreview />
    </Suspense>
  );
}

function TVWorldPreview() {
  const params = useSearchParams();
  const momentParam = params.get("moment");
  const themeParam = params.get("theme");
  const themeKey: ThemeKey = isThemeKey(themeParam) ? themeParam : "october";
  const lockedParam = params.get("locked");
  const play = params.get("play") === "1";
  const tier = params.get("tier") === "still" ? "still" : "full";
  const tour = params.get("tour") === "1";
  let players = Number(params.get("players") ?? 29);

  // Build once per page load so the clock runs from the moment it opened.
  const [startMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(startMs);
  useEffect(() => {
    if (!play && !tour) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [play, tour]);

  const revealedAtMs = startMs - (25 - PLAY_START_SECONDS) * 1000;
  const elapsed = (nowMs - startMs) / 1000;
  const playLocked = Math.min(Math.round(players * 0.72), 2 + Math.floor(elapsed / 0.45));
  const zeroAt = PLAY_START_SECONDS;

  let moment: DemoMoment;
  let secondsLeft = Number(params.get("s") ?? 14);
  let locked = lockedParam === null ? undefined : Number(lockedParam);
  let long = params.get("long") === "1";
  let questionRevealedAtMs: number | undefined = play ? revealedAtMs : undefined;
  let questionNo = 0;
  let builtAtMs = play ? startMs : nowMs;
  // When the TV last heard from the server (the timer's clock-skew anchor).
  let serverNowMs = startMs;
  if (tour) {
    const frame = tourFrame(nowMs - startMs, startMs);
    moment = frame.moment;
    players = frame.players;
    locked = frame.locked;
    long = frame.long;
    questionRevealedAtMs = frame.revealedAtMs;
    questionNo = frame.questionNo;
    builtAtMs = nowMs;
    serverNowMs = frame.serverNowMs;
  } else if (play) {
    moment = elapsed < zeroAt + 0.6 ? "question" : elapsed < zeroAt + 8 ? "reveal" : "board";
    secondsLeft = PLAY_START_SECONDS;
    locked = playLocked;
  } else {
    moment = MOMENTS.includes(momentParam as DemoMoment) ? (momentParam as DemoMoment) : "question";
  }

  const night = useDemoNight(moment, players, secondsLeft, locked, builtAtMs, questionRevealedAtMs, long, questionNo);
  const snapshot = useMemo(
    () => ({ ...night.snapshot, night: { ...night.snapshot.night, themeKey } }),
    [night, themeKey],
  );

  if (params.get("host") === "1") {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
        <ThemeProvider themeKey={themeKey}>
          <HostLiveConsole
            themeKey={themeKey}
            roomCode={snapshot.night.roomCode}
            tvSnapshot={snapshot}
            tvLastBroadcastRevealedAt={night.revealedAt}
            tvLastBroadcastServerNow={new Date(serverNowMs).toISOString()}
            playersTotal={snapshot.players.length}
          />
        </ThemeProvider>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000" }}>
      <ThemeProvider themeKey={themeKey}>
        <ScaledTVCanvas ariaLabel="Venue TV preview" style={{ width: "100vw", height: "100vh" }}>
          <TVStateMachine
            snapshot={snapshot}
            lastBroadcastRevealedAt={night.revealedAt}
            lastBroadcastServerNow={new Date(serverNowMs).toISOString()}
            themeKey={themeKey}
            worldTier={tier}
          />
        </ScaledTVCanvas>
      </ThemeProvider>
    </div>
  );
}

// ── tour=1: whole nights on a loop ─────────────────────────────────────────

interface TourFrame {
  moment: DemoMoment;
  players: number;
  locked: number;
  long: boolean;
  revealedAtMs: number | undefined;
  questionNo: number;
  /** When this step's broadcast reached the TV (skew anchor). */
  serverNowMs: number;
}

const TOUR_PLAYERS = [29, 0, 1, 2, 65, 150, 41];
const Q_LEAD_S = 12; // each question joins its clock with 12 s left

type TourStep =
  | { kind: "lobby"; ms: number }
  | { kind: "board"; ms: number }
  | { kind: "question"; ms: number; q: number; early?: boolean }
  | { kind: "flips"; ms: number; q: number }
  | { kind: "between-games"; ms: number }
  | { kind: "winner"; ms: number };

// One night, about 100 s: questions run out (the Horseman rides, pumpkins
// topple at the reveal), one ends early (everyone locked in), and a burst of
// out-of-order screen flips every 150 ms.
const TOUR_NIGHT: TourStep[] = [
  { kind: "lobby", ms: 9000 },
  { kind: "board", ms: 3000 },
  { kind: "question", ms: (Q_LEAD_S + 6.6) * 1000, q: 1 },
  { kind: "board", ms: 2000 },
  { kind: "question", ms: 11_000, q: 2, early: true },
  { kind: "flips", ms: 3000, q: 3 },
  { kind: "board", ms: 2000 },
  { kind: "question", ms: (Q_LEAD_S + 6.6) * 1000, q: 4 },
  { kind: "between-games", ms: 7000 },
  { kind: "board", ms: 2000 },
  { kind: "question", ms: (Q_LEAD_S + 6.6) * 1000, q: 5 },
  { kind: "winner", ms: 9000 },
];
const TOUR_NIGHT_MS = TOUR_NIGHT.reduce((sum, step) => sum + step.ms, 0);
const FLIP_ORDER: DemoMoment[] = ["question", "reveal", "board", "question", "lobby", "reveal", "winner", "question", "between-games", "reveal"];

function tourFrame(elapsedMs: number, startMs: number): TourFrame {
  const nightNo = Math.floor(elapsedMs / TOUR_NIGHT_MS);
  const players = TOUR_PLAYERS[nightNo % TOUR_PLAYERS.length];
  const long = nightNo % 2 === 1;
  let at = elapsedMs - nightNo * TOUR_NIGHT_MS;
  const nightStartMs = startMs + nightNo * TOUR_NIGHT_MS;
  let stepStartMs = nightStartMs;
  for (const step of TOUR_NIGHT) {
    if (at >= step.ms) {
      at -= step.ms;
      stepStartMs += step.ms;
      continue;
    }
    const base = { players, long, locked: 0, revealedAtMs: undefined, questionNo: 0, serverNowMs: stepStartMs };
    switch (step.kind) {
      case "lobby":
        // Players arrive over the first two thirds of the lobby.
        return { ...base, moment: "lobby", players: Math.min(players, Math.round((players * at) / (step.ms * 0.66))) };
      case "board":
      case "between-games":
      case "winner":
        return { ...base, moment: step.kind };
      case "question":
      case "flips": {
        const questionNo = nightNo * 10 + step.q;
        // The clock started 13 s before this step (Q_LEAD_S left when it
        // arrives), so it hits zero Q_LEAD_S s in, or the room locks in early
        // with 8 s left.
        const revealedAtMs = stepStartMs - (25 - Q_LEAD_S) * 1000;
        if (step.kind === "flips") {
          const moment = FLIP_ORDER[Math.floor(at / 150) % FLIP_ORDER.length];
          return { ...base, moment, revealedAtMs, questionNo, locked: Math.round(players / 2) };
        }
        const secondsIn = at / 1000;
        const zeroAt = step.early ? Q_LEAD_S - 8 : Q_LEAD_S;
        const lockedNow = step.early
          ? Math.min(players, Math.round((players * secondsIn) / zeroAt))
          : Math.min(Math.round(players * 0.72), Math.floor(secondsIn / 0.4));
        const moment: DemoMoment = secondsIn < zeroAt + (step.early ? 0 : 0.6) ? "question" : "reveal";
        return { ...base, moment, revealedAtMs, questionNo, locked: lockedNow };
      }
    }
  }
  return { players, long, locked: 0, revealedAtMs: undefined, questionNo: 0, serverNowMs: stepStartMs, moment: "board" };
}

// The demo night, rebuilt only when one of its inputs changes. (A hook of its
// own so the React Compiler lint can see its inputs are plain values.)
function useDemoNight(
  moment: DemoMoment,
  players: number,
  secondsLeft: number,
  locked: number | undefined,
  builtAtMs: number,
  questionRevealedAtMs: number | undefined,
  long: boolean,
  questionNo: number,
) {
  return useMemo(
    () =>
      demoNight({
        moment,
        players,
        secondsLeft,
        locked,
        nowMs: builtAtMs,
        revealedAtMs: questionRevealedAtMs,
        long,
        questionNo,
      }),
    [moment, players, secondsLeft, locked, builtAtMs, questionRevealedAtMs, long, questionNo],
  );
}
