// Outer shell for host-laptop screens. Originally rendered a macOS
// traffic-light window chrome around every host view to mirror the
// design canvas — Brandon (2026-05-27) yanked that. The host app
// already runs inside a real browser window; faking a Mac frame
// inside one was redundant and a little tacky.
//
// What remains: a theme-aware paper-background flex column that the
// host views fill. No chrome, no title bar, no wordmark.

"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";

export interface LaptopShellProps {
  children: ReactNode;
}

export function LaptopShell({ children }: LaptopShellProps) {
  const { t } = useTheme();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
