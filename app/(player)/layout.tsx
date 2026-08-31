// Player surface layout.
//
// Mobile-first, no chrome — the player's phone is the whole screen. The
// global ThemeProvider in app/layout.tsx supplies the "house" default; the
// room route below swaps in the night's theme once it's loaded.
//
// `100dvh` instead of `100vh` so the layout respects the iOS dynamic toolbar
// (URL bar + bottom Safari chrome) and we don't get a phantom scrollbar on
// the Question or Reveal screens.

import type { ReactNode } from "react";
import { ConnectionRibbonProvider } from "@/components/player/ConnectionRibbonProvider";

export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        // `height`, not `minHeight`. This is the whole reason small Android
        // phones could not reach the bottom answers.
        //
        // Every player screen budgets its own space: the question screen
        // gives the prompt `flex: 1 1 auto` and shrinks its font to fit,
        // precisely so the four answer cards always survive. That budget
        // needs a definite height to divide up. With only a min-height the
        // box grows to whatever its content wants, nothing is ever asked to
        // shrink, and the overflow runs off the bottom of the phone — and
        // because a timed question deliberately locks scrolling, those
        // answers were not merely below the fold, they were untappable.
        // Measured on a 360x560 viewport: 0 of 4 answers reachable before,
        // 4 of 4 after.
        //
        // Screens that legitimately need more room (the lobby with its topic
        // list) scroll inside PhoneScreen, which already sets overflowY auto
        // for exactly this — that was always the intent.
        height: "100dvh",
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
