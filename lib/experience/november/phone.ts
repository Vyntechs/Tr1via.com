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
import { TURKEY_ANIMS, TURKEY_STYLE, featherUrl, turkeyPose, type HarvestSky, type TurkeyAnim } from "./harvest";

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

/** Small turkeys (80 px or less: question, locked, winner card) use the
 *  128 px strips; bigger ones (reveal, between games, lobby) keep the TV's
 *  256 px strips so they stay sharp on a 3x phone. */
export function phoneTurkeyStripPx(anim: PhoneTurkeyAnim, size: number): 128 | 256 {
  return SMALL_STRIPS.includes(anim) && size <= 80 ? 128 : 256;
}

/** The strips that ship a 128 px copy (the moods a small turkey shows). */
const SMALL_STRIPS: readonly PhoneTurkeyAnim[] = ["idle", "fan", "right"];

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

// ── Safari-safe strip stepping ─────────────────────────────────────────────
// The strip is the background of a box one frame wide, and the animation
// steps its background-position. Only that one frame is ever painted, so
// the composited layer stays about one frame (a strip-wide transformed
// layer can be 20000+ device px wide: past iPhone Safari's texture and
// memory limits). A keyframe that reads var() is not trusted on older
// iPhone Safari, so each strip end gets its own keyframe with the pixel
// value written in.

/** Keyframe name + CSS that steps a strip background from 0 to `endPx` (negative). */
export function stripKeyframes(endPx: number): { name: string; css: string } {
  const px = Number.isFinite(endPx) ? Math.round(endPx) : 0;
  const name = `tr1via-nov-strip-${px < 0 ? "m" : ""}${Math.abs(px)}`;
  return { name, css: `@keyframes ${name} { from { background-position: 0px 0px; } to { background-position: ${px}px 0px; } }` };
}

// ── Preload ────────────────────────────────────────────────────────────────
// Nothing is fetched on the join screen (that is when 40 phones share the
// venue wifi with their join requests). The room page asks for three sets:
//   soon   : after this phone has joined: the first question's small idle +
//            fan and the dusk field
//   reveal : once a game is live: the reveal strips and loose feathers
//   night  : at the first reveal: night field, pie, small gobble, wishbone
// The lobby's own turkey (walk + idle 256) loads with the lobby itself.

export interface PhonePreloadWaves {
  soon: string[];
  reveal: string[];
  night: string[];
}

export function phonePreloadWaves(): PhonePreloadWaves {
  return {
    soon: [phoneTurkeyUrl("idle", 128), phoneTurkeyUrl("fan", 128), phoneWorldUrl("dusk")],
    reveal: [
      phoneTurkeyUrl("right", 256),
      phoneTurkeyUrl("wrong", 256),
      phoneTurkeyUrl("hide", 256),
      ...([1, 2, 3, 4] as const).map(featherUrl),
    ],
    night: [phoneWorldUrl("night"), PHONE_PIE_URL, phoneTurkeyUrl("right", 128), PHONE_WISHBONE_URL],
  };
}

/** Every picture the sets fetch, in order. */
export function phonePreloadUrls(): string[] {
  const w = phonePreloadWaves();
  return [...w.soon, ...w.reveal, ...w.night];
}

// ── Category bar ───────────────────────────────────────────────────────────
// The question/locked screens open with a full-width category bar painted in
// the category's color (cyan for Geography). On the Harvest Field that bright
// band breaks the palette, so November uses the Figma look instead: the dark
// field panel, cream type, burnt-orange eyebrow and point tag.

export const NOVEMBER_PHONE_CREAM = "#F2DEAE";
export const NOVEMBER_PHONE_ACCENT = "#C25E22";
export const NOVEMBER_PHONE_PAPER = "#1E1208";

export interface PhoneCategoryBarLook {
  background: string;
  ink: string;
  eyebrow: string;
  tagColor: string;
  tagInk: string;
  borderBottom?: string;
}

/** Colors for the category bar. Every month but November keeps today's look exactly. */
export function phoneCategoryBar(november: boolean, catColor: string): PhoneCategoryBarLook {
  if (!november) return { background: catColor, ink: "#0E0805", eyebrow: "rgba(14,8,5,.65)", tagColor: "#0E0805", tagInk: catColor };
  return {
    background: NOVEMBER_PHONE_PANEL_STRONG,
    ink: NOVEMBER_PHONE_CREAM,
    eyebrow: NOVEMBER_PHONE_ACCENT,
    tagColor: NOVEMBER_PHONE_ACCENT,
    tagInk: NOVEMBER_PHONE_PAPER,
    borderBottom: "1px solid rgba(242,222,174,.08)",
  };
}

// ── Finale: tonight's winner ───────────────────────────────────────────────

/**
 * Who won, for the November finale card shown to everyone who didn't. Uses
 * only what the room already has: the final game's scores and the roster.
 * Ties list every winner. Returns null when a name is missing, so the screen
 * never shows a made-up name.
 */
export function finaleWinner(
  ranked: ReadonlyArray<{ rank: number; row: { player_id: string | null; score: number | null; display_name?: string | null } }>,
  names: ReadonlyMap<string, string> = new Map(),
): { name: string; score: number } | null {
  const top = ranked.filter((r) => r.rank === 1);
  if (top.length === 0) return null;
  const list = top.map((r) => (r.row.display_name ?? (r.row.player_id ? names.get(r.row.player_id) : undefined) ?? "").trim());
  if (list.some((n) => !n)) return null;
  const name = list.length === 1 ? list[0] : list.length === 2 ? `${list[0]} & ${list[1]}` : `${list.slice(0, -1).join(", ")} & ${list[list.length - 1]}`;
  return { name, score: top[0].row.score ?? 0 };
}

/** Runs the winner lookup, but a bad row gives "no winner card" instead of
 *  crashing the finale screen. */
export function safeFinaleWinner(find: () => { name: string; score: number } | null): { name: string; score: number } | null {
  try {
    return find();
  } catch {
    return null;
  }
}
