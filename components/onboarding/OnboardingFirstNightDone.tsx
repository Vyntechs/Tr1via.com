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

export interface OnboardingFirstNightDoneProps {
  themeKey?: ThemeKey;
}

export function OnboardingFirstNightDone({ themeKey }: OnboardingFirstNightDoneProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <OnboardingFirstNightDoneInner />
      </ThemeProvider>
    );
  }
  return <OnboardingFirstNightDoneInner />;
}

function OnboardingFirstNightDoneInner() {
  const { t, themeKey } = useTheme();
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
            You hosted 32 players, ran 84 questions, and gave away one trivia trophy. Next
            Wednesday&apos;s right here when you&apos;re ready.
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
              {[
                { l: "PLAYERS", v: "32" },
                { l: "GAMES RUN", v: "2" },
                { l: "QUESTIONS ASKED", v: "84" },
                { l: "WINNER", v: "Devon · 8,420" },
                { l: "FASTEST ANSWER", v: "0.6s · Cole" },
                { l: "SETUP TIME", v: "54 seconds" },
              ].map((s) => (
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
