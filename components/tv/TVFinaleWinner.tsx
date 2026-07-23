// TV — finale winner. The end of the night. Heightened weather (intensity
// 2.2) on the theme's signature motion. Massive name. Three highlight chips
// for the headline stats. Runner-up rail + the night-in-numbers card on
// the right. Closing scene of the movie.
//
// Driven by props so `/tv/[code]` can paint the actual winner; demo defaults
// preserved for the `/dev/tv` gallery.

"use client";

import { useEffect, useState } from "react";
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
import { useCrescendo } from "@/lib/hooks/useCrescendo";

export interface TVFinaleWinnerData {
  name: string;
  score: number;
  /** Correct answers. */
  correct?: number;
  /** Of total questions in the game. */
  of?: number;
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

export const DEMO_WINNER: TVFinaleWinnerData = {
  name: "Devon",
  score: 8420,
  correct: 38,
  of: 42,
  streak: 7,
  fastest: "0.9s",
  blurb: "Two streaks of five and a near-perfect history round. Untouchable from the third question on.",
};

export const DEMO_PODIUM: TVFinalePodiumRow[] = [
  { rank: 2, name: "Iris",  score: 7960 },
  { rank: 3, name: "Priya", score: 7340 },
];

export const DEMO_STATS: TVFinaleStat[] = [
  { l: "PLAYERS",      v: "32" },
  { l: "QUESTIONS",    v: "84" },
  { l: "FASTEST EVER", v: "0.6s · Cole" },
  { l: "STUMPER",      v: "4/32 · Egyptian honey" },
];

function TVFinaleWinnerInner({
  headerEyebrow = "",
  headerRight = "GAME 2 · FINAL",
  winner,
  podium = [],
  nightStats = [],
}: Omit<TVFinaleWinnerProps, "themeKey">) {
  // Hooks first — ALWAYS, before any early return. These three previously sat
  // below the `if (!winner)` guard; when `winner` flipped null→populated across
  // renders (finale data arriving), the hook COUNT changed and React #310
  // crashed the venue TV at the finale — same class as the #67 TVPage crash.
  // Regression: tests/unit/tv-finale-winner-hooks.test.tsx.
  const { t, themeKey } = useTheme();

  // Finale lightning: for the May "storm" theme, fire 2-3 close strikes in
  // quick succession once the winner paints. This is the "WHOA" moment — the
  // close of the night. Other themes ignore the prop. We stage three bumps
  // spaced ~700ms apart so the room sees a flurry, not a single flash.
  //
  // Gate on `winner`, NOT just `themeKey`: the effect sits above the
  // `if (!winner) return null` guard (hoisted there to fix the React #310 hook-
  // count crash — see the comment above). If it fired on the empty, scores-
  // still-loading render, the three bumps would advance the count to 3 against
  // a tree where no Weather/Lightning is mounted. `Lightning` seeds its "last
  // seen" ref from the count present at mount and only strikes on a CHANGE, so
  // when the winner finally arrived it would mount already at 3 and play
  // nothing. Keying the effect on the winner restarts the timers the moment
  // Lightning actually mounts. Regression: tests/unit/tv-finale-winner-hooks.test.tsx.
  const hasWinner = Boolean(winner);
  // Finale "build → erupt" crescendo: the theme's weather climbs from a calm
  // base to a heightened peak over ~3s as the winner card settles, while the
  // synchronized firework beat (PyrotechnicsBeatConductor on the TV route)
  // delivers the unified erupt burst. Reduced motion sits at the peak (static).
  // Reads live by the engine — the show is never reset mid-ramp.
  const finaleIntensity = useCrescendo({ from: 1.1, to: 2.4, durationMs: 3000 });
  const [lightningTriggerCount, setLightningTriggerCount] = useState(0);
  useEffect(() => {
    if (themeKey !== "may" || !hasWinner) return;
    // First strike: ~250ms in so it lands once the name has rendered.
    const t1 = window.setTimeout(() => setLightningTriggerCount((n) => n + 1), 250);
    const t2 = window.setTimeout(() => setLightningTriggerCount((n) => n + 1), 950);
    const t3 = window.setTimeout(() => setLightningTriggerCount((n) => n + 1), 1700);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [themeKey, hasWinner]);

  // No winner data → render nothing rather than fake names. Production callers
  // MUST pass real data; the empty state prevents demo leakage. (After the
  // hooks, so the hook order is identical whether or not `winner` is present.)
  if (!winner) return null;

  return (
    <div
      data-testid="tv-finale-winner"
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
      {/* Heightened weather — the theme's signature motion ramps up (build) into
          the synchronized firework erupt for the finale crescendo */}
      <Weather
        themeKey={themeKey}
        intensity={finaleIntensity}
        lightningTriggerCount={lightningTriggerCount}
      />
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
            <span data-testid="tv-finale-winner-name" style={{ display: "block" }}>
              <Display
                size={220}
                color={t.ink}
                weight={700}
                tracking={-0.05}
                style={{ marginTop: 12, display: "block" }}
              >
                {winner.name}.
              </Display>
            </span>

            <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 28 }}>
              <span data-testid="tv-finale-winner-score" style={{ display: "block" }}>
                <Numeric
                  size={88}
                  weight={700}
                  color={t.accent}
                  tracking={-0.05}
                  style={{ lineHeight: 1 }}
                >
                  {winner.score.toLocaleString()}
                </Numeric>
              </span>
              <span style={{ fontSize: 26, color: t.inkMid, fontWeight: 500 }}>points</span>
            </div>

            <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 12 }}>
              {winner.correct !== undefined && winner.of !== undefined && (
                <FinaleChip label="GOT RIGHT" value={`${winner.correct} of ${winner.of}`} color={t.correct} t={t} />
              )}
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
