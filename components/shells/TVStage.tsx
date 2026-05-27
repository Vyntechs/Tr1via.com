// 16:9 venue-TV stage. Layers the theme's weather behind, plus a subtle
// warm vignette. Children sit at z-index 1 so they always read above the
// ambient motion.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { Weather } from "@/components/system/Weather";

export interface TVStageProps {
  children: ReactNode;
  /** Override the background — used by TVReveal to paint the whole stage in
   *  the correct-color. */
  bg?: string;
  weather?: boolean;
  weatherIntensity?: number;
  /** Bump to fire a beat-triggered May lightning strike. Only meaningful
   *  on storm-themed nights; ignored by other themes. */
  lightningTriggerCount?: number;
  style?: CSSProperties;
  /** Forwarded data-testid for E2E tests. Applied to the outer container so
   *  Playwright can target any TV screen by its top-level id. */
  "data-testid"?: string;
}

export function TVStage({
  children,
  bg,
  weather = true,
  weatherIntensity = 1,
  lightningTriggerCount = 0,
  style,
  "data-testid": dataTestId,
}: TVStageProps) {
  const { t, themeKey } = useTheme();
  return (
    <div
      data-testid={dataTestId}
      style={{
        width: "100%",
        height: "100%",
        background: bg ?? t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {weather && (
        <Weather
          themeKey={themeKey}
          intensity={weatherIntensity}
          lightningTriggerCount={lightningTriggerCount}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: t.dark
            ? "radial-gradient(90% 60% at 50% 0%, rgba(244,230,196,.04), transparent 60%)"
            : "radial-gradient(90% 60% at 50% 0%, rgba(0,0,0,.04), transparent 60%)",
        }}
      />
      {children}
    </div>
  );
}
