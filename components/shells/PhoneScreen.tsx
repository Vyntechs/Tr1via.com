// Full-height phone container with the active theme's weather layered
// behind. Most player + host-phone screens nest inside this.
//
// `fill={true}` is used for high-energy reveal screens that paint the whole
// background with the accent color (and switch ink contrast accordingly);
// in that mode weather is suppressed so it doesn't compete.
//
// Padding is `base + env(safe-area-inset-*)` on every edge, not `max(base,
// inset)`. The player group renders with `viewport-fit=cover`, so on an
// edge-to-edge Android (gesture nav bar) or a notched iPhone the inset is
// screen furniture that sits ON TOP of our padding — it has to be added to
// the breathing room, not swallow it. Insets resolve to 0px everywhere else,
// which makes this a no-op on the host phone and the dev gallery.

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
  /**
   * `"auto"` — no scrollbar while the screen fits, a scroll escape hatch the
   * moment it doesn't. This is the right default for anything the player must
   * be able to reach.
   * `"locked"` — hard `overflow: hidden`. Only for screens with no required
   * interaction below the fold; a locked screen that overflows is content the
   * player can never get to (issue #171).
   */
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
        paddingTop: "calc(14px + env(safe-area-inset-top))",
        paddingRight: "calc(22px + env(safe-area-inset-right))",
        paddingBottom: "calc(26px + env(safe-area-inset-bottom))",
        paddingLeft: "calc(22px + env(safe-area-inset-left))",
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
      {weather && !fill && (
        <Weather themeKey={themeKey} intensity={weatherIntensity} compact />
      )}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}
