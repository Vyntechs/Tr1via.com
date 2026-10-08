// October · Sleepy Hollow Night — the pumpkin patch, as pure data.
//
// One jack-o'-lantern per player along the bottom of the venue TV. This file
// decides, from what the TV already knows, how every pumpkin should look
// right now and where it sits. The canvas that draws them lives in
// components/experience/october. Nothing here reads a clock on its own or
// touches the game: callers pass `nowMs` in, which keeps it testable.
//
// Moods (the Figma art kit's five states):
//   waiting  unlit, hasn't answered this question yet
//   lit      locked in (or between questions, the patch glows)
//   blaze    right answer, at the reveal
//   smoke    wrong answer, at the reveal
//   toppled  didn't answer before time ran out (shown at the reveal, when
//            the TV has every answer: the venue TV's answer list can lag a
//            few seconds behind, so knocking pumpkins over at zero could
//            wrongly call out someone who locked in at the buzzer)

import type { TVMoment } from "@/lib/experience/tvMoment";

export type PumpkinMood = "waiting" | "lit" | "blaze" | "smoke" | "toppled";

export type PatchPhase =
  | "calm" //          lobby, board, standings, between games
  | "asking" //        question up, more than 5 seconds left
  | "final-seconds" // 5 seconds or less left
  | "times-up" //      clock hit zero, the reveal isn't on screen yet
  | "reveal"
  | "winner";

export type MoonPose =
  | "lobby"
  | "board"
  | "question"
  | "reveal"
  | "between"
  | "winner";

export type HorsemanCue = "none" | "ridge" | "ride" | "bridge" | "rear";

export interface PatchPlayer {
  key: string;
  name: string;
}

export interface PatchAnswer {
  playerKey: string;
  questionId: string;
  /** Null until the question is resolved (the TV never sees it earlier). */
  isCorrect: boolean | null;
}

export interface PatchScene {
  phase: PatchPhase;
  moods: Record<string, PumpkinMood>;
  /** Name stakes show, except on the board and from time's up through the
   *  reveal (they fade as answers close, before any pumpkin blazes, smokes or
   *  tips over, so nobody is called out). */
  showNames: boolean;
  /** Unlit pumpkins shiver in the last five seconds. */
  shiver: boolean;
  /** Clouds slide over the moon in the last five seconds. */
  clouds: boolean;
  moon: MoonPose;
  horseman: HorsemanCue;
  /** Seconds left on the question clock; negative after zero. Null when no
   *  question is up. Continuous, so the Horseman's ride can sync to it. */
  secondsLeft: number | null;
}

/** The question clock (seconds). Same for every theme today. */
export const QUESTION_SECONDS = 25;
/** The Horseman leaves the far ridge this long before answers close. */
export const RIDE_LEAD_SECONDS = 1.8;
/** …and is still in frame this long after, carried across the reveal. */
export const RIDE_TAIL_SECONDS = 1.2;
const FINAL_SECONDS = 5;

/** The most recent question the TV showed, so the Horseman can finish his
 *  ride after the screen switches to the reveal. */
export interface QuestionClock {
  questionId: string;
  revealedAtMs: number;
  /** Server time the question screen gave way to the next one, ms. */
  endedAtMs: number | null;
}

export interface PatchSceneInput {
  moment: TVMoment;
  questionClock?: QuestionClock | null;
  players: readonly PatchPlayer[];
  answers: readonly PatchAnswer[];
  /** Server-aligned now, ms (Date.now() plus the broadcast's clock skew). */
  serverNowMs: number;
  durationS?: number;
}

/** Seconds left on the question clock, continuous and allowed to go negative. */
export function rawSecondsLeft(
  revealedAtMs: number | null,
  serverNowMs: number,
  durationS: number = QUESTION_SECONDS,
): number | null {
  if (revealedAtMs === null || !Number.isFinite(revealedAtMs)) return null;
  return durationS - (serverNowMs - revealedAtMs) / 1000;
}

export function patchScene(input: PatchSceneInput): PatchScene {
  const { moment, players } = input;
  const secondsLeft = momentSecondsLeft(input);

  const phase = phaseFor(moment, secondsLeft);
  const answers = moment.questionId
    ? input.answers.filter((a) => a.questionId === moment.questionId)
    : [];
  const answered = new Map(answers.map((a) => [a.playerKey, a]));

  const moods: Record<string, PumpkinMood> = {};
  for (const p of players) {
    moods[p.key] = moodFor(phase, answered.get(p.key));
  }

  return {
    phase,
    moods,
    showNames: phase !== "reveal" && phase !== "times-up" && moment.kind !== "board",
    shiver: phase === "final-seconds",
    clouds: phase === "final-seconds" || phase === "times-up",
    moon: moonFor(moment.kind),
    horseman: horsemanFor(moment.kind, phase, secondsLeft),
    secondsLeft,
  };
}

/** Seconds left on the clock for the question on screen. Also answers on the
 *  reveal of that same question (negative by then), for the Horseman. */
