// Outer shell for host-laptop screens. Originally rendered a macOS
// traffic-light window chrome around every host view to mirror the
// design canvas — Brandon (2026-05-27) yanked that. The host app
// already runs inside a real browser window; faking a Mac frame
// inside one was redundant and a little tacky.
//
// What remains: a theme-aware paper-background flex column that the
// host views fill. No chrome, no title bar, no wordmark.
//
// `weather` (opt-in, default off) layers the active theme's ambient weather
// behind the content at low opacity, so a host surface feels like the same
// "night" as the player phones (which layer Weather via PhoneScreen) and the
// TV. Off by default so other host screens (dashboard, live console) are
// unaffected.

"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { Weather } from "@/components/system/Weather";

export interface LaptopShellProps {
  children: ReactNode;
  /** Layer the active theme's ambient weather behind the content at low
   *  opacity. Default off — only the setup overview opts in. */
  weather?: boolean;
}

export function LaptopShell({ children, weather = false }: LaptopShellProps) {
  const { t, themeKey } = useTheme();
  // On phones the host screens stack into a single tall column. Let the shell
  // grow with its content (height:auto) and stop clipping so the page can
  // scroll instead of hiding overflow off-screen. Desktop is untouched.
  const compact = useMediaQuery("(max-width: 860px)");
  return (
    <div
      style={{
        width: "100%",
        height: compact ? "auto" : "100%",
        minHeight: compact ? "100%" : undefined,
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: compact ? "visible" : "hidden",
      }}
    >
      {weather && (
        <div
          aria-hidden
          style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none", zIndex: 0 }}
        >
          <Weather themeKey={themeKey} intensity={0.5} />
        </div>
      )}
      <div style={{ flex: 1, overflow: compact ? "visible" : "hidden", display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
