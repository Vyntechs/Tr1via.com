// Internal venue-TV gallery. Browse every TV screen at its native 1280×720
// (16:9) aspect with a theme picker. Each component renders inside a fixed
// frame so the gallery preview matches the venue surface.
//
// Visit at /dev/tv in dev.

"use client";

import {
  TVLobby,
  DEMO_ROSTER,
  TVGrid,
  DEMO_CATEGORIES,
  DEMO_VALUES,
  TVQuestion,
  TVReveal,
  DEMO_FASTEST,
  TVLeaderboard,
  DEMO_ROWS,
  TVIntermission,
  demoPodium,
  DEMO_INTERMISSION_STATS,
  TVRevealStumper,
  TVSectionComplete,
  TVFinaleWinner,
  DEMO_WINNER,
  DEMO_PODIUM,
  DEMO_STATS,
} from "@/components/tv";
import { resolveTheme } from "@/lib/theme/resolve";
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
            <TVLobby
              venueName="SOUL FIRE PIZZA"
              scheduledDate="WED MAY 27"
              roomCode="K9·PR4M"
              inRoomCount={27}
              roster={DEMO_ROSTER}
              joinUrl="https://tr1via.com/join/K9PR4M"
              hostStatusLine="ROOM OPEN · LINDA WILL START WHEN READY"
              gameStatusLine="GAME 1 OF 2 · WAITING"
            />
          </Frame>
          <Frame label="02 · Grid">
            <TVGrid
              gameStatusLine="GAME 1 · ROUND 3 · 32 PLAYERS"
              rightHeaderLine="10 OF 42 ANSWERED"
              categories={DEMO_CATEGORIES}
              values={DEMO_VALUES}
              leader={{ name: "Devon", score: 2140 }}
              boardLeft={32}
              footerLeft="WAITING ON LINDA"
              footerRight="TR1VIA.COM · K9·PR4M"
              upNext={{ category: "Food", value: 300, sub: "standing by to reveal" }}
            />
          </Frame>
          <Frame label="03 · Question">
            <TVQuestion />
          </Frame>
          <Frame label="04 · Reveal · correct">
            <TVReveal
              headerEyebrow="GAME 1 · GEOGRAPHY · 100 PTS"
              question="Which U.S. state has the\nlongest coastline?"
              correctNumber={2}
              correctText="Alaska"
              fact="33,904 miles of tidal coastline — more than all other states combined."
              gotIt={23}
              ofTotal={32}
              fastest="1.2s"
              speedBonus="+10"
              fastestFive={DEMO_FASTEST}
            />
          </Frame>
          <Frame label="05 · Reveal · stumper">
            <TVRevealStumper />
          </Frame>
          <Frame label="06 · Leaderboard">
            <TVLeaderboard
              headerLeft="GAME 1 · END OF ROUND 3"
              headerRight="32 PLAYERS · 8 OF 42 ANSWERED"
              footerLeft="LINDA IS LOADING ROUND 4"
              footerRight="34 QUESTIONS LEFT"
              rows={DEMO_ROWS}
            />
          </Frame>
          <Frame label="07 · Section complete · cinematic over the grid">
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                background: "#0E0805",
              }}
            >
              <TVGrid
                gameStatusLine="GAME 1 · ROUND 3 · 32 PLAYERS"
                rightHeaderLine="10 OF 42 ANSWERED"
                categories={DEMO_CATEGORIES}
                values={DEMO_VALUES}
                leader={{ name: "Devon", score: 2140 }}
              />
              <TVSectionComplete
                topicName="Martial Arts"
                color="#FF6A3D"
                staticHold
              />
            </div>
          </Frame>
          <Frame label="08 · Intermission">
            <TVIntermission
              footerLeft="TR1VIA.COM · K9·PR4M · ROOM STILL OPEN"
              roomCode="K9·PR4M"
              joinUrl="https://tr1via.com/join/K9PR4M"
              readyCount={24}
              totalCount={32}
              podium={demoPodium(resolveTheme(themeKey))}
              nightStats={DEMO_INTERMISSION_STATS}
            />
          </Frame>
          <Frame label="09 · Finale winner · heightened weather">
            <TVFinaleWinner
              headerEyebrow="SOUL FIRE PIZZA · WED MAY 27"
              winner={DEMO_WINNER}
              podium={DEMO_PODIUM}
              nightStats={DEMO_STATS}
            />
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