export function momentSecondsLeft(input: PatchSceneInput): number | null {
  const { moment, questionClock } = input;
  if (moment.kind === "question") {
    return rawSecondsLeft(moment.revealedAtMs, input.serverNowMs, input.durationS);
  }
  if (moment.kind === "reveal" && questionClock && questionClock.questionId === moment.questionId) {
    // Only when the question screen lasted into the Horseman's ride window;
    // a reveal that came early (everyone locked in) never summons him.
    if (questionClock.endedAtMs === null) return null;
    const leftWhenEnded = rawSecondsLeft(questionClock.revealedAtMs, questionClock.endedAtMs, input.durationS);
    if (leftWhenEnded === null || leftWhenEnded > RIDE_LEAD_SECONDS) return null;
    return rawSecondsLeft(questionClock.revealedAtMs, input.serverNowMs, input.durationS);
  }
  return null;
}

function phaseFor(moment: TVMoment, secondsLeft: number | null): PatchPhase {
  switch (moment.kind) {
    case "question":
      if (secondsLeft === null || secondsLeft > FINAL_SECONDS) return "asking";
      if (secondsLeft > 0) return "final-seconds";
      return "times-up";
    case "reveal":
      return "reveal";
    case "winner":
      return "winner";
    default:
      return "calm";
  }
}

function moodFor(phase: PatchPhase, answer: PatchAnswer | undefined): PumpkinMood {
  switch (phase) {
    case "asking":
    case "final-seconds":
      return answer ? "lit" : "waiting";
    case "times-up":
      // Unknown yet: hold dark until the reveal brings the full answer list.
      return answer ? "lit" : "waiting";
    case "reveal":
      if (!answer) return "toppled";
      if (answer.isCorrect === true) return "blaze";
      if (answer.isCorrect === false) return "smoke";
      return "lit";
    case "winner":
      return "blaze";
    case "calm":
    default:
      return "lit";
  }
}

function moonFor(kind: TVMoment["kind"]): MoonPose {
  switch (kind) {
    case "lobby":
      return "lobby";
    case "question":
      return "question";
    case "reveal":
      return "reveal";
    case "between-games":
      return "between";
    case "winner":
      return "winner";
    default:
      return "board";
  }
}

function horsemanFor(
  kind: TVMoment["kind"],
  phase: PatchPhase,
  secondsLeft: number | null,
): HorsemanCue {
  if (kind === "between-games") return "bridge";
  if (kind === "winner") return "rear";
  if (secondsLeft === null) return "none";
  if (phase === "final-seconds" && secondsLeft > RIDE_LEAD_SECONDS) return "ridge";
  if (secondsLeft <= RIDE_LEAD_SECONDS && secondsLeft > -RIDE_TAIL_SECONDS) return "ride";
  return "none";
}

// ─── Where each pumpkin sits ─────────────────────────────────────────────
// TV design units (the 1600×900 stage). Matches the Figma frames: 29
// players sit in two staggered rows (14 behind, 15 in front) on a 99.2px
// step; the "41 players fit" proof keeps two rows on a tighter step. Past
// 44 players a third row keeps names readable.

export const PATCH_BOX = { x: 56, y: 676, w: 1488, h: 210 } as const;
const DESIGN_STEP = 99.2;
const FRONT_BOX_W = 124;
const FRONT_BOTTOM = PATCH_BOX.y + 216.2;
const ROW_SIZES: Record<number, number[]> = {
  1: [1],
  2: [101.7 / FRONT_BOX_W, 1],
  3: [0.74, 0.86, 1],
};

export interface PumpkinSlot {
  /** Centre x of the pumpkin's art box. */
  cx: number;
  /** Top of the art box (art is 160×200, the pumpkin sits in its lower part). */
  top: number;
  w: number;
  h: number;
  /** 0 = back row. */
  row: number;
  /** Top of the name stake. */
  stakeTop: number;
  stakeH: number;
  stakeFont: number;
  stakeMaxW: number;
}

export function patchRows(count: number): number[] {
  if (count <= 0) return [];
  const rows = count <= 1 ? 1 : count <= 44 ? 2 : 3;
  const base = Math.floor(count / rows);
  const extra = count % rows;
  // Back to front; the front rows take the extra pumpkins.
  return Array.from({ length: rows }, (_, r) => base + (r >= rows - extra ? 1 : 0));
}

export function patchLayout(count: number): PumpkinSlot[] {
  const rows = patchRows(count);
  if (rows.length === 0) return [];
  const widest = Math.max(...rows);
  const step = Math.min(DESIGN_STEP, PATCH_BOX.w / widest);
  // Three rows must still fit between the top of the strip and the hill.
  const s = Math.min(step / DESIGN_STEP, rows.length === 3 ? 0.848 : 1);
  const sizes = ROW_SIZES[rows.length] ?? ROW_SIZES[2];
  const gap = rows.length === 3 ? 50 * s : 61.2 * s;

  const slots: PumpkinSlot[] = [];
  const frontH = FRONT_BOX_W * 1.25 * s;
  const frontTop = FRONT_BOTTOM - frontH;
  rows.forEach((n, r) => {
    const fromFront = rows.length - 1 - r;
    const w = FRONT_BOX_W * sizes[r] * s;
    const h = w * 1.25;
    const top = frontTop - fromFront * gap;
    const mid = PATCH_BOX.x + PATCH_BOX.w / 2;
    for (let i = 0; i < n; i++) {
      slots.push({
        cx: mid + (i - (n - 1) / 2) * step,
        top,
        w,
        h,
        row: r,
        stakeTop: top + h * 0.784,
        stakeH: 22 * s,
        stakeFont: Math.max(9, 13 * s),
        stakeMaxW: Math.max(40, step * 0.94),
      });
    }
  });
  return slots;
}


