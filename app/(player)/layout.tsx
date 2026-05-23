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
import { PalettePeekProvider } from "@/components/player/PalettePeekProvider";

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
      {children}
      <PalettePeekProvider />
    </div>
  );
}
