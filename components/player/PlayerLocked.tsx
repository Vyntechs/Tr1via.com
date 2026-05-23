// Player phone — LOCKED.
// After the player picks. Same category banner + timer (still counting down
// for everyone else) + the four answer cards in mixed states. Self pick is
// scaled & glowing; siblings fade. Bottom shows quiet "waiting on the room"
// status with a pulse dot so it doesn't feel frozen.

"use client";

import {
  useTheme,
  Eyebrow,
  PointTag,
  Numeric,
  AnswerCard,
  TimerRing,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerLockedProps {
  themeKey?: ThemeKey;
  category?: string;
  value?: number;
}

export function PlayerLocked({
  themeKey: _themeKey,
  category = "Geography",
  value = 100,
}: PlayerLockedProps = {}) {
  const { t } = useTheme();
  const catColor = categoryColor(category, t.accent);
  return (
    <PhoneScreen>
      <div
        style={{
          margin: "-14px -22px 18px",
          padding: "14px 22px",
          background: catColor,
          color: "#0E0805",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Eyebrow color="rgba(14,8,5,.65)" size={10}>QUESTION 10 · {category.toUpperCase()}</Eyebrow>
          <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{category}</div>
        </div>
        <PointTag value={value} color="#0E0805" ink={catColor} size="md" />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 10,
          background: t.surface,
          marginBottom: 16,
        }}
      >
        <TimerRing accent={catColor} seconds={11} />
        <div style={{ flex: 1 }}>
          <Eyebrow color={t.inkMid} size={9}>LOCKED AT</Eyebrow>
          <div style={{ marginTop: 2, fontSize: 14, color: t.ink, fontWeight: 600 }}>
            <Numeric size={15} color={catColor}>2.3s</Numeric>
            <span style={{ color: t.inkMid, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              · speed bonus locked in
            </span>
          </div>
        </div>
        <Numeric size={12} color={t.inkMid}>21/32</Numeric>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <AnswerCard accent={catColor} n={1} text="Florida" state="locked-other" />
        <AnswerCard accent={catColor} n={2} text="Alaska" state="locked-self" />
        <AnswerCard accent={catColor} n={3} text="California" state="locked-other" />
        <AnswerCard accent={catColor} n={4} text="Maine" state="locked-other" />
      </div>

      <div style={{ marginTop: "auto", paddingTop: 18, textAlign: "center", color: t.inkMid, fontSize: 13 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: catColor,
              animation: "tr1via-pulse 1.4s ease-in-out infinite",
            }}
          />
          Waiting for the room to lock in&hellip;
        </span>
      </div>
    </PhoneScreen>
  );
}
