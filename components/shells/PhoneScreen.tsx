// Full-height phone container with the active theme's weather layered
// behind. Most player + host-phone screens nest inside this.
//
// `fill={true}` is used for high-energy reveal screens that paint the whole
// background with the accent color (and switch ink contrast accordingly);
// in that mode weather is suppressed so it doesn't compete.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { Weather } from "@/components/system/Weather";

export interface PhoneScreenProps {
  children: ReactNode;
  /** Paint the whole background with `accent` (or a passed color) instead of
   *  paper. Used by the correct-answer takeover screen. */
  fill?: boolean;
  /** Color override when fill=true (defaults to current theme accent). */
  fillColor?: string;
  weather?: boolean;
  /** Weather intensity 0-2.2 (>1 for the finale). */
  weatherIntensity?: number;
  style?: CSSProperties;
}

export function PhoneScreen({
  children,
  fill = false,
  fillColor,
  weather = true,
  weatherIntensity = 0.5,
  style,
}: PhoneScreenProps) {
  const { t, themeKey } = useTheme();
  const bg = fill ? fillColor ?? t.accent : t.paper;
  const fg = fill ? (t.dark ? "#0E0805" : t.paper) : t.ink;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: bg,
        color: fg,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        padding: "14px 22px 26px",
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      {weather && !fill && <Weather themeKey={themeKey} intensity={weatherIntensity} />}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
