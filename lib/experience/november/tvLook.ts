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
  /** The quiet panel: paper colour at 86%, a faint cream edge. No backdrop
   *  blur: blurring the moving field every frame can drop frames on a weak
   *  venue laptop, and the solid tint reads the same from across the bar. */
  panel: "rgba(30,18,8,0.86)",
  panelEdge: "rgba(242,222,174,0.10)",
  tile: "rgba(242,222,174,0.07)",
  tileEdge: "rgba(242,222,174,0.16)",
  cream: (a: number) => `rgba(242,222,174,${a})`,
} as const;

/** Panel inset inside the TV's top 1600×680 part (stage px). The Figma
 *  frames put the panel at x 64, y 48 so the string lights show above it and
 *  the harvest table reads below it. The question and reveal screens hold
 *  more text (a long question with the host strip still has to fit at 32 px),
 *  so their shared panel keeps a little more room (x 56, y 36);
 *  lobby, board and between games draw the Figma's exact panels. */
export const NOV_PANEL_INSET = { top: 36, side: 56, bottom: 24 } as const;

/** The panel look as a style object (no backdrop-filter, see NOV.panel). */
export const NOV_PANEL_STYLE = {
  borderRadius: 32,
  background: NOV.panel,
  border: `1px solid ${NOV.panelEdge}`,
  boxShadow: "0 18px 60px rgba(10,5,2,.45)",
  boxSizing: "border-box",
} as const;

/** Stage width the turkey row is drawn on (1600×900 design stage). */
export const NOV_STAGE_W = 1600;

/**
 * Keep a name plate fully inside the frame: the plate's left edge (stage px),
 * nudged in so neither end is cut off at the screen's edge.
 */
export function clampPlateX(left: number, width: number, stageW = NOV_STAGE_W, margin = 6): number {
  const max = stageW - margin - width;
  if (max < margin) return (stageW - width) / 2;
  return Math.min(Math.max(left, margin), max);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when two boxes overlap. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Where the winner's name sits on the 1600×680 winner screen (one line,
 *  see novWinnerNameSize). Leaves and the wishbone stay out of it, so
 *  nothing covers the champion's name. */
export const NOV_WINNER_NAME_ZONE: Box = { x: 40, y: 140, w: 960, h: 300 };

/** The winner burst's leaves at rest: x, y, size (stage px), leaf 1-6, spin.
 *  They rest in the top band, clear of the name and the side cards. */
export const NOV_WINNER_LEAVES: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [24, 70, 60, 1, -40], [130, 16, 66, 2, 30], [262, 64, 54, 3, 120], [372, 10, 62, 4, -90],
  [470, 74, 50, 5, 60], [800, 20, 64, 6, -20], [905, 72, 52, 1, 150], [1010, 8, 58, 2, -60],
  [1120, 40, 46, 3, 80], [1225, 6, 56, 4, 200], [1330, 44, 44, 5, -130], [1430, 4, 60, 6, 45],
  [1530, 36, 52, 1, 100], [1490, 600, 56, 2, -75],
];

/** Winner name size (px): as big as 220, shrunk so the name fits one line
 *  in the name zone instead of wrapping over the cards and the field. */
export function novWinnerNameSize(name: string, maxWidth = NOV_WINNER_NAME_ZONE.w - 40): number {
  const chars = Math.max(1, [...name].length + 1); // + the full stop
  return Math.max(72, Math.min(220, Math.floor(maxWidth / (chars * 0.56))));
}

/** The drawn wishbone's box on the winner screen (stage px). */
export const NOV_WISHBONE_BOX: Box = { x: 560, y: 4, w: 220, h: 132 };

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
