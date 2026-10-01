// Decides whether a TV surface wears a living world tonight.
//
// Wraps the TV's screen switcher. For a plain theme it renders the screens
// exactly as before (no wrapper element, no context). For a theme with a
// world (October) it mounts that world once, around the screens, so the
// world survives every screen change. If the world ever fails it switches
// off for the rest of the night and the plain screens carry on.

"use client";

import { useState, type ReactNode } from "react";
import { tvWorldFor } from "@/lib/experience/packs";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { ThemeKey } from "@/lib/theme/tokens";
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

  if (!spec || failedPack === spec.pack) return <>{children}</>;

  return (
    <OctoberTVWorld
      spec={spec}
      snapshot={snapshot}
      tier={tier}
      onFail={() => setFailedPack(spec.pack)}
    >
      {children}
    </OctoberTVWorld>
  );
}
