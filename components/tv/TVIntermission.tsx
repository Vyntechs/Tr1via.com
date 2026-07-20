// TV — intermission. The risk: a dead moment between Game 1 and Game 2 that
// owns the room instead of letting it drift. Three winners get a podium row,
// a "ready" panel shows who's back in, late arrivals get a join QR, and the
// night's notable numbers anchor the right column.
//
// Driven by props for the live `/tv/[code]` route; demo defaults preserved
// for the `/dev/tv` gallery.

"use client";

import { TVStage, TVHeader, TVFooter } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  QRBlock,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import type { ThemeKey } from "@/lib/theme/tokens";
import { readableForeground } from "@/lib/theme/contrast";

export interface TVIntermissionPodiumRow {
  rank: number;
  name: string;
  score: number;
  /** One-line color note about how they got here. Optional. */
  line?: string;
  /** Override color for the row outline. Defaults from rank position. */
  color?: string;
}

export interface TVIntermissionStat {
  /** SHORT-CAPS label, e.g. "FASTEST". */
  l: string;
  /** Value, e.g. "0.9s". */
  v: string;
  /** Sub-line under the value. */
  sub?: string;
}

export interface TVIntermissionProps {
  themeKey?: ThemeKey;
  headerLeft?: string;
  headerRight?: string;
  footerLeft?: string;
  footerRight?: string;
  /** Top 3 winners. */
  podium?: TVIntermissionPodiumRow[];
  /** Total players who have re-joined for Game 2. */
  readyCount?: number | null;
  /** Total players in the night. */
  totalCount?: number;
  /** Pre-formatted room code with middle dot, e.g. "K9P·R4M". */
  roomCode?: string;
  /** Full URL the QR encodes. */
  joinUrl?: string;
  /** Notable stats for the right column. */
  nightStats?: TVIntermissionStat[];
}

export function TVIntermission({ themeKey, ...rest }: TVIntermissionProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVIntermissionInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVIntermissionInner {...rest} />;
}

export function demoPodium(t: ResolvedTheme): TVIntermissionPodiumRow[] {
  return [
    { rank: 1, name: "Devon", score: 6280, line: "Two streaks of five. Untouchable.", color: t.accent },
    { rank: 2, name: "Iris",  score: 5740, line: "Fastest hand in the room.",         color: t.pop },
    { rank: 3, name: "Priya", score: 5220, line: "Quietly perfect on history.",       color: t.correct },
  ];
}

export const DEMO_INTERMISSION_STATS: TVIntermissionStat[] = [
  { l: "FASTEST", v: "0.9s", sub: "Iris on music" },
  { l: "STREAK",  v: "×7",   sub: "Devon on history" },
  { l: "STUMPER", v: "4/32", sub: "Egyptian honey" },
];

function TVIntermissionInner({
  headerLeft = "GAME 1 · COMPLETE",
  headerRight = "GAME 2 LAUNCHES WHEN HOST SAYS GO",
  footerLeft = "",
  footerRight = "HOST STARTS GAME 2 WHEN ENOUGH ARE IN",
  podium,
  readyCount = null,
  totalCount = 0,
  roomCode = "",
  joinUrl = "",
  nightStats = [],
}: Omit<TVIntermissionProps, "themeKey">) {
  const { t } = useTheme();
  // Production callers MUST pass a real podium. Without one we render
  // an empty list rather than fake Devon-and-friends placeholder data.
  const rows = podium ?? [];

  return (
    <TVStage data-testid="tv-intermission">
      <TVHeader left={headerLeft} right={headerRight} />

      <div
        style={{
          flex: 1,
          padding: "24px 56px 0",
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 48,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <Display size={68} color={t.ink} weight={700}>
            <span style={{ color: t.accent }}>Game 1.</span> Winners.
          </Display>

          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((p) => {
              const color = p.color ?? (p.rank === 1 ? t.accent : p.rank === 2 ? t.pop : t.correct);
              const rowForeground = readableForeground(color);
              return (
                <div
                  key={p.rank}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr auto",
                    alignItems: "center",
                    gap: 22,
                    padding: "22px 26px",
                    borderRadius: 16,
                    background: p.rank === 1 ? color : "transparent",
                    color: p.rank === 1 ? rowForeground : t.ink,
                    border: `1.5px solid ${color}`,
                  }}
                >
                  <Numeric
                    size={56}
                    weight={700}
                    color={p.rank === 1 ? rowForeground : color}
                    tracking={-0.04}
                  >
                    {p.rank}
                  </Numeric>
                  <div>
                    <Display size={48} color="currentColor" weight={700}>{p.name}</Display>
                    {p.line && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 14,
                          fontWeight: 500,
                          opacity: p.rank === 1 ? 0.7 : 0.6,
                        }}
                      >
                        {p.line}
                      </div>
                    )}
                  </div>
                  <Numeric size={36} weight={700} color="currentColor">
                    {p.score.toLocaleString()}
                  </Numeric>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 24, fontSize: 16, color: t.inkMid, lineHeight: 1.5, maxWidth: 560 }}>
            Game 2 starts fresh. Everyone is back to zero with new categories.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "22px 24px", borderRadius: 16, background: t.accent, color: readableForeground(t.accent) }}>
            <Eyebrow color="currentColor" size={10}>READY FOR GAME 2</Eyebrow>
            {readyCount === null ? (
              <Display size={58} color="currentColor" weight={700} style={{ display: "block", marginTop: 12 }}>
                Starts when the host is ready.
              </Display>
            ) : (
              <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 14 }}>
                <Numeric
                  size={96}
                  weight={700}
                  color="currentColor"
                  tracking={-0.05}
                  style={{ lineHeight: 0.9 }}
                >
                  {readyCount}
                </Numeric>
                <span style={{ fontSize: 22, fontWeight: 500, opacity: 0.7 }}>of {totalCount}</span>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 15, fontWeight: 500 }}>
              Open your phone. Tap <span style={{ fontWeight: 700 }}>Join Game 2</span> — your name is already in.
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "18px 22px",
              borderRadius: 16,
              background: t.surface,
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <div
              style={{
                color: t.ink,
                fontSize: 15,
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              Players — scan to join this game
            </div>
            <QRBlock url={joinUrl} size={110} light />
            <div>
              <Eyebrow color={t.inkMute} size={10}>NEW HERE?</Eyebrow>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 18,
                  fontWeight: 700,
                  color: t.ink,
                  letterSpacing: "-0.005em",
                }}
              >
                Scan to jump in.
              </div>
              <div style={{ marginTop: 4, color: t.inkMid, fontSize: 13 }}>
                tr1via.com ·{" "}
                <span
                  style={{
                    color: t.accent,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                  }}
                >
                  {roomCode}
                </span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "auto", padding: "18px 0", borderTop: `1px solid ${t.line}` }}>
            <Eyebrow color={t.inkMute} size={10}>GAME 1 IN NUMBERS</Eyebrow>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {nightStats.map((s) => (
                <div key={s.l}>
                  <Eyebrow color={t.inkMute} size={9}>{s.l}</Eyebrow>
                  <Numeric
                    size={26}
                    weight={700}
                    color={t.ink}
                    style={{ display: "block", marginTop: 4 }}
                  >
                    {s.v}
                  </Numeric>
                  {s.sub && (
                    <div style={{ fontSize: 11, color: t.inkMid, marginTop: 2 }}>{s.sub}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <TVFooter left={footerLeft} right={footerRight} />
    </TVStage>
  );
}
