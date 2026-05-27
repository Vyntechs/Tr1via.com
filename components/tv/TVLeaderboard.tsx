// TV — leaderboard. Bold name typography + movement deltas. Top of the
// leaderboard wears the accent. Self-row is highlighted with the surface tint.
//
// Driven by props so the live `/tv/[code]` route can feed the top 10 from
// the `game_scores` view. Demo rows preserved for `/dev/tv`.

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

export interface TVLeaderboardRow {
  rank: number;
  name: string;
  score: number;
  /** Pre-formatted delta from the previous round, e.g. "+330" or "0". */
  delta?: string;
  /** Movement signal. Positive = climbed; negative = fell; zero = flat. */
  move?: number;
  /** True for the current viewer ("· you" tag). */
  self?: boolean;
}

export interface TVLeaderboardProps {
  themeKey?: ThemeKey;
  /** Header left, e.g. "GAME 1 · END OF ROUND 3". */
  headerLeft?: string;
  /** Header right, e.g. "32 PLAYERS · 8 OF 42 ANSWERED". */
  headerRight?: string;
  /** Footer left, e.g. "LINDA IS LOADING ROUND 4". */
  footerLeft?: string;
  /** Footer right, e.g. "34 QUESTIONS LEFT". */
  footerRight?: string;
  /** Top 10 rows for the board. Defaults to demo data. */
  rows?: TVLeaderboardRow[];
}

export function TVLeaderboard({ themeKey, ...rest }: TVLeaderboardProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVLeaderboardInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVLeaderboardInner {...rest} />;
}

export const DEMO_ROWS: TVLeaderboardRow[] = [
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

function TVLeaderboardInner({
  headerLeft = "",
  headerRight = "",
  footerLeft = "",
  footerRight = "",
  rows = [],
}: Omit<TVLeaderboardProps, "themeKey">) {
  const { t } = useTheme();
  // Be defensive — when the room has fewer than 10 players the right column
  // can be empty. We always render two columns to keep the layout stable.
  const left = rows.slice(0, 5);
  const right = rows.slice(5, 10);

  return (
    <TVStage data-testid="tv-leaderboard">
      <TVHeader left={headerLeft} right={headerRight} />

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
          {[left, right].map((col, ci) => (
            <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {col.map((r) => {
                const top = r.rank === 1;
                const isSelf = r.self;
                const move = r.move ?? 0;
                return (
                  <div
                    key={`${r.rank}-${r.name}`}
                    data-testid={`tv-leaderboard-row-${r.rank}`}
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
                        move > 0
                          ? top
                            ? "#0E0805"
                            : t.correct
                          : top
                            ? "rgba(14,8,5,.6)"
                            : t.inkMute
                      }
                    >
                      {move > 0 ? `↑ ${move}` : move < 0 ? `↓ ${-move}` : "—"}
                    </Numeric>
                    <div style={{ textAlign: "right" }}>
                      <Numeric size={26} weight={700} color={top ? "#0E0805" : t.ink}>
                        {r.score.toLocaleString()}
                      </Numeric>
                      {r.delta && r.delta !== "0" && (
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 12,
                            color: top ? "rgba(14,8,5,.6)" : t.correct,
                            marginLeft: 8,
                            fontWeight: 600,
                          }}
                        >
                          {r.delta}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <TVFooter left={footerLeft} right={footerRight} />
    </TVStage>
  );
}
