// Decides whether a TV surface wears a living world tonight.
//
// Wraps the TV's screen switcher. For a plain theme it renders the screens
// exactly as before (no wrapper element, no context). For a theme with a
// world (October) it mounts that world once, around the screens, so the
// world survives every screen change. If the world ever fails it switches
// off for the rest of the night and the plain screens carry on, without
// remounting (so nothing in the game screen restarts).

"use client";

import { useState, type ReactNode } from "react";
import { tvWorldFor } from "@/lib/experience/packs";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { ThemeKey } from "@/lib/theme/tokens";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import { OctoberTVWorld } from "./october/OctoberTVWorld";

export interface TVWorldLayerProps {
  themeKey?: ThemeKey;
  snapshot: TVSnapshot;
  /** "still" never animates (the host's phone preview saves its battery). */
  tier?: "full" | "still";
  children: ReactNode;
}

export function TVWorldLayer({ themeKey, snapshot, tier = "full", children }: TVWorldLayerProps) {
  const spec = tvWorldFor(themeKey);
  const [failedPack, setFailedPack] = useState<string | null>(null);

  if (!spec) return <>{children}</>;

  const off = failedPack === spec.pack;
  const fail = () => setFailedPack(spec.pack);
  return (
    // Last line of defence: if the world's own wrapper ever throws while
    // drawing, the plain screens render instead.
    <ThemeLayerBoundary name="october:world" onFail={fail} fallback={children}>
      {/* Once failed, the world stays mounted but "off" (draws nothing, steps
          aside), so the game screens inside never remount. */}
      <OctoberTVWorld spec={spec} snapshot={snapshot} tier={tier} off={off} onFail={fail}>
        {children}
      </OctoberTVWorld>
    </ThemeLayerBoundary>
  );
}