// ─── Headstones ──────────────────────────────────────────────────────────
// Heather asked for "a couple of headstones" (Oct 7). Three stones from the
// Figma art kit stand on the hill wherever the pumpkin patch leaves room, and
// shrink or step aside as the patch fills the hill. Pure decoration: this
// reads the player count the patch already has and nothing else, never
// touches the game, and never moves a pumpkin, a name stake or any screen
// content (pumpkins and screen text always win).
//
// What shows, by how many pumpkins are in the patch:
//   three    16 or fewer: leaning slab (left), cracked and mossy (right) and a
//            small cross beside the slab
//   pair     17–24: the same two full-size stones, no cross
//   corners  25–44: two small stones in the corner margins, above the end
//            pumpkins (slab left, small cross right)
//   none     45 or more: three rows of pumpkins reach the corners, so no stones
//
// The spots are FIXED (they do not follow the count), so people joining never
// push a stone around. A stone only changes when the count crosses a line, and
// only comes back after the count falls a little below it, so a night hovering
// around 24/25 never flickers: a lobby filling from 0 to 30 changes the stones
// exactly twice (the cross leaves at 17, the pair shrinks at 25).

export type HeadstoneTier = "three" | "pair" | "corners" | "none";
export type HeadstoneStyle = "slab" | "cross" | "mossy";

/** The art kit's stones are drawn in a 160×200 box with the base at y 190. */
export const HEADSTONE_ART = { w: 160, h: 200 } as const;

export interface HeadstoneSpot {
  id: "left" | "right" | "extra" | "corner-left" | "corner-right";
  style: HeadstoneStyle;
  /** Top-left of the art box on the 1600×900 stage. */
  x: number;
  top: number;
  /** 1 = the art's native 160×200 box. */
  scale: number;
}

/** Every spot a stone can stand in. Positions come from the Figma prototype
 *  (page "05 · Headstones prototype"), except the two corner stones. The
 *  prototype only drew odd counts (29, 41), where the back row of pumpkins is
 *  one shorter. On even counts 30–38 the back row's end pumpkin reaches ~12 px
 *  further out, and at the reveal a toppled pumpkin falls to the left, so the
 *  corner stones are 0.38x (not 0.45x), tucked into the corners and standing
 *  above where a toppled end pumpkin lies. */
export const HEADSTONE_SPOTS: readonly HeadstoneSpot[] = [
  { id: "left", style: "slab", x: 36, top: 692, scale: 1 },
  { id: "right", style: "mossy", x: 1416, top: 692, scale: 1 },
  { id: "extra", style: "cross", x: 175.2, top: 719.2, scale: 0.8 },
  { id: "corner-left", style: "slab", x: 0, top: 672, scale: 0.38 },
  { id: "corner-right", style: "cross", x: 1536, top: 672, scale: 0.38 },
];

const TIER_SPOTS: Record<HeadstoneTier, readonly HeadstoneSpot["id"][]> = {
  three: ["left", "right", "extra"],
  pair: ["left", "right"],
  corners: ["corner-left", "corner-right"],
  none: [],
};

/** The stones standing in a tier. */
export function headstoneSpots(tier: HeadstoneTier): HeadstoneSpot[] {
  const ids = TIER_SPOTS[tier];
  return HEADSTONE_SPOTS.filter((s) => ids.includes(s.id));
}

const TIERS: readonly HeadstoneTier[] = ["three", "pair", "corners", "none"];
/** Going up, the count that moves the stones to the next tier… */
const UP_AT = [17, 25, 45];
/** …and the count at or below which each tier gives way to the one before it
 *  (two below the line it was crossed at, so the edge never flickers). */
const DOWN_AT = [Number.NEGATIVE_INFINITY, 14, 22, 43];

/** Which tier of stones to show for a pumpkin count, given the tier showing
 *  now (null on the very first look). Only changes after the count crosses a
 *  line, so the stones hold still while a night hovers near one. */
export function nextHeadstoneTier(prev: HeadstoneTier | null, count: number): HeadstoneTier {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  // First look: climb from the bottom. After that: start from what shows now,
  // climb on crossing a line up, fall only on dropping to a line down (a big
  // jump resolves in one call).
  const was = prev === null ? -1 : TIERS.indexOf(prev);
  let i = Math.max(0, was);
  while (i < UP_AT.length && n >= UP_AT[i]) i++;
  if (was >= 0) while (i > 0 && n <= DOWN_AT[i]) i--;
  return TIERS[i];
}
