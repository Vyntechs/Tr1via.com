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
  const players = Number(params.get("players") ?? 29);
  const lockedParam = params.get("locked");
  const play = params.get("play") === "1";
  const tier = params.get("tier") === "still" ? "still" : "full";
  const long = params.get("long") === "1";

  // Build once per page load so the clock runs from the moment it opened.
  const [startMs] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(startMs);
  useEffect(() => {
    if (!play) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [play]);

  const revealedAtMs = startMs - (25 - PLAY_START_SECONDS) * 1000;
  const elapsed = (nowMs - startMs) / 1000;
  const playLocked = Math.min(Math.round(players * 0.72), 2 + Math.floor(elapsed / 0.45));
  const zeroAt = PLAY_START_SECONDS;

  let moment: DemoMoment;
  let secondsLeft = Number(params.get("s") ?? 14);
  let locked = lockedParam === null ? undefined : Number(lockedParam);
  if (play) {
    moment = elapsed < zeroAt + 0.6 ? "question" : elapsed < zeroAt + 8 ? "reveal" : "board";
    secondsLeft = PLAY_START_SECONDS;
    locked = playLocked;
  } else {
    moment = MOMENTS.includes(momentParam as DemoMoment) ? (momentParam as DemoMoment) : "question";
  }

  const night = useMemo(
    () =>
      demoNight({
        moment,
        players,
        secondsLeft,
        locked,
        nowMs: play ? startMs : nowMs,
        revealedAtMs: play ? revealedAtMs : undefined,
        long,
      }),
    [moment, players, secondsLeft, locked, play, startMs, nowMs, revealedAtMs, long],
  );
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
            tvLastBroadcastServerNow={new Date(startMs).toISOString()}
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
            lastBroadcastServerNow={new Date(startMs).toISOString()}
            themeKey={themeKey}
            worldTier={tier}
          />
        </ScaledTVCanvas>
      </ThemeProvider>
    </div>
  );
}
