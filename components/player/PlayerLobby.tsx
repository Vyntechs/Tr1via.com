// Player phone — LOBBY.
// After joining, before the host starts. Personal greeting + room population
// count + newest joiners list. Bottom strip shows "host is setting up" with a
// pulsing dot so it feels like a real live room.

"use client";

import { useTheme, Display, Eyebrow } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerLobbyProps {
  themeKey?: ThemeKey;
  /** This player's display name — shown in the headline. */
  playerName?: string;
  /** Total players currently in the room. */
  inRoomCount?: number;
  /**
   * Newest joiners (display strings). First entry is rendered as "you" — the
   * caller can suffix " · you" on the player's own row before passing in.
   */
  newestNames?: string[];
  /** Host's first name — used in the "Linda is setting up" strip. */
  hostName?: string;
  /** Venue name (currently unused inline but kept for parity / future copy). */
  venueName?: string;
}

export function PlayerLobby({
  themeKey: _themeKey,
  playerName = "Maya",
  inRoomCount = 27,
  newestNames = ["Maya · you", "Cole", "Theo", "Devon", "Marcus"],
  hostName = "Linda",
  venueName: _venueName,
}: PlayerLobbyProps = {}) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="IN THE ROOM" />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 18 }}>
        <Display size={64} color={t.ink}>
          You&apos;re in,
          <br />
          <span style={{ color: t.accent }}>{playerName}.</span>
        </Display>
        <div style={{ marginTop: 14, color: t.inkMid, fontSize: 15, lineHeight: 1.45, maxWidth: 280 }}>
          {hostName} will start the first game when the room is settled.
        </div>

        <div style={{ marginTop: 38 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 18,
              padding: "20px 0",
              borderTop: `1px solid ${t.line}`,
              borderBottom: `1px solid ${t.line}`,
            }}
          >
            <div style={{ flex: 1 }}>
              <Eyebrow color={t.inkMid} size={10}>IN THE ROOM</Eyebrow>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: t.pop,
                  fontSize: 56,
                  letterSpacing: "-0.04em",
                  lineHeight: 1,
                }}
              >
                {inRoomCount}
              </div>
            </div>
            <div style={{ flex: 1.4, paddingBottom: 8 }}>
              <Eyebrow color={t.inkMid} size={10}>NEWEST</Eyebrow>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {newestNames.map((n, i) => (
                  <span
                    key={`${n}-${i}`}
                    style={{
                      fontSize: 14,
                      fontWeight: i === 0 ? 700 : 500,
                      color: i === 0 ? t.accent : t.ink,
                      opacity: 1 - i * 0.12,
                    }}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "auto",
            padding: "20px 22px",
            borderRadius: 14,
            background: t.surface,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: t.pop,
              animation: "tr1via-pulse 1.8s ease-in-out infinite",
            }}
          />
          <span style={{ color: t.ink, fontSize: 14, fontWeight: 500 }}>{hostName} is setting up.</span>
        </div>
      </div>
    </PhoneScreen>
  );
}
