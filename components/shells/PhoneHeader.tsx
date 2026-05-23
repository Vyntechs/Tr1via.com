// Standard player-phone header strip: a category/status eyebrow on the left,
// optional streak/position/score chips on the right. Sits at the top of
// every in-game phone screen.

"use client";

import { useTheme } from "@/components/system/ThemeProvider";
import { Eyebrow } from "@/components/system/Eyebrow";
import { Numeric } from "@/components/system/Numeric";

export interface PhoneHeaderProps {
  eyebrow: string;
  eyebrowColor?: string;
  score?: number;
  position?: string;
  streak?: number;
}

export function PhoneHeader({ eyebrow, eyebrowColor, score, position, streak }: PhoneHeaderProps) {
  const { t } = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4, paddingBottom: 14 }}>
      <Eyebrow color={eyebrowColor ?? t.inkMid} size={10}>
        {eyebrow}
      </Eyebrow>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {streak != null && streak > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 99,
              background: t.correct,
              color: t.dark ? "#0E0805" : "#fff",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            ×{streak}
          </span>
        )}
        {position && (
          <Eyebrow color={t.inkMid} size={10}>
            {position}
          </Eyebrow>
        )}
        {score != null && (
          <Numeric size={14} weight={600} color={t.ink}>
            {score.toLocaleString()}
          </Numeric>
        )}
      </div>
    </div>
  );
}
