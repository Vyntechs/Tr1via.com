// TV — reveal. Drenched in the theme's correct-color. The whole stage paints
// itself, a massive answer numeral + word fill the left, the first-five-in
// rail on the right. Designed to feel like a curtain drop.

"use client";

import { TVStage } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
  Wordmark,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVRevealProps {
  themeKey?: ThemeKey;
}

export function TVReveal({ themeKey }: TVRevealProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVRevealInner />
      </ThemeProvider>
    );
  }
  return <TVRevealInner />;
}

function TVRevealInner() {
  const { t } = useTheme();
  const fastest = [
    { name: "Devon", time: "1.2s", delta: "+110" },
    { name: "Iris",  time: "1.4s", delta: "+110" },
    { name: "Maya",  time: "2.3s", delta: "+110" },
    { name: "Cole",  time: "2.8s", delta: "+110" },
    { name: "Priya", time: "3.1s", delta: "+110" },
  ];

  return (
    <TVStage bg={t.correct}>
      <div
        style={{
          padding: "32px 56px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Wordmark size={24} accent="#0E0805" ink="#0E0805" />
          <span style={{ width: 1, height: 16, background: "rgba(14,8,5,.2)" }} />
          <Eyebrow color="rgba(14,8,5,.65)" size={11}>GAME 1 · GEOGRAPHY · 100 PTS</Eyebrow>
        </div>
        <Eyebrow color="rgba(14,8,5,.65)" size={11}>REVEAL</Eyebrow>
      </div>

      <div
        style={{
          flex: 1,
          padding: "24px 56px 0",
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 56,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <Display size={56} color="rgba(14,8,5,.55)" weight={500} tracking={-0.025}>
            Which U.S. state has the<br />longest coastline?
          </Display>

          <div style={{ marginTop: 36, display: "flex", alignItems: "baseline", gap: 28 }}>
            <Numeric
              size={220}
              weight={700}
              color="#0E0805"
              tracking={-0.05}
              style={{ lineHeight: 0.85 }}
            >
              2
            </Numeric>
            <Display size={140} color="#0E0805" weight={700}>Alaska</Display>
          </div>

          <div
            style={{
              marginTop: 18,
              fontSize: 22,
              color: "rgba(14,8,5,.7)",
              lineHeight: 1.35,
              maxWidth: 700,
            }}
          >
            33,904 miles of tidal coastline — more than all other states combined.
          </div>

          <div style={{ marginTop: 36, display: "flex", gap: 48 }}>
            <div>
              <Eyebrow color="rgba(14,8,5,.55)" size={10}>GOT IT</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 44,
                  fontWeight: 700,
                  color: "#0E0805",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                23
                <span style={{ fontSize: 22, fontWeight: 500, opacity: 0.55 }}> / 32</span>
              </div>
            </div>
            <div>
              <Eyebrow color="rgba(14,8,5,.55)" size={10}>FASTEST</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 44,
                  fontWeight: 700,
                  color: "#0E0805",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                1.2s
              </div>
            </div>
            <div>
              <Eyebrow color="rgba(14,8,5,.55)" size={10}>SPEED BONUS</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 44,
                  fontWeight: 700,
                  color: "#0E0805",
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                +10
              </div>
            </div>
          </div>
        </div>

        <div>
          <Eyebrow color="rgba(14,8,5,.55)" size={10}>FIRST FIVE IN</Eyebrow>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {fastest.map((p, i) => (
              <div
                key={p.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px 1fr 80px",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 18px",
                  background: i === 0 ? "#0E0805" : "transparent",
                  color: i === 0 ? t.correct : "#0E0805",
                  borderRadius: 12,
                  border: i === 0 ? "none" : "1px solid rgba(14,8,5,.18)",
                }}
              >
                <Numeric
                  size={20}
                  weight={700}
                  color={i === 0 ? t.correct : "rgba(14,8,5,.6)"}
                >
                  {i + 1}
                </Numeric>
                <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  {p.name}
                </span>
                <Numeric
                  size={16}
                  weight={600}
                  color={i === 0 ? t.correct : "rgba(14,8,5,.55)"}
                >
                  {p.time}
                </Numeric>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "20px 56px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <Eyebrow color="rgba(14,8,5,.55)" size={10}>
          SPEED BONUS REWARDS FAST CORRECT — NEVER GUESSING
        </Eyebrow>
        <Eyebrow color="rgba(14,8,5,.55)" size={10}>NEXT IN A MOMENT</Eyebrow>
      </div>
    </TVStage>
  );
}
