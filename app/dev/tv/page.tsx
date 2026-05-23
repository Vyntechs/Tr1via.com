// Internal venue-TV gallery. Browse every TV screen at its native 1280×720
// (16:9) aspect with a theme picker. Each component renders inside a fixed
// frame so the gallery preview matches the venue surface.
//
// Visit at /dev/tv in dev.

"use client";

import {
  TVLobby,
  TVGrid,
  TVQuestion,
  TVReveal,
  TVLeaderboard,
  TVIntermission,
  TVRevealStumper,
  TVFinaleWinner,
} from "@/components/tv";
import { useTheme, Wordmark, Eyebrow } from "@/components/system";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import type { ReactNode } from "react";

export default function TVGallery() {
  const { themeKey, setThemeKey, t } = useTheme();

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 48px 96px",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 32,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <Wordmark size={36} />
            <Eyebrow color={t.inkMid} size={12}>VENUE TV · 1280×720</Eyebrow>
          </div>
          <select
            value={themeKey}
            onChange={(e) => setThemeKey(e.target.value as ThemeKey)}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${t.line}`,
              background: t.surface,
              color: t.ink,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {THEME_KEYS.map((k) => (
              <option key={k} value={k} style={{ background: t.paper, color: t.ink }}>
                {TR1VIA_THEMES[k].name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
          <Frame label="01 · Lobby">
            <TVLobby />
          </Frame>
          <Frame label="02 · Grid">
            <TVGrid />
          </Frame>
          <Frame label="03 · Question">
            <TVQuestion />
          </Frame>
          <Frame label="04 · Reveal · correct">
            <TVReveal />
          </Frame>
          <Frame label="05 · Reveal · stumper">
            <TVRevealStumper />
          </Frame>
          <Frame label="06 · Leaderboard">
            <TVLeaderboard />
          </Frame>
          <Frame label="07 · Intermission">
            <TVIntermission />
          </Frame>
          <Frame label="08 · Finale winner · heightened weather">
            <TVFinaleWinner />
          </Frame>
        </div>
      </div>
    </main>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <section>
      <Eyebrow color={t.inkMid} size={11} style={{ display: "block", marginBottom: 14 }}>
        {label}
      </Eyebrow>
      <div
        style={{
          width: 1280,
          height: 720,
          maxWidth: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${t.line}`,
          boxShadow: t.dark
            ? "0 24px 60px -28px rgba(0,0,0,.6)"
            : "0 24px 60px -28px rgba(0,0,0,.18)",
        }}
      >
        {children}
      </div>
    </section>
  );
}
