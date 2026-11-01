// What a month hands the shared player row (PlayerRowCanvas): its pictures
// and how a slot draws in each mood. The row itself (where slots sit, when
// moods change, the ripple, names fading, tiers, the frame loop, the crash
// guard) is the same for every month; the art only draws.
//
// October's art: components/experience/october/pumpkinRowArt.ts.

import type { RowGeometry, RowPhase, RowScene, RowSlot, RowMood } from "@/lib/experience/shared/playerRow";

/** One picture the row pre-draws to a bitmap at the TV's size. */
export interface RowSprite {
  url: string;
  width: number;
  height: number;
  /** Width in stage units to pre-draw at; omitted = a front-row slot's width.
   *  For a strip, the width of ONE frame. */
  designW?: number;
  /** A strip of this many equal frames, left to right (drawn with
   *  drawSpriteFrame); omitted = one picture. */
  frames?: number;
}

/** One player's figure, as the row keeps it (stage units, 1600×900). */
export interface RowSlotState<F = unknown> {
  key: string;
  name: string;
  /** Where it is drawn now (glides toward `slot` when the row reflows). */
  x: number;
  top: number;
  w: number;
  h: number;
  slot: RowSlot;
  mood: RowMood;
  prevMood: RowMood;
  /** performance.now() when the mood last changed, and the ripple delay. */
  changedAt: number;
  delay: number;
  appearedAt: number;
  /** Steady per-player number (0 to ~6.28) so figures don't move in step. */
  seed: number;
  /** The month's own per-figure state (e.g. when the next ember is due). */
  fx: F;
}

/** Where one figure is in its mood change this frame. */
export interface RowSlotFrame {
  now: number;
  /** 0 → 1 through the current mood change (1 in the still tier). */
  p: number;
  /** p, eased in and out. */
  e: number;
  /** Top of the art box this frame (a new figure rises into place). */
  top: number;
  /** 0 → 1 as a new figure appears. */
  born: number;
}

/** What the row lends the art to draw with. */
export interface RowKit {
  ctx: CanvasRenderingContext2D;
  /** Still tier (reduced motion, the host's phone preview): draw once, no motion. */
  still: boolean;
  /** Lite tier (a slow TV): keep the story, do less. Can turn on mid-night. */
  isLite: () => boolean;
  /** Stage units → canvas pixels. */
  toX: (x: number) => number;
  toY: (y: number) => number;
  toS: (v: number) => number;
  /** Draws a pre-drawn sprite centred on cx, pivoting at pivotY of its height. */
  drawSprite: (
    key: string,
    cx: number,
    top: number,
    w: number,
    h: number,
    alpha: number,
    rotateDeg?: number,
    pivotY?: number,
    scaleY?: number,
  ) => void;
  /** A name cut to fit maxW canvas pixels in the current ctx.font (cached). */
  /** One frame of a strip sprite, its box's top-left at (cx - w/2, top). */
  drawSpriteFrame: (key: string, frame: number, cx: number, top: number, w: number, h: number, alpha: number) => void;
  fitLabel: (name: string, maxW: number) => string;
  fontFamily: () => string;
  secondsLeftNow: () => number | null;
  colorFor: (playerKey: string) => string;
}

/** One running copy of the month's art (made fresh when the canvas starts). */
export interface RowRenderer<S extends RowScene, F> {
  /** A figure's mood changed; its change starts at `at`. */
  onMoodChange?: (rt: RowSlotState<F>, at: number) => void;
  onPhaseChange?: (phase: RowPhase, now: number) => void;
  /** Behind the row. */
  drawBack?: (now: number, scene: S) => void;
  /** One figure, called back row first. */
  drawSlot: (rt: RowSlotState<F>, frame: RowSlotFrame, scene: S) => void;
  /** One figure's name (alpha > 0.01; one fillText per name). */
  drawLabel: (rt: RowSlotState<F>, alpha: number) => void;
  /** In front of the row and its names. */
  drawFront?: (now: number, scene: S) => void;
}

export interface RowArt<S extends RowScene, F = unknown> {
  /** Name in the crash report, e.g. "october:patch". */
  name: string;
  /** data-testid on the canvas. */
  testId: string;
  geometry: RowGeometry;
  sprites: Readonly<Record<string, RowSprite>>;
  newFx: (now: number) => F;
  create: (kit: RowKit) => RowRenderer<S, F>;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
export const easeOut = (v: number) => 1 - (1 - v) * (1 - v);
export const easeInOut = (v: number) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2);
