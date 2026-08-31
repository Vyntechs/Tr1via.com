// Full-height phone container with the active theme's weather layered
// behind. Most player + host-phone screens nest inside this.
//
// `fill={true}` is used for high-energy reveal screens that paint the whole
// background with the accent color (and switch ink contrast accordingly);
// in that mode weather is suppressed so it doesn't compete.

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { Weather } from "@/components/system/Weather";
import { PHONE_LOGICAL_HEIGHT, fitPhoneStage } from "@/lib/player/fitPhoneStage";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Compose a scroll-locked screen on a fitted stage.
 *
 * `scroll="locked"` means this screen cannot scroll — a question under a timer
 * must never move under the player's thumb. That makes overflow fatal rather
 * than untidy: anything past the bottom edge is not below the fold, it is
 * untappable. A player on a small Android could not reach the third and fourth
 * answer cards at all.
 *
 * So a locked screen is composed against a fixed logical height and the whole
 * finished composition is scaled to the device, exactly as the venue TV does
 * with `fitTVCanvas`. Type and controls shrink together and keep their
 * relationships; nothing reflows, nothing is cropped, and no viewport is short
 * enough to push a control off a stage that is fitted to the viewport.
 *
 * Unlocked screens are untouched: they scroll, so overflow is merely more page.
 */
function FittedStage({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useIsomorphicLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = (width: number, height: number) =>
      setBox((cur) =>
        Math.abs(cur.width - width) < 0.5 && Math.abs(cur.height - height) < 0.5
          ? cur
          : { width, height },
      );
    const rect = frame.getBoundingClientRect();
    update(rect.width, rect.height);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) update(r.width, r.height);
    });
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  const fit = fitPhoneStage(box.width, box.height);

  return (
    <div
      ref={frameRef}
      data-testid="phone-stage-frame"
      style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}
    >
      <div
        data-testid="phone-stage"
        data-phone-stage-scale={fit.scale.toFixed(4)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: fit.width,
          height: fit.height,
          transform: `scale(${fit.scale})`,
          transformOrigin: "top left",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export { PHONE_LOGICAL_HEIGHT };

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
      {weather && !fill && (
        <Weather themeKey={themeKey} intensity={weatherIntensity} compact />
      )}
      {scroll === "locked" ? (
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <FittedStage>{children}</FittedStage>
        </div>
      ) : (
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
}
