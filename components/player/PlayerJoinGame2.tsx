// Player phone — JOIN GAME 2.
// Between games. Hero moment for re-entry. Big "Wrapped." headline with the
// player's final placement + score card (best category, fastest answer), then
// a one-tap CTA. Name is already in — frictionless re-entry.

"use client";

import {
  useTheme,
  Display,
  Eyebrow,
  Numeric,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerJoinGame2Props {
  themeKey?: ThemeKey;
}

export function PlayerJoinGame2({ themeKey: _themeKey }: PlayerJoinGame2Props = {}) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="GAME 1 · FINAL" />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 18 }}>
        <Display size={56} color={t.ink}>
          Wrapped.
          <br />
          You finished <span style={{ color: t.pop }}>#5</span>.
        </Display>

        <div style={{ marginTop: 20, padding: "20px 22px", borderRadius: 14, background: t.surface }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Eyebrow color={t.inkMid} size={10}>YOUR SCORE</Eyebrow>
            <Numeric size={36} weight={700} color={t.ink}>4,820</Numeric>
          </div>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <Eyebrow color={t.inkMid} size={9}>BEST CATEGORY</Eyebrow>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 14,
                  fontWeight: 600,
                  color: categoryColor("Music"),
                  letterSpacing: "-0.005em",
                }}
              >
                Music · 7/7
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <Eyebrow color={t.inkMid} size={9}>FASTEST</Eyebrow>
              <div style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: t.ink }}>1.4s</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 26, fontSize: 14, color: t.inkMid, lineHeight: 1.5 }}>
          Game 2 starts fresh — everyone back to zero. Same room, new board.{" "}
          <span style={{ color: t.ink, fontWeight: 600 }}>Your name is already in.</span>
        </div>
      </div>

      <button
        type="button"
        style={{
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "22px 0",
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          boxShadow: `0 14px 32px -10px ${t.accent}66`,
        }}
      >
        Join Game 2  &rarr;
      </button>
      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: t.inkMute,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        ONE TAP · MAYA
      </div>
    </PhoneScreen>
  );
}
