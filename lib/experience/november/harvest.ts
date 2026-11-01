// November · Harvest Field: the pure rules (no drawing, no React).
//
//   skyFor       which light the field is in (golden → dusk → night)
//   leaderKey    the one player whose turkey wears the gold tail
//   harvestScene the shared row's scene plus the field's own cues
//   turkeyPose   which sprite strip and frame a turkey shows right now
//
// Like October, it only READS what the TV already has. The art that draws
// these is components/experience/november/.

import { rowScene, type RowAnswer, type RowMood, type RowPlayer, type RowScene } from "@/lib/experience/shared/playerRow";
import type { TVMoment, TVMomentKind } from "@/lib/experience/tvMoment";

// ── The turkey look ───────────────────────────────────────────────────────
// Three looks were rendered (A clay, B painted, C low-poly), each with the
// same strips, frame counts and ground row. Swapping the look = this letter
// (and copying that letter's sheets into public/themes/november/turkey/<L>/).
export const TURKEY_STYLE = "A" as const;

export type TurkeyAnim = "idle" | "fan" | "fanned-idle" | "right" | "wrong" | "hide" | "walk" | "leader";

/** From the art's manifest.json (frames left to right, 256 px square, 12 fps). */
export const TURKEY_ANIMS: Readonly<Record<TurkeyAnim, { frames: number; fps: number; loop: boolean }>> = {
  idle: { frames: 30, fps: 12, loop: true },
  fan: { frames: 6, fps: 12, loop: false },
  "fanned-idle": { frames: 24, fps: 12, loop: true },
  right: { frames: 12, fps: 12, loop: false },
  wrong: { frames: 12, fps: 12, loop: false },
  hide: { frames: 10, fps: 12, loop: false },
  walk: { frames: 10, fps: 12, loop: true },
  leader: { frames: 24, fps: 12, loop: true },
};
export const TURKEY_FRAME_PX = 256;
/** Pixel row of the ground line inside a 256 px frame. */
export const TURKEY_BASELINE_PX = 233;
/** The loose feathers spawn on this frame of "wrong". */
export const FEATHER_SPAWN_FRAME = 1;

export const turkeyUrl = (anim: TurkeyAnim) => `/themes/november/turkey/${TURKEY_STYLE}/${anim}-256.webp`;
export const featherUrl = (n: 1 | 2 | 3 | 4) => `/themes/november/turkey/${TURKEY_STYLE}/wrong-feather-${n}.webp`;

// ── The sky ───────────────────────────────────────────────────────────────

export type HarvestSky = "golden" | "dusk" | "night";

export const SKIES: readonly HarvestSky[] = ["golden", "dusk", "night"];

export const skyLayerUrl = (sky: HarvestSky, layer: "sky" | "far" | "table" | "front") =>
  `/themes/november/world/${sky}/${layer}.webp`;

/**
 * Golden in the lobby and on game 1's board before its first question; dusk
 * through game 1; night (string lights on over the table) for between games,
 * game 2 and the winner.
 */
export function skyFor(input: { moment: TVMomentKind; gameNo: 1 | 2 | null; gameStarted: boolean }): HarvestSky {
  const { moment, gameNo, gameStarted } = input;
  if (moment === "winner" || moment === "between-games") return "night";
  if (gameNo === 2) return "night";
  if (moment === "lobby") return "golden";
  if (moment === "question" || moment === "reveal") return "dusk";
  return gameStarted ? "dusk" : "golden";
}

/** Has the game on screen asked a question yet? A reveal event for it, or
 *  anyone in its scores list with an answer or points. */
export function gameStarted(input: {
  currentGameId: string | null;
  reveals: readonly { gameId: string; event: string }[];
  scores: readonly { score: number; answered_count?: number }[];
}): boolean {
  const { currentGameId, reveals, scores } = input;
  if (currentGameId && reveals.some((r) => r.gameId === currentGameId && r.event === "reveal")) return true;
  return scores.some((s) => (s.answered_count ?? 0) > 0 || s.score > 0);
}

// ── The leader ────────────────────────────────────────────────────────────

/** Screens where the gold tail shows. During a question a fanned gold tail
 *  would read as "locked in", so it waits for the board and the finale. */
const LEADER_MOMENTS: ReadonlySet<TVMomentKind> = new Set(["board", "standings", "between-games", "winner"]);

/** The single top scorer (score above 0), or null on a tie or no scores. */
export function leaderKey(
  moment: TVMomentKind,
  scores: readonly { player_key: string; score: number }[],
): string | null {
  if (!LEADER_MOMENTS.has(moment)) return null;
  let best: string | null = null;
  let top = 0;
  let tie = false;
  for (const s of scores) {
    const v = typeof s.score === "number" && Number.isFinite(s.score) ? s.score : 0;
    if (v > top) {
      top = v;
      best = String(s.player_key);
      tie = false;
    } else if (v === top && v > 0) {
      tie = true;
    }
  }
  return tie ? null : best;
}

