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

/**
 * Ceiling on raw UTF-16 length, checked after extra accent marks are
 * stripped. 64 fits 16 letters with 3 marks each, a name with a few
 * multi-part emoji, and every name the old page allowed (40). The phone's
 * clamp applies the same ceiling, so phone and server always agree.
 */
export const MAX_PLAYER_NAME_RAW = 64;

/**
 * Most combining marks (accents, tone marks, emoji variation selectors)
 * kept in a row on one character. Real names need at most 3: Vietnamese
 * "ệ" typed as e + 2 marks, Hindi nukta + vowel sign + nasal mark, keycap
 * emoji (FE0F + U+20E3). "Glitch text" stacks dozens; the rest are dropped.
 */
export const MAX_STACKED_MARKS = 3;

export const PLAYER_NAME_TOO_LONG_MESSAGE = `Names can be up to ${MAX_PLAYER_NAME} characters.`;

type SegmenterLike = { segment(input: string): Iterable<{ segment: string }> };

let segmenter: SegmenterLike | null | undefined;

const EXTRA_MARKS = new RegExp(`(\\p{M}{${MAX_STACKED_MARKS}})\\p{M}+`, "gu");

/** Drop combining marks beyond MAX_STACKED_MARKS in a row ("glitch text"). */
export function stripExcessMarks(str: string): string {
  return str.replace(EXTRA_MARKS, "$1");
}

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  const Seg = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: "grapheme" }) => SegmenterLike }).Segmenter;
  segmenter = typeof Seg === "function" ? new Seg(undefined, { granularity: "grapheme" }) : null;
  return segmenter;
}

// Fallback for runtimes without Intl.Segmenter (iOS 14.4 and older,
// Firefox before 125): code points, with the common joiners glued on so a
// flag, skin tone, family or accent mark stays one character.
const GLUES_TO_PREV = /^[\p{M}\u200D\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]$/u;
const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u;

function fallbackSplit(str: string): string[] {
  const out: string[] = [];
  for (const cp of str) {
    const last = out.length - 1;
    if (last >= 0) {
      const prev = out[last];
      const pairsFlag = REGIONAL_INDICATOR.test(cp) && REGIONAL_INDICATOR.test(prev);
      if (GLUES_TO_PREV.test(cp) || prev.endsWith("\u200D") || pairsFlag) {
        out[last] = prev + cp;
        continue;
      }
    }
    out.push(cp);
  }
  return out;
}

/** Split a string into user-visible characters. */
export function splitNameChars(str: string): string[] {
  const seg = getSegmenter();
  if (seg) return Array.from(seg.segment(str), (s) => s.segment);
  return fallbackSplit(str);
}

/** How many characters a person sees in `str`. */
export function countNameChars(str: string): number {
  return splitNameChars(str).length;
}

/**
 * Strip extra stacked marks, then keep at most `max` visible characters
 * and MAX_PLAYER_NAME_RAW raw units (never splits an emoji).
 */
export function clampPlayerName(str: string, max: number = MAX_PLAYER_NAME): string {
  const cleaned = stripExcessMarks(str);
  const chars = splitNameChars(cleaned);
  if (chars.length <= max && cleaned.length <= MAX_PLAYER_NAME_RAW) return cleaned;
  let out = "";
  for (const ch of chars.slice(0, max)) {
    if (out.length + ch.length > MAX_PLAYER_NAME_RAW) break;
    out += ch;
  }
  return out;
}

/** True when the (already trimmed and stripped) name fits the cap. */
export function playerNameFits(str: string): boolean {
  return countNameChars(str) <= MAX_PLAYER_NAME && str.length <= MAX_PLAYER_NAME_RAW;
}

/** True when not even one more plain letter would fit. */
export function playerNameIsFull(str: string): boolean {
  return countNameChars(str) >= MAX_PLAYER_NAME || str.length >= MAX_PLAYER_NAME_RAW;
}

/**
 * What a name box should hold after an edit. When the box was already full
 * and the edit would push it over, the edit is ignored (like a native
 * maxLength) instead of dropping the last character. From under the cap
 * (a paste, a prefill) the new text is cut to fit.
 */
export function applyNameEdit(prev: string, next: string): string {
  const cleaned = stripExcessMarks(next);
  if (playerNameFits(cleaned)) return cleaned;
  if (playerNameIsFull(prev)) return prev;
  return clampPlayerName(cleaned);
}

/**
 * onChange handler for a name box (phone join screen and host latecomer
 * box). When an edit is ignored because the box is full, the old text and
 * cursor position are put back directly, so the cursor doesn't jump to the
 * end the way it would if React rewrote the value.
 */
export function handleNameInputChange(
  input: HTMLInputElement,
  prev: string,
  setName: (value: string) => void,
): void {
  const next = input.value;
  const value = applyNameEdit(prev, next);
  if (value === prev && next !== prev) {
    const pos = input.selectionStart ?? next.length;
    const caret = Math.min(prev.length, Math.max(0, pos - (next.length - prev.length)));
    input.value = prev;
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // Some input types don't support selection; the value is what matters.
    }
    return;
  }
  setName(value);
}
