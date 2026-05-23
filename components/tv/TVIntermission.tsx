// TV — intermission. The risk: a dead moment between Game 1 and Game 2 that
// owns the room instead of letting it drift. Three winners get a podium row,
// a "ready" panel shows who's back in, late arrivals get a join QR, and the
// night's notable numbers anchor the right column.

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
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVIntermissionProps {
  themeKey?: ThemeKey;
}

export function TVIntermission({ themeKey }: TVIntermissionProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVIntermissionInner />
      </ThemeProvider>
    );
  }
  return <TVIntermissionInner />;
}

function TVIntermissionInner() {
  const { t } = useTheme();
  const podium = [
    { rank: 1, name: "Devon", score: 6280, line: "Two streaks of five. Untouchable.", color: t.accent },
    { rank: 2, name: "Iris",  score: 5740, line: "Fastest hand in the room.",         color: t.pop },
    { rank: 3, name: "Priya", score: 5220, line: "Quietly perfect on history.",       color: t.correct },
  ];
  const nightStats = [
    { l: "FASTEST", v: "0.9s", sub: "Iris on music" },
    { l: "STREAK",  v: "×7",   sub: "Devon on history" },
    { l: "STUMPER", v: "4/32", sub: "Egyptian honey" },
  ];

  return (
    <TVStage>
      <TVHeader left="GAME 1 · COMPLETE" right="GAME 2 LAUNCHES WHEN LINDA SAYS GO" />

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
            {podium.map((p) => (
              <div
                key={p.rank}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr auto",
                  alignItems: "center",
                  gap: 22,
                  padding: "22px 26px",
                  borderRadius: 16,
                  background: p.rank === 1 ? p.color : "transparent",
                  color: p.rank === 1 ? "#0E0805" : t.ink,
                  border: `1.5px solid ${p.color}`,
                }}
              >
                <Numeric
                  size={56}
                  weight={700}
                  color={p.rank === 1 ? "#0E0805" : p.color}
                  tracking={-0.04}
                >
                  {p.rank}
                </Numeric>
                <div>
                  <Display size={48} color="currentColor" weight={700}>{p.name}</Display>
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
                </div>
                <Numeric size={36} weight={700} color="currentColor">
                  {p.score.toLocaleString()}
                </Numeric>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 24, fontSize: 16, color: t.inkMid, lineHeight: 1.5, maxWidth: 560 }}>
            Game 2 starts fresh. Everyone back to zero, new categories — same room.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "22px 24px", borderRadius: 16, background: t.accent, color: "#0E0805" }}>
            <Eyebrow color="rgba(14,8,5,.65)" size={10}>READY FOR GAME 2</Eyebrow>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 14 }}>
              <Numeric
                size={96}
                weight={700}
                color="#0E0805"
                tracking={-0.05}
                style={{ lineHeight: 0.9 }}
              >
                24
              </Numeric>
              <span style={{ fontSize: 22, fontWeight: 500, opacity: 0.6 }}>of 32</span>
            </div>
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
            <QRBlock url="https://tr1via.com/join/K9PR4M" size={110} light />
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
                  K9·PR4M
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
                  <div style={{ fontSize: 11, color: t.inkMid, marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <TVFooter
        left="TR1VIA.COM · K9·PR4M · ROOM STILL OPEN"
        right="LINDA STARTS GAME 2 WHEN ENOUGH ARE IN"
      />
    </TVStage>
  );
}