// ── The scene ─────────────────────────────────────────────────────────────

export interface HarvestScene extends RowScene {
  sky: HarvestSky;
  leader: string | null;
  /** Last five seconds: a stronger gust of leaves. */
  gust: boolean;
}

export function harvestScene(input: {
  moment: TVMoment;
  secondsLeft: number | null;
  players: readonly RowPlayer[];
  answers: readonly RowAnswer[];
  gameNo: 1 | 2 | null;
  gameStarted: boolean;
  scores: readonly { player_key: string; score: number }[];
}): HarvestScene {
  const row = rowScene(input);
  return {
    ...row,
    sky: skyFor({ moment: input.moment.kind, gameNo: input.gameNo, gameStarted: input.gameStarted }),
    leader: leaderKey(input.moment.kind, input.scores),
    gust: row.phase === "final-seconds",
  };
}

export function sameHarvestScene(a: HarvestScene, b: HarvestScene): boolean {
  if (a.phase !== b.phase || a.showNames !== b.showNames || a.sky !== b.sky || a.leader !== b.leader || a.gust !== b.gust) {
    return false;
  }
  const ak = Object.keys(a.moods);
  if (ak.length !== Object.keys(b.moods).length) return false;
  return ak.every((k) => a.moods[k] === b.moods[k]);
}

// ── What a turkey shows ───────────────────────────────────────────────────

export interface TurkeyPose {
  anim: TurkeyAnim;
  frame: number;
}

const msPerFrame = (anim: TurkeyAnim) => 1000 / TURKEY_ANIMS[anim].fps;
const lastFrame = (anim: TurkeyAnim) => TURKEY_ANIMS[anim].frames - 1;

/** Loop frame from the wall clock, offset per turkey so 41 never move in step. */
export function loopFrame(anim: TurkeyAnim, now: number, seed: number): number {
  const n = TURKEY_ANIMS[anim].frames;
  const offset = Math.floor((((seed % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * n);
  const f = Math.floor(now / msPerFrame(anim)) + offset;
  return ((f % n) + n) % n;
}

/** A one-shot animation's frame, holding the last one when it ends. */
export function onceFrame(anim: TurkeyAnim, msSince: number): number {
  if (!(msSince > 0)) return 0;
  return Math.min(lastFrame(anim), Math.floor(msSince / msPerFrame(anim)));
}

/**
 * Mood → strip and frame.
 *   waiting → idle loop (tail down)
 *   lit     → fan, then fanned-idle loop (straight to fanned-idle after a right answer)
 *   blaze   → right (gobble, warm rim glow), hold the last frame
 *   smoke   → wrong (droop, feathers leave on frame 1), hold the last frame
 *   toppled → hide (dives into a hay bale), hold the last frame
 *   leader (lit or blaze, board and winner screens only) → gold leader loop
 * msSince < 0 means the change hasn't started yet (the ripple delay): the
 * turkey keeps showing its previous mood, settled.
 * Still tier: one settled frame per mood, nothing moves.
 */
export function turkeyPose(input: {
  mood: RowMood;
  prevMood: RowMood;
  msSince: number;
  now: number;
  seed: number;
  leader: boolean;
  still: boolean;
}): TurkeyPose {
  const { mood, prevMood, msSince, now, seed, leader, still } = input;
  if (!still && msSince < 0 && prevMood !== mood) {
    return turkeyPose({ ...input, mood: prevMood, msSince: 1e9 });
  }
  if (leader && (mood === "lit" || mood === "blaze")) {
    return { anim: "leader", frame: still ? 0 : loopFrame("leader", now, seed) };
  }
  switch (mood) {
    case "waiting":
      return { anim: "idle", frame: still ? 0 : loopFrame("idle", now, seed) };
    case "lit": {
      if (still) return { anim: "fanned-idle", frame: 0 };
      const fanMs = TURKEY_ANIMS.fan.frames * msPerFrame("fan");
      if (prevMood !== "lit" && prevMood !== "blaze" && msSince < fanMs) {
        return { anim: "fan", frame: onceFrame("fan", msSince) };
      }
      return { anim: "fanned-idle", frame: loopFrame("fanned-idle", now, seed) };
    }
    case "blaze":
      return { anim: "right", frame: still ? lastFrame("right") : onceFrame("right", msSince) };
    case "smoke":
      return { anim: "wrong", frame: still ? lastFrame("wrong") : onceFrame("wrong", msSince) };
    case "toppled":
    default:
      return { anim: "hide", frame: still ? lastFrame("hide") : onceFrame("hide", msSince) };
  }
}
