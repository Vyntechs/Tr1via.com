// Bottom strip of the venue TV: pulsing accent dot + left-eyebrow on the
// left, right-eyebrow on the right (usually "TR1VIA.COM · K9·PR4M").

"use client";

import { useTheme } from "@/components/system/ThemeProvider";
import { Eyebrow } from "@/components/system/Eyebrow";

export interface TVFooterProps {
  left: string;
  right?: string;
  accent?: string;
}

export function TVFooter({ left, right, accent }: TVFooterProps) {
  const { t } = useTheme();
  return (
    <div
      style={{
        padding: "0 56px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "relative",
        zIndex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: accent ?? t.pop,
            animation: "tr1via-pulse 1.6s ease-in-out infinite",
          }}
        />
        <Eyebrow color={t.inkMid} size={10}>
          {left}
        </Eyebrow>
      </div>
      {right && (
        <Eyebrow color={t.inkMute} size={10}>
          {right}
        </Eyebrow>
      )}
    </div>
  );
}
