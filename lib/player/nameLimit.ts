// Player name length cap, shared by the phone, the host's latecomer modal
// and the API routes so all three agree on what "16 characters" means.
//
// Characters are counted the way people see them: one emoji (even a
// multi-part one like a family or a flag) counts as 1. We use
// Intl.Segmenter when the runtime has it and fall back to code points
// ([...str]) otherwise. Plain-text limits like `maxLength` or zod's `.max()`
// count UTF-16 units instead, so an emoji would eat 2-11 of them.
//
// No server-only imports here — this file is bundled into the phone too.

export const MAX_PLAYER_NAME = 16;

/** Loose ceiling on raw UTF-16 length so nobody can post a megabyte. */
export const MAX_PLAYER_NAME_RAW = 200;

export const PLAYER_NAME_TOO_LONG_MESSAGE = `Names can be up to ${MAX_PLAYER_NAME} characters.`;

type SegmenterLike = { segment(input: string): Iterable<{ segment: string }> };

let segmenter: SegmenterLike | null | undefined;

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  const Seg = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: "grapheme" }) => SegmenterLike }).Segmenter;
  segmenter = typeof Seg === "function" ? new Seg(undefined, { granularity: "grapheme" }) : null;
  return segmenter;
}

/** Split a string into user-visible characters. */
export function splitNameChars(str: string): string[] {
  const seg = getSegmenter();
  if (seg) return Array.from(seg.segment(str), (s) => s.segment);
  return [...str];
}

/** How many characters a person sees in `str`. */
export function countNameChars(str: string): number {
  return splitNameChars(str).length;
}

/** Keep at most `max` visible characters (never splits an emoji). */
export function clampPlayerName(str: string, max: number = MAX_PLAYER_NAME): string {
  const chars = splitNameChars(str);
  return chars.length <= max ? str : chars.slice(0, max).join("");
}

/** True when the (already trimmed) name fits the cap. */
export function playerNameFits(str: string): boolean {
  return countNameChars(str) <= MAX_PLAYER_NAME;
}
