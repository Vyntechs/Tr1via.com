// TV — reveal (stumper variant). Same structure as TVReveal but for the
// "no one got it" moment. Honest framing, light tone, never punitive — the
// hard questions earn more on purpose.

"use client";

import { TVStage, TVHeader, TVFooter } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVRevealStumperProps {
  themeKey?: ThemeKey;
}

export function TVRevealStumper({ themeKey }: TVRevealStumperProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVRevealStumperInner />
      </ThemeProvider>
    );
  }
  return <TVRevealStumperInner />;
}

function TVRevealStumperInner() {
  const { t } = useTheme();
  const cc = categoryColor("History", t.accent);
  const fastest = [
    { name: "Devon", time: "8.4s" },
    { name: "Iris",  time: "11.2s" },
    { name: "Cole",  time: "14.1s" },
    { name: "Priya", time: "17.8s" },
  ];

  return (
    <TVStage bg={t.paper}>
      <TVHeader accent={cc} left="GAME 1 · HISTORY · 700 PTS" right="REVEAL" />

      <div
        style={{
          flex: 1,
          padding: "24px 56px 0",
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 48,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <Eyebrow color={cc} size={12}>TOUGH ONE</Eyebrow>
          <Display
            size={42}
            color={t.inkMid}
            weight={500}
            tracking={-0.025}
            style={{ marginTop: 14, display: "block" }}
          >
            Honey discovered in Egyptian tombs was still edible — roughly how old?
          </Display>

          <div
            style={{
              marginTop: 28,
              padding: "28px 32px",
              borderRadius: 16,
              background: t.dark ? `${cc}10` : `${cc}06`,
              border: `1.5px solid ${cc}`,
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <Numeric
              size={88}
              weight={700}
              color={cc}
              tracking={-0.04}
              style={{ lineHeight: 1 }}
            >
              3
            </Numeric>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 700,
                  color: cc,
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                  fontFamily: "var(--font-display)",
                }}
              >
                ~3,000 years
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 15,
                  color: t.inkMid,
                  lineHeight: 1.4,
                  maxWidth: 460,
                }}
              >
                Honey doesn&apos;t spoil — low water, high acidity, natural hydrogen peroxide. 3,000-year-old tomb jars are still good.
              </div>
            </div>
          </div>

          {/* The honest framing — small, never punitive */}
          <div
            style={{
              marginTop: 22,
              padding: "14px 18px",
              borderRadius: 12,
              background: t.surface,
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <Numeric size={28} weight={700} color={t.ink}>4</Numeric>
            <span style={{ color: t.ink, fontSize: 15, fontWeight: 600 }}>of 32 got it.</span>
            <span style={{ flex: 1 }} />
            <span style={{ color: t.inkMid, fontSize: 13 }}>The other 28 are in good company.</span>
          </div>
        </div>

        <div>
          <Eyebrow color={t.inkMute} size={10}>THE FOUR WHO NAILED IT</Eyebrow>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {fastest.map((p, i) => (
              <div
                key={p.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 1fr 80px",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 18px",
                  borderRadius: 12,
                  background: i === 0 ? cc : "transparent",
                  color: i === 0 ? "#0E0805" : t.ink,
                  border: i === 0 ? "none" : `1px solid ${t.line}`,
                }}
              >
                <Numeric size={20} weight={700} color={i === 0 ? "#0E0805" : t.inkMid}>
                  {i + 1}
                </Numeric>
                <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  {p.name}
                </span>
                <Numeric
                  size={16}
                  weight={600}
                  color={i === 0 ? "rgba(14,8,5,.65)" : t.inkMid}
                >
                  {p.time}
                </Numeric>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "14px 16px",
              borderRadius: 10,
              background: t.surface,
              fontSize: 12,
              color: t.inkMid,
              lineHeight: 1.5,
            }}
          >
            Hard questions are worth more on purpose. This was a 700 — a 70-point speed bonus for Devon for landing it under 5 seconds.
          </div>
        </div>
      </div>

      <TVFooter
        left="HARDER QUESTIONS, BIGGER POINTS. THAT'S THE TRADE."
        right="NEXT IN A MOMENT"
      />
    </TVStage>
  );
}
