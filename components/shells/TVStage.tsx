// 16:9 venue-TV stage. Layers the theme's weather behind, plus a subtle
// warm vignette. Children sit at z-index 1 so they always read above the
// ambient motion.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import type { AugustPageName } from "@/components/system/AugustPage";
import { Weather } from "@/components/system/Weather";
import { useStageWorld } from "@/components/experience/StageWorld";

export interface TVStageProps {
  children: ReactNode;
  /** Override the theme background for deliberately special TV moments. */
  bg?: string;
  weather?: boolean;
  weatherIntensity?: number;
  /** Bump to fire a beat-triggered May lightning strike. Only meaningful
   *  on storm-themed nights; ignored by other themes. */
  lightningTriggerCount?: number;
  /** Which screen of the night this is. Only the August notebook theme reads
   *  it — it decides which marginalia is drawn in that screen's empty page.
   *  Omit it and no marginalia is drawn, which is safe anywhere. */
  page?: AugustPageName;
  style?: CSSProperties;
  /** Forwarded data-testid for E2E tests. Applied to the outer container so
   *  Playwright can target any TV screen by its top-level id. */
  "data-testid"?: string;
  /** Optional semantic marker used by visual regression checks. */
  "data-reading-surface"?: string;
}

export function TVStage({
  children,
  bg,
  weather = true,
  weatherIntensity = 1,
  lightningTriggerCount = 0,
  page,
  style,
  "data-testid": dataTestId,
  "data-reading-surface": dataReadingSurface,
}: TVStageProps) {
  const { t, themeKey } = useTheme();
  // A theme's living world (October) is mounted behind every TV screen. The
  // stage then steps aside: no background or weather of its own, and it
  // keeps to the top part so the world's patch has the bottom strip. The
  // reveal keeps a dark scrim so the answer reads exactly like today. Same
  // element structure either way, so if the world switches off mid-night the
  // screen inside doesn't restart.
  const world = useStageWorld();
  return (
    <div
      data-testid={dataTestId}
      data-reading-surface={dataReadingSurface}
      data-stage-world={world?.pack}
      style={{
        width: "100%",
        height: world ? `${world.contentHeight * 100}%` : "100%",
        ...(world ? { flexShrink: 0 } : null),
        background: world ? (page === "reveal" ? "rgba(18,10,6,.72)" : "transparent") : bg ?? t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {weather && !world && (
        <Weather
          themeKey={themeKey}
          intensity={weatherIntensity}
          lightningTriggerCount={lightningTriggerCount}
          page={page}
          // A stage that paints its own background means it — the reveal
          // paints its own surface, and a theme has no business repainting
          // over it.
          substrate={!bg || bg === t.paper}
        />
      )}
      {world ? null : (
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
      )}
      {children}
    </div>
  );
}
