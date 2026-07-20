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
  WelcomeOverlay,
} from "@/components/system";
import { colorHexFromKey, playerColorHex } from "@/lib/player/playerColor";
import type { ThemeKey } from "@/lib/theme/tokens";
import { TVLobbyTopics } from "./TVLobbyTopics";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

export interface TVLobbyWelcomeEvent {
  /** Ephemeral identity for this join event — also the React key. */
  joinToken: string;
  /** Display name to render on the slide-in tile. */
  name: string;
  /** Hex color for the tile + dot. Either passed in directly OR derived
   *  from `colorKey` if absent. */
  color?: string;
  /** Optional palette index; preferred when `color` is omitted so all
   *  surfaces agree without re-hashing. */
  colorKey?: number;
  /** 1-based index of where this player landed in the night's join order.
   *  Joins 1..5 get the sparkle trail ("Pixar hero entrance"); 6+ get
   *  just the slide so the lobby breathes as it fills. */
  joinIndex: number;
  /** Honor reduced-motion (the parent already feature-detects). */
  prefersReducedMotion?: boolean;
}

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
  /** Optional player ids matched 1:1 with `roster` — when provided, the
   *  most-recent entry can be tinted with the player's color (the rest
   *  fall back to theme colors). */
  rosterPlayerIds?: string[];
  /** Full URL the QR encodes — usually `${SITE_URL}/join?code=K9PR4M`. */
  joinUrl?: string;
  /** Footer copy: who's running this and what game is next. */
  hostStatusLine?: string;
  /** Game N of M, header right side. */
  gameStatusLine?: string;
  /** Optional "someone just joined" event. When set, the slide-in welcome
   *  overlay renders on top of the lobby. The parent owns the lifecycle
   *  — pass a new object (new key) to trigger a new welcome moment;
   *  pass `null` to hide it. */
  welcomeEvent?: TVLobbyWelcomeEvent | null;
  /** Upcoming game's ready topics for the "Tonight's Topics" panel. Empty or
   *  omitted → the panel is hidden and the screen looks as it did before. */
  topics?: LobbyTopic[];
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

export const DEMO_ROSTER: string[] = [
  "Maya", "Cole", "Theo", "Devon", "Marcus", "Priya", "Sara", "Eli", "Ana",
  "June", "Lex", "Otis", "Sam", "Iris", "Ren", "Kai", "Nadia", "Jules",
  "Ezra", "Mira", "Hank", "Reza", "Tess", "Vee", "Yumi", "Quinn", "Wren",
];

function TVLobbyInner({
  venueName = "",
  scheduledDate = "",
  roomCode = "",
  inRoomCount = 0,
  roster = [],
  rosterPlayerIds,
  joinUrl = "",
  hostStatusLine = "GAME OPEN · STARTS WHEN HOST IS READY",
  gameStatusLine = "GAME 1 OF 2 · WAITING",
  welcomeEvent = null,
  topics = [],
}: Omit<TVLobbyProps, "themeKey">) {
  const { t } = useTheme();

  // Per-player color for the front-most roster entry — the just-joined name
  // glows in the player's hex instead of the theme accent so the welcome
  // tile and the roster row read as the same person.
  const headlinePlayerId = rosterPlayerIds?.[0] ?? null;
  const headlineColor = headlinePlayerId ? playerColorHex(headlinePlayerId) : t.accent;

  return (
    <TVStage data-testid="tv-lobby">
      <TVHeader
        left={`${venueName} · ${scheduledDate}`}
        right={gameStatusLine}
      />

      <div
        style={{
          flex: 1,
          // minHeight:0 + a 1fr row bound the grid to the panel so the row
          // can't balloon to its tallest column and spill the bottom topics
          // off-screen (the laptop-console clip Brandon hit 2026-06-07). The
          // venue TV has the height to show everything; the host laptop +
          // control strip do not, so the content has to fit, not overflow.
          minHeight: 0,
          // Padding scales with viewport so a 13" laptop doesn't lose 80px
          // of vertical to fixed top/bottom gutters.
          padding: "clamp(4px, 1vh, 28px) 56px clamp(4px, 1vh, 12px)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "minmax(0, 1fr)",
          gap: 56,
          // `safe center` keeps the balanced vertical centering on a tall
          // venue TV, but falls back to top-anchored when the column is
          // taller than the panel — so a tight laptop clips the *last* topic
          // at worst, never the headline or the first topics.
          alignItems: "safe center",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div>
          <Display
            // Headline scales with viewport height. The 3-line stack at
            // lineHeight 0.92 multiplies the font size by ~2.76, so the
            // viewport-relative term has to leave room for the rest of the
            // column (instructional text + tr1via.com/room-code block + the
            // "Tonight's Topics" list) AND the host control strip + LaptopShell
            // chrome that consume the viewport outside TVStage. 10vh keeps the
            // 3 lines + a full 6-topic list above the fold at ~590px usable
            // height (the host laptop console); on a true venue TV the hero is
            // still ~270px tall. 180px ceiling caps it on huge displays.
            size="clamp(60px, 9vh, 180px)"
            color={t.ink}
            weight={700}
            tracking={-0.05}
          >
            Scan,<br />
            <span style={{ color: t.accent }}>play,</span><br />
            <span style={{ color: t.pop }}>win.</span>
          </Display>

          <div style={{ marginTop: "clamp(8px, 1.4vh, 28px)", fontSize: "clamp(16px, 2vh, 22px)", color: t.inkMid, lineHeight: 1.4, maxWidth: 580 }}>
            Open your camera, point at the code, pick a name. You&apos;re in the game in under ten seconds.
          </div>

          <div style={{ marginTop: "clamp(12px, 2vh, 44px)", display: "flex", gap: 36, alignItems: "flex-start" }}>
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
              <Eyebrow color={t.inkMute} size={11}>GAME CODE</Eyebrow>
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

          <TVLobbyTopics topics={topics} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              marginBottom: 12,
              color: t.ink,
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Players — scan to join this game
          </div>
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
              // The QR is the door into the room — it's the hero on the
              // wall-sized venue TV. 40vh makes it the dominant element (288px
              // on a 720p TV, 432px on 1080p); the 240px floor guarantees
              // back-table scannability even on a short host laptop.
              size="clamp(240px, 40vh, 460px)"
              light
            />
          </div>

          <div
            style={{
              marginTop: "clamp(10px, 1.4vh, 20px)",
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
            <span style={{ fontSize: 14, color: "#0E0805", fontWeight: 600 }}>players joined</span>
          </div>

          <div style={{ marginTop: "clamp(12px, 1.8vh, 28px)", width: "100%", maxWidth: 420 }}>
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
                    color:
                      i === 0
                        ? headlineColor
                        : i < 3
                          ? t.ink
                          : t.inkMid,
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

      {welcomeEvent ? (
        <WelcomeOverlay
          /* The key forces a fresh mount each time a new player joins so
             the entrance animation replays from frame 0 — without it,
             back-to-back joins would skip the slide and just flash. */
          key={welcomeEvent.joinToken}
          name={welcomeEvent.name}
          color={
            welcomeEvent.color ??
            (welcomeEvent.colorKey !== undefined
              ? colorHexFromKey(welcomeEvent.colorKey)
              : playerColorHex(welcomeEvent.joinToken))
          }
          isHeroEntrance={welcomeEvent.joinIndex <= 5}
          prefersReducedMotion={welcomeEvent.prefersReducedMotion}
          joinToken={welcomeEvent.joinToken}
        />
      ) : null}
    </TVStage>
  );
}
