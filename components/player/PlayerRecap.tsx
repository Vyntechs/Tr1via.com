// Player phone — RECAP (everyone else).
// Warm personal recap for the non-winners. No leaderboard pressure — stats
// are private to this player. Closes with a "next Wednesday" reminder and a
// soft "suggest a topic" CTA to keep the room engaged between nights.

"use client";

import {
  useTheme,
  Display,
  Eyebrow,
  Numeric,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerRecapProps {
  themeKey?: ThemeKey;
}

export function PlayerRecap({ themeKey: _themeKey }: PlayerRecapProps = {}) {
  const { t } = useTheme();
  const stats: { l: string; v: string; color: string }[] = [
    { l: "GOT RIGHT",      v: "28 / 42",      color: t.correct },
    { l: "BEST CATEGORY",  v: "Music · 7/7",  color: categoryColor("Music", t.accent) },
    { l: "FASTEST ANSWER", v: "1.4s · Pixar", color: t.pop },
    { l: "LONGEST STREAK", v: "× 4",          color: t.accent },
  ];

  return (
    <PhoneScreen>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6 }}>
        <Eyebrow color={t.inkMid} size={10}>YOUR NIGHT · SOUL FIRE</Eyebrow>
        <Eyebrow color={t.inkMute} size={10}>MAY 27</Eyebrow>
      </div>

      <Display
        size={56}
        color={t.ink}
        style={{ marginTop: 16, display: "block" }}
        tracking={-0.03}
      >
        Wrapped.
        <br />
        You finished <span style={{ color: t.accent }}>#7</span>.
      </Display>

      <div style={{ marginTop: 22, padding: "18px 22px", borderRadius: 16, background: t.surface }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <Eyebrow color={t.inkMid} size={10}>YOUR SCORE</Eyebrow>
          <Numeric size={42} weight={700} color={t.ink} tracking={-0.03}>5,360</Numeric>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: `1px solid ${t.line}`,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.l}
              style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}
            >
              <Eyebrow color={t.inkMid} size={9}>{s.l}</Eyebrow>
              <Numeric size={15} weight={700} color={s.color}>{s.v}</Numeric>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 12, border: `1px dashed ${t.line}` }}>
        <Eyebrow color={t.inkMute} size={10}>STAYED IN THE TOP TEN ALL NIGHT</Eyebrow>
        <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid, lineHeight: 1.45 }}>
          You climbed from #11 to #7 over the second game. The biggest jump was after Music.
        </div>
      </div>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, paddingTop: 12 }}>
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: t.accent,
            color: "#0E0805",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 6L8 2L14 6V13C14 13.55 13.55 14 13 14H3C2.45 14 2 13.55 2 13V6Z"
              stroke="#0E0805"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Next Wednesday · 7:00</div>
            <div style={{ fontSize: 11, color: "rgba(14,8,5,.65)", fontWeight: 500 }}>
              Same place, fresh board.
            </div>
          </div>
        </div>
        <button
          type="button"
          style={{
            background: "transparent",
            color: t.ink,
            border: `1px solid ${t.line}`,
            borderRadius: 14,
            padding: "12px 0",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          Suggest a topic for next week
        </button>
      </div>
    </PhoneScreen>
  );
}
