// October · the pumpkin patch, the Headless Horseman and the fog, drawn on
// ONE canvas in front of the TV screens (bottom strip only; the Horseman's
// ride crosses the lower right at time's up).
//
// The row itself (layout, moods over time, tiers, names, the frame loop and
// the crash guard) is the shared player row; this is October's art for it
// (./pumpkinRowArt.ts). Kept as its own component so the TV world, the tests
// and the crash guard's name stay the same.
//
// No hooks here: tests call it as a plain function.

"use client";

import {
  PlayerRowCanvas,
  type PlayerRowInputs,
} from "@/components/experience/shared/PlayerRowCanvas";
import type { PatchScene } from "@/lib/experience/october/patch";
import { PUMPKIN_ROW_ART } from "./pumpkinRowArt";

export type { WorldTier } from "@/components/experience/shared/PlayerRowCanvas";

export type OctoberPatchInputs = PlayerRowInputs<PatchScene>;

export interface OctoberPatchCanvasProps {
  inputs: OctoberPatchInputs;
  tier: "full" | "still";
  /** Scale the surrounding stage is drawn at; a change re-sizes the canvas
   *  so the pumpkins stay sharp. */
  stageScale?: number;
  onFail: (error: unknown) => void;
}

export function OctoberPatchCanvas(props: OctoberPatchCanvasProps) {
  return <PlayerRowCanvas art={PUMPKIN_ROW_ART} {...props} />;
}
