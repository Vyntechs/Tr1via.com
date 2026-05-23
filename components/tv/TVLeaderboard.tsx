// TV — leaderboard. Bold name typography + movement deltas. Top of the
// leaderboard wears the accent. Self-row is highlighted with the surface tint.

"use client";

import { TVStage, TVHeader, TVFooter } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVLeaderboardProps {
  themeKey?: ThemeKey;
}

interface Row {
  rank: number;
  name: string;
  score: number;
  delta: string;
  move: number;
  self?: boolean;
}

export function TVLeaderboard({ themeKey }: TVLeaderboardProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVLeaderboardInner />
      </ThemeProvider>
    );
  }
  return <TVLeaderboardInner />;
}

function TVLeaderboardInner() {
  const { t } = useTheme();
  const rows: Row[] = [
    { rank: 1,  name: "Devon",  score: 2140, delta: "+330", move: 0 },
    { rank: 2,  name: "Iris",   score: 1990, delta: "+550", move: 2 },
    { rank: 3,  name: "Priya",  score: 1820, delta: "+110", move: -1 },
    { rank: 4,  name: "Cole",   score: 1740, delta: "+220", move: 0 },
    { rank: 5,  name: "Ezra",   score: 1610, delta: "+440", move: 3 },
    { rank: 6,  name: "Nadia",  score: 1530, delta: "0",    move: -3 },
    { rank: 7,  name: "Maya",   score: 1460, delta: "+330", move: 1, self: true },
    { rank: 8,  name: "Theo",   score: 1380, delta: "+110", move: 0 },
    { rank: 9,  name: "Jules",  score: 1290, delta: "+220", move: 2 },
    { rank: 10, name: "Marcus", score: 1180, delta: "0",    move: -2 },
  ];

  return (
    <TVStage>
      <TVHeader left="GAME 1 · END OF ROUND 3" right="32 PLAYERS · 8 OF 42 ANSWERED" />

      <div
        style={{
          flex: 1,
          padding: "20px 56px 0",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <Display size={96} color={t.ink} weight={700}>
            <span style={{ color: t.accent }}>Standings.</span>
          </Display>
          <Eyebrow color={t.inkMute} size={11}>UPDATED LIVE · TOP 10</Eyebrow>
        </div>

        <div
          style={{
            marginTop: 16,
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            paddingBottom: 18,
          }}
        >
          {[rows.slice(0, 5), rows.slice(5)].map((col, ci) => (
            <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {col.map((r) => {
                const top = r.rank === 1;
                const isSelf = r.self;
                return (
                  <div
                    key={r.name}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "56px 1fr 90px 130px",
                      alignItems: "center",
                      gap: 18,
                      padding: "14px 20px",
                      background: top ? t.accent : isSelf ? t.surface : "transparent",
                      color: top ? "#0E0805" : t.ink,
                      border: `1px solid ${top ? t.accent : t.line}`,
                      borderRadius: 12,
                    }}
                  >
                    <Numeric
                      size={28}
                      weight={700}
                      color={top ? "#0E0805" : r.rank <= 3 ? t.accent : t.inkMid}
                      tracking={-0.03}
                    >
                      {r.rank}
                    </Numeric>
                    <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.015em" }}>
                      {r.name}
                      {isSelf && !top && (
                        <span style={{ color: t.pop, fontWeight: 500, marginLeft: 10, fontSize: 14 }}>
                          · you
                        </span>
                      )}
                    </span>
                    <Numeric
                      size={15}
                      weight={600}
                      color={
                        r.move > 0
                          ? top
                            ? "#0E0805"
                            : t.correct
                          : top
                            ? "rgba(14,8,5,.6)"
                            : t.inkMute
                      }
                    >
                      {r.move > 0 ? `↑ ${r.move}` : r.move < 0 ? `↓ ${-r.move}` : "—"}
                    </Numeric>
                    <div style={{ textAlign: "right" }}>
                      <Numeric size={26} weight={700} color={top ? "#0E0805" : t.ink}>
                        {r.score.toLocaleString()}
                      </Numeric>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          color: top
                            ? "rgba(14,8,5,.6)"
                            : r.delta === "0"
                              ? t.inkMute
                              : t.correct,
                          marginLeft: 8,
                          fontWeight: 600,
                        }}
                      >
                        {r.delta === "0" ? "" : r.delta}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <TVFooter left="LINDA IS LOADING ROUND 4" right="34 QUESTIONS LEFT" />
    </TVStage>
  );
}
