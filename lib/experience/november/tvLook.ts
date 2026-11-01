// November · Harvest Field: the look of the TV screens (step 2).
//
// One quiet dark panel over the living field, a burnt-orange timer ring that
// turns red for the last five seconds, and cream name plates that stand in
// two lanes under the turkeys instead of on top of the front row's tails.
// Pure values and functions only, so they can be unit tested.

export const NOV = {
  paper: "#1E1208",
  ink: "#F2DEAE",
  burnt: "#C25E22",
  red: "#D9442B",
  olive: "#7E8C2A",
  correct: "#C8E25E",
  /** The quiet panel: paper colour at 84%, blurred, a faint cream edge. */
  panel: "rgba(30,18,8,0.84)",
  panelEdge: "rgba(242,222,174,0.10)",
  tile: "rgba(242,222,174,0.07)",
  tileEdge: "rgba(242,222,174,0.16)",
  cream: (a: number) => `rgba(242,222,174,${a})`,
} as const;

/** Panel inset inside the TV's top 1600×680 part (stage px). */
export const NOV_PANEL_INSET = { top: 24, side: 48, bottom: 24 } as const;

/** Question sizes on the panel: 52 px when it fits, down to 32 for long ones. */
export const NOV_QUESTION_SIZES = [32, 36, 40, 44, 48, 52] as const;

/** The timer ring: burnt orange, red at five seconds and under. */
export function novTimerColor(seconds: number): string {
  return seconds <= 5 ? NOV.red : NOV.burnt;
}

/** Share of a slot's art box where the figure's feet / plate start (playerRow). */
const STAKE_OF_BOX = 0.784;

export interface PlateSlot {
  top: number;
  w: number;
  h: number;
  stakeTop: number;
  stakeH: number;
}

export interface PlateGeometry {
  frontW: number;
  aspect: number;
  frontBottom: number;
}

/**
 * Where a turkey's name plate goes (stage px, top edge).
 *
 * The shared row puts every plate at its own figure's feet, so a back-row
 * plate lands on the front row's tails. Here the plates leave the figures:
 * the back row's plates sit just under the front row's feet and the front
 * row's plates one lane lower, staggered like the Figma (y 856 / 878). The
 * very back row of a three-row crowd (over 44 players) keeps its place.
 */
export function turkeyPlateTop(slot: PlateSlot, g: PlateGeometry): number {
  const s = slot.stakeH / 22;
  const frontW = g.frontW * s;
  const frontH = frontW * g.aspect;
  const frontStake = g.frontBottom - frontH + frontH * STAKE_OF_BOX;
  const size = slot.w / frontW;
  const laneH = slot.stakeH * 0.92 + 0.5;
  if (size > 0.98) return frontStake + laneH; // front row: bottom lane
  if (size > 0.78) return frontStake; // back row (or middle of three)
  return slot.stakeTop; // very back of three rows
}
