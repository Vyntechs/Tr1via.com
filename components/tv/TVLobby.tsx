// TV — pre-game lobby. Hero display headline. Live roster, scan-to-join QR,
// in-the-room counter. The first thing a venue TV shows when the host opens
// the room — visible across the bar from any seat.
//
// Driven by props so the live `/tv/[code]` route can feed it real data; falls
// back to the demo strings so the `/dev/tv` gallery still renders cleanly.

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
  /** Venue name shown in the header, e.g. "SOUL FIRE PIZZA". */
  venueName?: string;
  /** Pre-formatted scheduled date, e.g. "WED MAY 27". */
  scheduledDate?: string;
  /** Pre-formatted room code with middle dot, e.g. "K9P·R4M". */
  roomCode?: string;
  /** Live "in the room" count (= number of joined players). */
  inRoomCount?: number;
  /** Player names ordered most-recent first (the front of the roster glows). */
  roster?: string[];
  /** Full URL the QR encodes — usually `${SITE_URL}/join?code=K9PR4M`. */
  joinUrl?: string;
  /** Footer copy: who's running this and what game is next. */
  hostStatusLine?: string;
  /** Game N of M, header right side. */
  gameStatusLine?: string;
}

export function TVLobby({ themeKey, ...rest }: TVLobbyProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVLobbyInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVLobbyInner {...rest} />;
}

const DEMO_ROSTER: string[] = [
  "Maya", "Cole", "Theo", "Devon", "Marcus", "Priya", "Sara", "Eli", "Ana",
  "June", "Lex", "Otis", "Sam", "Iris", "Ren", "Kai", "Nadia", "Jules",
  "Ezra", "Mira", "Hank", "Reza", "Tess", "Vee", "Yumi", "Quinn", "Wren",
];

function TVLobbyInner({
  venueName = "SOUL FIRE PIZZA",
  scheduledDate = "WED MAY 27",
  roomCode = "K9·PR4M",
  inRoomCount = 27,
  roster = DEMO_ROSTER,
  joinUrl = "https://tr1via.com/join/K9PR4M",
  hostStatusLine = "ROOM OPEN · LINDA WILL START WHEN READY",
  gameStatusLine = "GAME 1 OF 2 · WAITING",
}: Omit<TVLobbyProps, "themeKey">) {
  const { t } = useTheme();

  return (
    <TVStage data-testid="tv-lobby">
      <TVHeader
        left={`${venueName} · ${scheduledDate}`}
        right={gameStatusLine}
      />

      <div
        style={{
          flex: 1,
          // Padding scales with viewport so a 13" laptop doesn't lose 80px
          // of vertical to fixed top/bottom gutters.
          padding: "clamp(8px, 2vh, 28px) 56px clamp(4px, 1vh, 12px)",
          display: "grid",
          gridTemplateColumns: "1.25fr 1fr",
          gap: 56,
          alignItems: "center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <Display
            // Headline scales with viewport height. The 3-line stack at
            // lineHeight 0.92 multiplies the font size by ~2.76, so the
            // viewport-relative term has to leave room for the rest of the
            // column (instructional text + tr1via.com/room-code block) AND
            // the host control strip + LaptopShell chrome that consume the
            // viewport outside TVStage. 14vh keeps the 3 lines comfortably
            // above the fold down to ~700px usable height. Original 188px
            // is preserved as the ceiling for ≥1340px viewports (real TVs
            // and external displays the venue would normally use).
            size="clamp(72px, 14vh, 188px)"
            color={t.ink}
            weight={700}
            tracking={-0.05}
          >
            Scan,<br />
            <span style={{ color: t.accent }}>play,</span><br />
            <span style={{ color: t.pop }}>win.</span>
          </Display>

          <div style={{ marginTop: "clamp(10px, 2vh, 28px)", fontSize: 22, color: t.inkMid, lineHeight: 1.4, maxWidth: 580 }}>
            Open your camera, point at the code, pick a name. You&apos;re in the room in under ten seconds.
          </div>

          <div style={{ marginTop: "clamp(16px, 3vh, 44px)", display: "flex", gap: 36, alignItems: "flex-start" }}>
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
                data-testid="tv-lobby-room-code"
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
                {roomCode}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            data-testid="tv-lobby-qr"
            style={{
              padding: 16,
              borderRadius: 24,
              background: t.surface,
              border: `1px solid ${t.line}`,
            }}
          >
            <QRBlock
              url={joinUrl}
              // QR scales with viewport but never drops below 160px —
              // scannable from across a small bar room even at the floor.
              size="clamp(160px, 25vh, 300px)"
              light
            />
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
            <Numeric size={22} weight={700} color="#0E0805" tracking={-0.02}>
              {inRoomCount}
            </Numeric>
            <span style={{ fontSize: 14, color: "#0E0805", fontWeight: 600 }}>in the room</span>
          </div>

          <div style={{ marginTop: 28, width: "100%", maxWidth: 420 }}>
            <Eyebrow color={t.inkMute} size={10}>JUST JOINED</Eyebrow>
            <div
              data-testid="tv-lobby-roster"
              style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: "8px 14px" }}
            >
              {roster.map((n, i) => (
                <span
                  key={`${n}-${i}`}
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

      <TVFooter left={hostStatusLine} right={`TR1VIA.COM · ${roomCode}`} />
    </TVStage>
  );
}
