// Top strip of the venue TV: TR1VIA wordmark, divider, left-eyebrow (game +
// round info), right-eyebrow (often "21 OF 32 LOCKED IN" or similar).

"use client";

import { useTheme } from "@/components/system/ThemeProvider";
import { Wordmark } from "@/components/system/Wordmark";
import { Eyebrow } from "@/components/system/Eyebrow";

export interface TVHeaderProps {
  left: string;
  right?: string;
  accent?: string;
}

export function TVHeader({ left, right, accent }: TVHeaderProps) {
  const { t } = useTheme();
  return (
    <div
      style={{
        padding: "32px 56px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Wordmark size={24} accent={accent ?? t.accent} ink={t.ink} />
        <span style={{ width: 1, height: 16, background: t.line }} />
        <Eyebrow color={t.inkMid} size={11}>
          {left}
        </Eyebrow>
      </div>
      {right && (
        <Eyebrow color={t.inkMid} size={11}>
          {right}
        </Eyebrow>
      )}
    </div>
  );
}
