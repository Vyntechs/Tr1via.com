// October · Sleepy Hollow Night, the headstones.
//
// Three stones from the Figma art kit stand on the hill in fixed spots (see
// lib/experience/october/patch.ts for which show at what size of room). They
// are plain pictures in the backdrop: behind the TV screens and behind the
// pumpkin canvas, so the fog the canvas draws crosses them for free. No
// canvas work, no animation loop, no game data: the only thing that moves is
// a one-off opacity fade when the tier changes (instant in the "still" tier,
// which reduced motion and the host's phone preview use).
//
// Every spot is rendered once and just faded in or out, so a tier change
// never mounts or decodes anything mid-show.

"use client";

import { useMemo } from "react";
import {
  HEADSTONE_ART,
  HEADSTONE_SPOTS,
  headstoneSpots,
  type HeadstoneStyle,
  type HeadstoneTier,
} from "@/lib/experience/october/patch";
import { HEADSTONE_CROSS, HEADSTONE_MOSSY, HEADSTONE_SLAB, artUrl } from "./art";

const STAGE_W = 1600;
const STAGE_H = 900;
/** A tier change fades over this long (the plan: 1 second or more). */
const FADE_S = 1.4;

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

export function OctoberHeadstones({ tier, still }: { tier: HeadstoneTier; still: boolean }) {
  const urls = useMemo<Record<HeadstoneStyle, string>>(
    () => ({ slab: artUrl(HEADSTONE_SLAB), cross: artUrl(HEADSTONE_CROSS), mossy: artUrl(HEADSTONE_MOSSY) }),
    [],
  );
  const standing = new Set(headstoneSpots(tier).map((s) => s.id));

  return (
    <>
      {HEADSTONE_SPOTS.map((spot) => {
        const on = standing.has(spot.id);
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={spot.id}
            src={urls[spot.style]}
            alt=""
            draggable={false}
            data-testid={`october-stone-${spot.id}`}
            data-stone={on ? "on" : "off"}
            style={{
              position: "absolute",
              left: pct(spot.x, STAGE_W),
              top: pct(spot.top, STAGE_H),
              width: pct(HEADSTONE_ART.w * spot.scale, STAGE_W),
              height: pct(HEADSTONE_ART.h * spot.scale, STAGE_H),
              opacity: on ? 1 : 0,
              // Hidden stones are not painted at all once they have faded out.
              visibility: on ? "visible" : "hidden",
              transition: still
                ? "none"
                : `opacity ${FADE_S}s ease, visibility 0s linear ${on ? 0 : FADE_S}s`,
            }}
          />
        );
      })}
    </>
  );
}
