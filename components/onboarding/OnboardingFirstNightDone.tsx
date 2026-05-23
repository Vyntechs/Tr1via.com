// POST-FIRST-NIGHT CELEBRATION — appears ONLY after her very first finished
// game. After-effect overlay on the TV finale. Linda sees this on her laptop;
// players don't.

"use client";

import { LaptopShell } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
  Weather,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface OnboardingFirstNightStats {
  players: number;
  gamesRun: number;
  questionsAsked: number;
  /** Display string like "Devon · 8,420". */
  winner: string;
  /** Display string like "0.6s · Cole". */
  fastestAnswer: string;
  /** Display string like "54 seconds". */
  setupTime: string;
}

export interface OnboardingFirstNightDoneProps {
  themeKey?: ThemeKey;
  /** Optional stat overrides; falls back to the demo numbers. */
  stats?: OnboardingFirstNightStats;
  /** Called when the host taps "Set up next Wednesday". */
  onSetupNext?: () => void;
  /** Called when the host taps "See tonight's recap". */
  onSeeRecap?: () => void;
}

export function OnboardingFirstNightDone({
  themeKey,
  stats,
  onSetupNext,
  onSeeRecap,
}: OnboardingFirstNightDoneProps) {
  const inner = (
    <OnboardingFirstNightDoneInner
      stats={stats}
      onSetupNext={onSetupNext}
      onSeeRecap={onSeeRecap}
    />
  );
  if (themeKey) {
    return <ThemeProvider themeKey={themeKey}>{inner}</ThemeProvider>;
  }
  return inner;
}

interface OnboardingFirstNightDoneInnerProps {
  stats?: OnboardingFirstNightStats;
  onSetupNext?: () => void;
  onSeeRecap?: () => void;
}

function OnboardingFirstNightDoneInner({
  stats,
  onSetupNext,
  onSeeRecap,
}: OnboardingFirstNightDoneInnerProps) {
  const { t, themeKey } = useTheme();
  const numbers = stats
    ? [
        { l: "PLAYERS", v: stats.players.toString() },
        { l: "GAMES RUN", v: stats.gamesRun.toString() },
        { l: "QUESTIONS ASKED", v: stats.questionsAsked.toString() },
        { l: "WINNER", v: stats.winner },
        { l: "FASTEST ANSWER", v: stats.fastestAnswer },
        { l: "SETUP TIME", v: stats.setupTime },
      ]
    : [
        { l: "PLAYERS", v: "32" },
        { l: "GAMES RUN", v: "2" },
        { l: "QUESTIONS ASKED", v: "84" },
        { l: "WINNER", v: "Devon · 8,420" },
        { l: "FASTEST ANSWER", v: "0.6s · Cole" },
        { l: "SETUP TIME", v: "54 seconds" },
      ];
  const headline = stats
    ? `You hosted ${stats.players} players, ran ${stats.questionsAsked} questions, and gave away one trivia trophy. Next Wednesday's right here when you're ready.`
    : "You hosted 32 players, ran 84 questions, and gave away one trivia trophy. Next Wednesday's right here when you're ready.";
  return (
    <LaptopShell title="tr1via.com / linda">
      <div
        style={{
          flex: 1,
          padding: "60px 72px",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <Weather themeKey={themeKey} intensity={1.4} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 640 }}>
          <Eyebrow color={t.accent} size={11}>
            NIGHT ONE · COMPLETE
          </Eyebrow>
          <Display
            size={96}
            color={t.ink}
            weight={700}
            tracking={-0.04}
            style={{ marginTop: 10, display: "block", lineHeight: 0.95 }}
          >
            Your first room.
            <br />
            <span style={{ color: t.accent }}>Nice work.</span>
          </Display>

          <div
            style={{
              marginTop: 26,
              fontSize: 17,
              color: t.inkMid,
              lineHeight: 1.5,
              maxWidth: 540,
            }}
          >
            {headline}
          </div>

          {/* Single-screen souvenir — small grid of the night's facts, like a ticket stub */}
          <div
            style={{
              marginTop: 32,
              padding: "20px 24px",
              borderRadius: 14,
              background: t.surface,
              maxWidth: 540,
            }}
          >
            <Eyebrow color={t.inkMute} size={10}>
              YOUR FIRST NIGHT · IN NUMBERS
            </Eyebrow>
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "14px 24px",
              }}
            >
              {numbers.map((s) => (
                <div
                  key={s.l}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    borderBottom: `1px solid ${t.lineSoft}`,
                    paddingBottom: 6,
                  }}
                >
                  <Eyebrow color={t.inkMute} size={9}>
                    {s.l}
                  </Eyebrow>
                  <Numeric size={14} weight={700} color={t.ink}>
                    {s.v}
                  </Numeric>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={onSetupNext}
              style={{
                background: t.accent,
                color: "#FFF",
                border: "none",
                borderRadius: 12,
                padding: "14px 22px",
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                letterSpacing: "-0.005em",
                boxShadow: `0 12px 24px -10px ${t.accent}77`,
              }}
            >
              Set up next Wednesday  →
            </button>
            <button
              type="button"
              onClick={onSeeRecap}
              style={{
                background: "transparent",
                color: t.ink,
                border: `1px solid ${t.line}`,
                borderRadius: 12,
                padding: "14px 22px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              See tonight&apos;s recap
            </button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
