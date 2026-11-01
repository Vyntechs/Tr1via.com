// November · Harvest Field on the player's phone: the pure rules for
// "your turkey" (no drawing, no React).
//
//   isNovemberPhone   does this theme dress the phone as the field?
//   phoneTurkeyPlan   which sprite strip a phone turkey shows, and how it plays
//   phoneTurkeyMood   the turkey's mood for a question or locked screen
//
// The phone turkey reuses the TV row's strips and its still frames
// (turkeyPose in ./harvest). Like the TV, it only READS what the screen
// already has; it never writes game state.

import type { ThemeKey } from "@/lib/theme/tokens";
import type { RowMood } from "@/lib/experience/shared/playerRow";
import { TURKEY_ANIMS, TURKEY_STYLE, turkeyPose, type HarvestSky, type TurkeyAnim } from "./harvest";

export type { HarvestSky };

/** November dresses the player phone as the field; every other month is untouched. */
export function isNovemberPhone(themeKey: ThemeKey | undefined): boolean {
  return themeKey === "november";
}

/** The phone's own moods: the row's five, plus "arrive" (walks in on the lobby). */
export type PhoneTurkeyMood = RowMood | "arrive";

export const PHONE_TURKEY_MOODS: readonly PhoneTurkeyMood[] = ["arrive", "waiting", "lit", "blaze", "smoke", "toppled"];

/** How long the lobby walk-in lasts before the turkey settles into its idle. */
export const PHONE_WALK_MS = 1400;

/** The strips the phone ships. "fanned-idle" and "leader" stay TV-only: the
 *  fan's last frame IS fanned-idle's first, so locked plays fan once and holds. */
export type PhoneTurkeyAnim = Exclude<TurkeyAnim, "fanned-idle" | "leader">;

export interface PhoneTurkeyPlan {
  anim: PhoneTurkeyAnim;
  frames: number;
  fps: number;
  /** loop = repeats; once = plays then holds the last frame; still = one frame. */
  play: "loop" | "once" | "still";
  /** The frame shown when play is "still". */
  frame: number;
}

const PLAY: Record<RowMood, { anim: PhoneTurkeyAnim; play: "loop" | "once" }> = {
  waiting: { anim: "idle", play: "loop" },
  lit: { anim: "fan", play: "once" },
  blaze: { anim: "right", play: "once" },
  smoke: { anim: "wrong", play: "once" },
  toppled: { anim: "hide", play: "once" },
};

function isMood(m: unknown): m is PhoneTurkeyMood {
  return typeof m === "string" && (PHONE_TURKEY_MOODS as readonly string[]).includes(m);
}

function plan(anim: PhoneTurkeyAnim, play: PhoneTurkeyPlan["play"], frame = 0): PhoneTurkeyPlan {
  return { anim, frames: TURKEY_ANIMS[anim].frames, fps: TURKEY_ANIMS[anim].fps, play, frame };
}

/**
 * Mood → strip.
 *   arrive  → walk loop until it has arrived, then the idle loop
 *   waiting → idle loop (tail down)
 *   lit     → fan once, hold fanned
 *   blaze   → right (gobble) once, hold
 *   smoke   → wrong (droop) once, hold
 *   toppled → hide (hay-bale dive) once, hold
 * Reduced motion: the TV's settled still frame for the mood, nothing moves.
 * Unknown moods show the idle turkey.
 */
export function phoneTurkeyPlan(
  requested: PhoneTurkeyMood,
  opts: { reduced: boolean; arrived?: boolean },
): PhoneTurkeyPlan {
  const mood0: PhoneTurkeyMood = isMood(requested) ? requested : "waiting";
  if (mood0 === "arrive" && !opts.reduced && !opts.arrived) return plan("walk", "loop");
  const mood: RowMood = mood0 === "arrive" ? "waiting" : mood0;
  if (opts.reduced) {
    const pose = turkeyPose({ mood, prevMood: mood, msSince: 1e9, now: 0, seed: 0, leader: false, still: true });
    // The phone has no fanned-idle strip: its frame 0 is the fan's last frame.
    if (pose.anim === "fanned-idle") return plan("fan", "still", TURKEY_ANIMS.fan.frames - 1);
    return plan(pose.anim as PhoneTurkeyAnim, "still", pose.frame);
  }
  const p = PLAY[mood];
  return plan(p.anim, p.play);
}

/** The phone only ships the 128 px idle (the small turkey in the timer
 *  strip); every bigger or other turkey uses the TV's 256 px strips. */
export function phoneTurkeyStripPx(anim: PhoneTurkeyAnim, size: number): 128 | 256 {
  return anim === "idle" && size <= 80 ? 128 : 256;
}

export function phoneTurkeyUrl(anim: PhoneTurkeyAnim, px: 128 | 256): string {
  return `/themes/november/turkey/${TURKEY_STYLE}/${anim}-${px}.webp`;
}

/**
 * Question and locked screens: the tail fans the moment the server says yes.
 * Never the hay-bale dive here: that waits for the reveal (the TV's answers
 * lag up to 4 s), so a slow or unconfirmed send just keeps the idle turkey.
 */
export function phoneTurkeyMood(sendState: string | undefined | null): RowMood {
  return sendState === "locked" ? "lit" : "waiting";
}

/** The phone's flattened field picture for each light (sky + far + table +
 *  front, cropped to a phone). */
export const phoneWorldUrl = (sky: HarvestSky) => `/themes/november/phone/${sky}.webp`;
export const PHONE_PIE_URL = "/themes/november/phone/pie.webp";
export const PHONE_WISHBONE_URL = "/themes/november/phone/wishbone.webp";

/** The dark field panels the November phone puts its cards on (paper #1E1208). */
export const NOVEMBER_PHONE_PANEL = "rgba(30,18,8,.84)";
export const NOVEMBER_PHONE_PANEL_STRONG = "rgba(30,18,8,.92)";
