// Player surface layout.
//
// Mobile-first, no chrome — the player's phone is the whole screen. The
// global ThemeProvider in app/layout.tsx supplies the "house" default; the
// room route below swaps in the night's theme once it's loaded.
//
// `100dvh` instead of `100vh` so the layout respects the iOS dynamic toolbar
// (URL bar + bottom Safari chrome) and we don't get a phantom scrollbar on
// the Question or Reveal screens.
//
// `viewportFit: "cover"` is declared here and NOT in the root layout on
// purpose. It is what makes `env(safe-area-inset-*)` resolve to real numbers
// instead of 0 — PhoneScreen adds those insets to its padding so an Android
// gesture nav bar or an iPhone home indicator can't sit on top of the last
// answer card (issue #171). Scoping it to the player group keeps marketing,
// host and TV — none of which reserve insets — exactly as they are.

import type { Viewport } from "next";
import type { ReactNode } from "react";
import { ConnectionRibbonProvider } from "@/components/player/ConnectionRibbonProvider";

// Re-states the root layout's fields verbatim rather than relying on segment
// merge — losing `width=device-width` on the player phone would be far worse
// than the duplication.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1B130C",
};

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        // Each route owns its own background via PhoneScreen; we just supply
        // the viewport box and a neutral fallback for the brief moment
        // before children mount.
        background: "var(--paper)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
      }}
    >
      <ConnectionRibbonProvider />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
