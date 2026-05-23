// Player phone — JOIN.
// First-touch screen. Saturated category color drives the screen; a warm
// Display headline introduces the night. Name field below the fold (caret
// pulses so the player knows it's editable), CTA pinned to the bottom.

"use client";

import {
  useTheme,
  Wordmark,
  Display,
  Eyebrow,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerJoinProps {
  themeKey?: ThemeKey;
}

export function PlayerJoin({ themeKey: _themeKey }: PlayerJoinProps = {}) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="JOINING · SOUL FIRE" />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingTop: 24 }}>
        <Wordmark size={36} />
        <div style={{ marginTop: 28 }}>
          <Display size={56} color={t.ink}>
            <span style={{ color: t.accent }}>Pizza,</span>
            <br />
            <span style={{ color: t.ink }}>beer,</span>
            <br />
            <span style={{ color: t.pop }}>
              bragging
              <br />
              rights.
            </span>
          </Display>
        </div>
        <div style={{ marginTop: 18, color: t.inkMid, fontSize: 14.5, lineHeight: 1.45, maxWidth: 280 }}>
          Wednesday trivia at Soul Fire Pizza, hosted by Linda. Pick a name and you&apos;re in the room.
        </div>

        <div style={{ marginTop: 36 }}>
          <Eyebrow color={t.inkMid} size={10}>YOUR NAME FOR THE NIGHT</Eyebrow>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              borderBottom: `2px solid ${t.accent}`,
              paddingBottom: 12,
            }}
          >
            <span style={{ fontSize: 34, fontWeight: 600, color: t.ink, letterSpacing: "-0.025em", flex: 1 }}>Maya</span>
            <span
              style={{
                width: 3,
                height: 30,
                background: t.accent,
                animation: "tr1via-caret 1s steps(2) infinite",
              }}
            />
          </div>
          <div style={{ marginTop: 10, color: t.inkMute, fontSize: 12 }}>Everyone sees this. Keep it kind.</div>
        </div>
      </div>

      <button
        type="button"
        style={{
          marginTop: "auto",
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "20px 0",
          fontSize: 17,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          letterSpacing: "-0.005em",
          cursor: "pointer",
          boxShadow: `0 14px 30px -10px ${t.accent}66`,
        }}
      >
        Join the room  &rarr;
      </button>
    </PhoneScreen>
  );
}
