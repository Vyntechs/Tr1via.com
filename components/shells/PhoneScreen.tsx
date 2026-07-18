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
  /** Dense states scroll on short phones; timed question input stays locked. */
  scroll?: "auto" | "locked";
  style?: CSSProperties;
  /** Forwarded data-testid for E2E tests. Applied to the outer container so
   *  Playwright can target any phone screen by its top-level id. */
  "data-testid"?: string;
}

export function PhoneScreen({
  children,
  fill = false,
  fillColor,
  weather = true,
  weatherIntensity = 0.5,
  scroll = "auto",
  style,
  "data-testid": dataTestId,
}: PhoneScreenProps) {
  const { t, themeKey } = useTheme();
  const bg = fill ? fillColor ?? t.accent : t.paper;
  const fg = fill ? (t.dark ? "#0E0805" : t.paper) : t.ink;
  return (
    <div
      data-testid={dataTestId}
      style={{
        width: "100%",
        height: "100%",
        // Grow to fill a flex-column parent (the player layout) so short
        // screens still cover the viewport. height:100% alone doesn't resolve
        // through a min-height-only chain; flexGrow does. Harmless in fixed-
        // size embeds (dev gallery / host-phone), where it's simply ignored.
        flexGrow: 1,
        minHeight: 0,
        background: bg,
        color: fg,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        paddingTop: 14,
        paddingRight: 22,
        paddingBottom: "max(26px, env(safe-area-inset-bottom))",
        paddingLeft: 22,
        boxSizing: "border-box",
        overflowX: "hidden",
        overflowY: scroll === "auto" ? "auto" : "hidden",
        overscrollBehaviorY: scroll === "auto" ? "contain" : "none",
        WebkitOverflowScrolling: scroll === "auto" ? "touch" : undefined,
        position: "relative",
        // Player typography can size against the actual phone surface (cqw),
        // not the browser/TV viewport that happens to contain it.
        containerType: "inline-size",
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
