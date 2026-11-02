// The player row: one figure per player along the bottom of the venue TV,
// shared by every month that has one (October's pumpkins, November's
// turkeys). Pure data: where each slot sits and what mood each player's
// figure is in right now. What a slot looks like in each mood is the month's
// art (components/experience/<month>); the canvas that runs it all is
// components/experience/shared/PlayerRowCanvas.tsx.
//
// Moods (every month draws these five):
//   waiting  hasn't answered this question yet (October: unlit)
//   lit      locked in (or between questions, the whole row glows)
//   blaze    right answer, at the reveal
//   smoke    wrong answer, at the reveal
//   toppled  didn't answer before time ran out (shown at the reveal, when
//            the TV has every answer: the venue TV's answer list can lag a
//            few seconds behind, so knocking figures over at zero could
//            wrongly call out someone who locked in at the buzzer)

import type { TVMoment } from "@/lib/experience/tvMoment";

export type RowMood = "waiting" | "lit" | "blaze" | "smoke" | "toppled";

export type RowPhase =
  | "calm" //          lobby, board, standings, between games
  | "asking" //        question up, more than 5 seconds left
  | "final-seconds" // 5 seconds or less left
  | "times-up" //      clock hit zero, the reveal isn't on screen yet
  | "reveal"
  | "winner";

export interface RowPlayer {
  key: string;
  name: string;
}

export interface RowAnswer {
  playerKey: string;
  questionId: string;
  /** Null until the question is resolved (the TV never sees it earlier). */
  isCorrect: boolean | null;
}

/** What the shared row needs from any month's scene. */
export interface RowScene {
  phase: RowPhase;
  moods: Record<string, RowMood>;
  /** Names show, except on the board and from time's up through the reveal
   *  (they fade as answers close, before any figure blazes, smokes or tips
   *  over, so nobody is called out). */
  showNames: boolean;
}

export const FINAL_SECONDS = 5;

/** Phase, moods and names for the row, from what the TV already knows. */
export function rowScene(input: {
  moment: TVMoment;
  secondsLeft: number | null;
  players: readonly RowPlayer[];
  answers: readonly RowAnswer[];
}): RowScene {
  const { moment, players, secondsLeft } = input;
  const phase = rowPhase(moment, secondsLeft);
  const answers = moment.questionId
    ? input.answers.filter((a) => a.questionId === moment.questionId)
    : [];
  const answered = new Map(answers.map((a) => [a.playerKey, a]));

  const moods: Record<string, RowMood> = {};
  for (const p of players) {
    moods[p.key] = rowMood(phase, answered.get(p.key));
  }
  return {
    phase,
    moods,
    showNames: phase !== "reveal" && phase !== "times-up" && moment.kind !== "board",
  };
}

export function rowPhase(moment: TVMoment, secondsLeft: number | null): RowPhase {
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

export function rowMood(phase: RowPhase, answer: RowAnswer | undefined): RowMood {
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

// ─── Where each slot sits ────────────────────────────────────────────────
// TV design units (the 1600×900 stage). 29 players sit in two staggered rows
// (14 behind, 15 in front) on a 99.2px step; 41 players keep two rows on a
// tighter step. Past 44 players a third row keeps names readable.

export interface RowGeometry {
  /** The strip the row stands in (inside the TV's 56px safe margin). */
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Spacing between slots at full size. */
  designStep: number;
  /** Width of a front-row slot's art box at full size. */
  frontW: number;
  /** Bottom edge of the front row's art boxes. */
  frontBottom: number;
  /** Art box height ÷ width. */
  aspect: number;
  /** Size of each row (back to front) relative to the front row, by row count. */
  rowSizes: Record<number, number[]>;
}

const STRIP = { x: 56, y: 676, w: 1488, h: 210 } as const;

/** The standard row along the bottom of the TV (the Figma frames' layout). */
export const ROW_GEOMETRY: RowGeometry = {
  box: STRIP,
  designStep: 99.2,
  frontW: 124,
  frontBottom: STRIP.y + 216.2,
  aspect: 1.25,
  rowSizes: {
    1: [1],
    2: [101.7 / 124, 1],
    3: [0.74, 0.86, 1],
  },
};

export interface RowSlot {
  /** Centre x of the slot's art box. */
  cx: number;
  /** Top of the art box. */
  top: number;
  w: number;
  h: number;
  /** 0 = back row. */
  row: number;
  /** Top of the name label. */
  stakeTop: number;
  stakeH: number;
  stakeFont: number;
  stakeMaxW: number;
}

/** How many slots in each row, back to front. */
export function rowCounts(count: number): number[] {
  if (count <= 0) return [];
  const rows = count <= 1 ? 1 : count <= 44 ? 2 : 3;
  const base = Math.floor(count / rows);
  const extra = count % rows;
  // Back to front; the front rows take the extra figures.
  return Array.from({ length: rows }, (_, r) => base + (r >= rows - extra ? 1 : 0));
}

export function rowLayout(count: number, g: RowGeometry = ROW_GEOMETRY): RowSlot[] {
  const rows = rowCounts(count);
  if (rows.length === 0) return [];
  const widest = Math.max(...rows);
  const step = Math.min(g.designStep, g.box.w / widest);
  // Three rows must still fit between the top of the strip and the hill.
  const s = Math.min(step / g.designStep, rows.length === 3 ? 0.848 : 1);
  const sizes = g.rowSizes[rows.length] ?? g.rowSizes[2];
  const gap = rows.length === 3 ? 50 * s : 61.2 * s;

  const slots: RowSlot[] = [];
  const frontH = g.frontW * g.aspect * s;
  const frontTop = g.frontBottom - frontH;
  rows.forEach((n, r) => {
    const fromFront = rows.length - 1 - r;
    const w = g.frontW * sizes[r] * s;
    const h = w * g.aspect;
    const top = frontTop - fromFront * gap;
    const mid = g.box.x + g.box.w / 2;
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
