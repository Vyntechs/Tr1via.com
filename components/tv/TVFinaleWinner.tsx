// TV — finale winner. The end of the night. Heightened weather (intensity
// 2.2) on the theme's signature motion. Massive name. Three highlight chips
// for the headline stats. Runner-up rail + the night-in-numbers card on
// the right. Closing scene of the movie.
//
// Driven by props so `/tv/[code]` can paint the actual winner; demo defaults
// preserved for the `/_dev/tv` gallery.

"use client";

import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
  Weather,
  Wordmark,
} from "@/components/system";
import type { ResolvedTheme } from "@/lib/theme/resolve";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVFinaleWinnerData {
  name: string;
  score: number;
  /** Correct answers. */
  correct: number;
  /** Of total questions in the game. */
  of: number;
  /** Longest correct streak. */
  streak?: number;
  /** Pre-formatted fastest correct time, e.g. "0.9s". */
  fastest?: string;
  /** Optional editorial blurb under the chips. */
  blurb?: string;
}

export interface TVFinalePodiumRow {
  rank: number;
  name: string;
  score: number;
}

export interface TVFinaleStat {
  l: string;
  v: string;
}

export interface TVFinaleWinnerProps {
  themeKey?: ThemeKey;
  /** Header eyebrow center: "SOUL FIRE PIZZA · WED MAY 27". */
  headerEyebrow?: string;
  /** Header right, e.g. "GAME 2 · FINAL". */
  headerRight?: string;
  winner?: TVFinaleWinnerData;
  /** Runners up (rank 2 + 3). */
  podium?: TVFinalePodiumRow[];
  /** The night's notable numbers. */
  nightStats?: TVFinaleStat[];
}

export function TVFinaleWinner({ themeKey, ...rest }: TVFinaleWinnerProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVFinaleWinnerInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVFinaleWinnerInner {...rest} />;
}

const DEMO_WINNER: TVFinaleWinnerData = {
  name: "Devon",
  score: 8420,
  correct: 38,
  of: 42,
  streak: 7,
  fastest: "0.9s",
  blurb: "Two streaks of five and a near-perfect history round. Untouchable from the third question on.",
};

const DEMO_PODIUM: TVFinalePodiumRow[] = [
  { rank: 2, name: "Iris",  score: 7960 },
  { rank: 3, name: "Priya", score: 7340 },
];

const DEMO_STATS: TVFinaleStat[] = [
  { l: "PLAYERS",      v: "32" },
  { l: "QUESTIONS",    v: "84" },
  { l: "FASTEST EVER", v: "0.6s · Cole" },
  { l: "STUMPER",      v: "4/32 · Egyptian honey" },
];

function TVFinaleWinnerInner({
  headerEyebrow = "SOUL FIRE PIZZA · WED MAY 27",
  headerRight = "GAME 2 · FINAL",
  winner = DEMO_WINNER,
  podium = DEMO_PODIUM,
  nightStats = DEMO_STATS,
}: Omit<TVFinaleWinnerProps, "themeKey">) {
  const { t, themeKey } = useTheme();

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Heightened weather — the theme's signature motion turned up for the finale */}
      <Weather themeKey={themeKey} intensity={2.2} />
      {/* Soft radial glow center-stage */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(50% 40% at 50% 40%, ${t.accent}22, transparent 60%)`,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "32px 56px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Wordmark size={22} accent={t.accent} ink={t.ink} />
            <span style={{ width: 1, height: 16, background: t.line }} />
            <Eyebrow color={t.inkMid} size={11}>{headerEyebrow}</Eyebrow>
          </div>
          <Eyebrow color={t.accent} size={11}>{headerRight}</Eyebrow>
        </div>

        {/* The moment */}
        <div
          style={{
            flex: 1,
            padding: "20px 56px 0",
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr",
            gap: 56,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <Eyebrow color={t.accent} size={13}>WON THE NIGHT</Eyebrow>
            <Display
              size={220}
              color={t.ink}
              weight={700}
              tracking={-0.05}
              style={{ marginTop: 12, display: "block" }}
            >
              {winner.name}.
            </Display>

            <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 28 }}>
              <Numeric
                size={88}
                weight={700}
                color={t.accent}
                tracking={-0.05}
                style={{ lineHeight: 1 }}
              >
                {winner.score.toLocaleString()}
              </Numeric>
              <span style={{ fontSize: 26, color: t.inkMid, fontWeight: 500 }}>points</span>
            </div>

            <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12 }}>
              <FinaleChip label="GOT RIGHT" value={`${winner.correct} of ${winner.of}`} color={t.correct} t={t} />
              {typeof winner.streak === "number" && winner.streak > 1 && (
                <FinaleChip label="LONGEST STREAK" value={`×${winner.streak}`} color={t.accent} t={t} />
              )}
              {winner.fastest && (
                <FinaleChip label="FASTEST ANSWER" value={winner.fastest} color={t.pop} t={t} />
              )}
            </div>

            {winner.blurb && (
              <div style={{ marginTop: 24, fontSize: 16, color: t.inkMid, lineHeight: 1.5, maxWidth: 560 }}>
                {winner.blurb}
              </div>
            )}
          </div>

          {/* Podium / runner-up rail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 14 }}>
            <Eyebrow color={t.inkMute} size={11}>SECOND AND THIRD</Eyebrow>
            {podium.map((p) => (
              <div
                key={p.rank}
                style={{
                  padding: "20px 22px",
                  borderRadius: 14,
                  background: t.surface,
                  border: `1px solid ${t.line}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                  }}
                >
                  <Numeric size={38} weight={700} color={t.accent} tracking={-0.04}>{p.rank}</Numeric>
                  <Numeric size={20} weight={700} color={t.ink}>{p.score.toLocaleString()}</Numeric>
                </div>
                <Display
                  size={42}
                  color={t.ink}
                  weight={700}
                  style={{ marginTop: 4, display: "block" }}
                >
                  {p.name}
                </Display>
              </div>
            ))}

            <div
              style={{
                padding: "18px 22px",
                borderRadius: 14,
                background: t.surface,
                border: `1px solid ${t.line}`,
              }}
            >
              <Eyebrow color={t.inkMute} size={10}>THE NIGHT IN NUMBERS</Eyebrow>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {nightStats.map((s) => (
                  <div
                    key={s.l}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: t.inkMid,
                        letterSpacing: "0.08em",
                      }}
                    >
                      {s.l}
                    </span>
                    <Numeric size={14} weight={600} color={t.ink}>{s.v}</Numeric>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "20px 56px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Eyebrow color={t.inkMute} size={10}>
            SEE YOU NEXT WEEK · SAME PLACE, FRESH BOARD
          </Eyebrow>
          <Eyebrow color={t.inkMute} size={10}>TR1VIA.COM</Eyebrow>
        </div>
      </div>
    </div>
  );
}

interface FinaleChipProps {
  label: string;
  value: string;
  color: string;
  t: ResolvedTheme;
}

function FinaleChip({ label, value, color }: FinaleChipProps) {
  return (
    <div
      style={{
        padding: "12px 18px",
        borderRadius: 12,
        background: color,
        color: "#0E0805",
        display: "flex",
        alignItems: "baseline",
        gap: 14,
        boxShadow: `0 8px 18px -8px ${color}88`,
      }}
    >
      <Eyebrow color="rgba(14,8,5,.6)" size={9}>{label}</Eyebrow>
      <Numeric size={22} weight={700} color="#0E0805">{value}</Numeric>
    </div>
  );
}
