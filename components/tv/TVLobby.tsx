// TV — pre-game lobby. Hero display headline. Live roster, scan-to-join QR,
// in-the-room counter. The first thing a venue TV shows when the host opens
// the room — visible across the bar from any seat.

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

export interface TVLobbyProps {
  themeKey?: ThemeKey;
}

export function TVLobby({ themeKey }: TVLobbyProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVLobbyInner />
      </ThemeProvider>
    );
  }
  return <TVLobbyInner />;
}

function TVLobbyInner() {
  const { t } = useTheme();
  const roster = [
    "Maya", "Cole", "Theo", "Devon", "Marcus", "Priya", "Sara", "Eli", "Ana",
    "June", "Lex", "Otis", "Sam", "Iris", "Ren", "Kai", "Nadia", "Jules",
    "Ezra", "Mira", "Hank", "Reza", "Tess", "Vee", "Yumi", "Quinn", "Wren",
  ];

  return (
    <TVStage>
      <TVHeader left="SOUL FIRE PIZZA · WED MAY 27" right="GAME 1 OF 2 · WAITING" />

      <div
        style={{
          flex: 1,
          padding: "36px 56px 16px",
          display: "grid",
          gridTemplateColumns: "1.25fr 1fr",
          gap: 56,
          alignItems: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <Display size={188} color={t.ink} weight={700} tracking={-0.05}>
            Scan,<br />
            <span style={{ color: t.accent }}>play,</span><br />
            <span style={{ color: t.pop }}>win.</span>
          </Display>

          <div style={{ marginTop: 28, fontSize: 22, color: t.inkMid, lineHeight: 1.4, maxWidth: 580 }}>
            Open your camera, point at the code, pick a name. You&apos;re in the room in under ten seconds.
          </div>

          <div style={{ marginTop: 44, display: "flex", gap: 36, alignItems: "flex-start" }}>
            <div>
              <Eyebrow color={t.inkMute} size={11}>OR ON YOUR PHONE</Eyebrow>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  fontSize: 30,
                  color: t.ink,
                  letterSpacing: "-0.015em",
                }}
              >
                tr1via.com
              </div>
            </div>
            <div>
              <Eyebrow color={t.inkMute} size={11}>ROOM CODE</Eyebrow>
              <div
                style={{
                  marginTop: 8,
                  padding: "6px 14px",
                  borderRadius: 8,
                  background: t.accent,
                  color: "#0E0805",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 30,
                  letterSpacing: "0.05em",
                  display: "inline-block",
                }}
              >
                K9·PR4M
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              padding: 16,
              borderRadius: 24,
              background: t.surface,
              border: `1px solid ${t.line}`,
            }}
          >
            <QRBlock url="https://tr1via.com/join/K9PR4M" size={300} light />
          </div>

          <div
            style={{
              marginTop: 20,
              padding: "14px 22px",
              borderRadius: 99,
              background: t.pop,
              color: "#0E0805",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 99,
                background: "#0E0805",
                animation: "tr1via-pulse 1.6s ease-in-out infinite",
              }}
            />
            <Numeric size={22} weight={700} color="#0E0805" tracking={-0.02}>27</Numeric>
            <span style={{ fontSize: 14, color: "#0E0805", fontWeight: 600 }}>in the room</span>
          </div>

          <div style={{ marginTop: 28, width: "100%", maxWidth: 420 }}>
            <Eyebrow color={t.inkMute} size={10}>JUST JOINED</Eyebrow>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
              {roster.map((n, i) => (
                <span
                  key={n}
                  style={{
                    fontSize: 15,
                    fontWeight: i < 3 ? 700 : 500,
                    color: i < 3 ? (i === 0 ? t.accent : t.ink) : t.inkMid,
                    opacity: i < 8 ? 1 : 0.7 - (i / roster.length) * 0.4,
                    animation: i < 3
                      ? `tr1via-tick .6s cubic-bezier(.2,.7,.3,1) ${i * 0.08}s both`
                      : "none",
                  }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <TVFooter left="ROOM OPEN · LINDA WILL START WHEN READY" right="TR1VIA.COM · K9·PR4M" />
    </TVStage>
  );
}
