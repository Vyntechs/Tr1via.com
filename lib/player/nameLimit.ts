// Player name length cap, shared by the phone, the host's latecomer modal
// and the API routes so all three agree on what "16 characters" means.
//
// Characters are counted the way people see them: one emoji (even a
// multi-part one like a family or a flag) counts as 1. We use
// Intl.Segmenter when the runtime has it and a stricter fallback otherwise
// (never counts fewer characters than the server). Plain-text limits like `maxLength` or zod's `.max()`
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

// Built at runtime so an older phone whose regex engine lacks a property
// gets `null` (and a stricter fallback) instead of a parse error that would
// stop the whole page from loading.
function safeRegExp(source: string, flags = "u"): RegExp | null {
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

const PICTOGRAPHIC = safeRegExp("^\\p{Extended_Pictographic}$");
const isPictographic = (cp: string | undefined): boolean => !!cp && !!PICTOGRAPHIC?.test(cp);

/**
 * Characters that show nothing or flip the direction of the text around
 * them: control characters, soft hyphen, zero-width space, word joiner and
 * invisible operators, byte-order mark, Hangul fillers (U+115F, U+1160,
 * U+3164, U+FFA0), Khmer invisible vowels, the blank Braille cell, and every
 * left-to-right / right-to-left mark, embedding, override and isolate.
 */
const INVISIBLE =
  /[\p{Cc}­؜ᅟᅠ឴឵᠎​‎‏‪-‮⁠-⁯⠀ㅤ﻿ﾠ]/gu;
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;
/** Parts that can sit between an emoji and its zero-width joiner. */
const EMOJI_TRAIL = /^[\p{Mn}\p{Me}\u{1F3FB}-\u{1F3FF}]$/u;
const ZWNJ = "‌";
const ZWJ = "‍";

/**
 * Remove invisible and direction-trick characters. Zero-width joiners stay
 * only where they do a real job: inside an emoji sequence (family,
 * profession, rainbow flag) or between letters of scripts that use them
 * (Sinhala, Persian, Hindi). Everywhere else they are dropped.
 */
export function stripInvisible(str: string): string {
  const cps = Array.from(str.replace(INVISIBLE, ""));
  if (!cps.includes(ZWJ) && !cps.includes(ZWNJ)) return cps.join("");
  const out: string[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp !== ZWJ && cp !== ZWNJ) {
      out.push(cp);
      continue;
    }
    const before = out[out.length - 1];
    const after = cps[i + 1];
    const betweenLetters =
      !!before && !!after && LETTER_OR_MARK.test(before) && LETTER_OR_MARK.test(after) && !/^\p{M}$/u.test(after);
    let inEmoji = false;
    if (cp === ZWJ && isPictographic(after)) {
      let j = out.length - 1;
      while (j >= 0 && EMOJI_TRAIL.test(out[j])) j--;
      inEmoji = isPictographic(out[j]);
    }
    if (betweenLetters || inEmoji) out.push(cp);
  }
  return out.join("");
}

/**
 * The one cleanup every name goes through, on the phone, in the host's box
 * and on the server: invisible and direction-trick characters removed, then
 * extra stacked marks. Trimming is left to the caller.
 */
export function cleanPlayerName(str: string): string {
  return stripExcessMarks(stripInvisible(str));
}

const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;

/** True when a (cleaned) name has at least one letter, digit, symbol or emoji. */
export function hasVisibleChar(str: string): boolean {
  return VISIBLE.test(str);
}

function getSegmenter(): SegmenterLike | null {
  if (segmenter !== undefined) return segmenter;
  const Seg = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: "grapheme" }) => SegmenterLike }).Segmenter;
  segmenter = typeof Seg === "function" ? new Seg(undefined, { granularity: "grapheme" }) : null;
  return segmenter;
}

// Fallback for runtimes without Intl.Segmenter (iOS 14.4 and older,
// Firefox before 125). It must never count fewer characters than the
// server, so it only joins pieces the server always joins, and counts
// anything it is unsure of as its own character:
//   - non-spacing and enclosing marks (accents, FE0F, keycap), skin tones,
//     emoji tag characters and a zero-width joiner join the one before;
//   - two flag letters pair into one flag;
//   - after a zero-width joiner, an emoji joins only when an emoji came
//     before the joiner (family, profession, rainbow flag).
// Spacing marks (some Hindi vowel signs), Hangul letter parts and the like
// count separately here, so a few names count higher on these old phones.
const GLUES_TO_PREV = /^[\p{Mn}\p{Me}‍\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]$/u;
const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u;
// The server never joins anything onto a control or format character, and
// treats some unassigned code points the same way; an unassigned one is
// never glued onto here (also covers characters too new for this phone).
const NEVER_GLUED_ONTO = /^[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]$/u;

function emojiBeforeJoiner(cluster: string): boolean {
  const cps = Array.from(cluster);
  if (cps.pop() !== ZWJ) return false;
  let j = cps.length - 1;
  while (j >= 0 && EMOJI_TRAIL.test(cps[j])) j--;
  return isPictographic(cps[j]);
}

function fallbackSplit(str: string): string[] {
  const out: string[] = [];
  for (const cp of str) {
    const last = out.length - 1;
    if (last >= 0 && !NEVER_GLUED_ONTO.test(out[last])) {
      const prev = out[last];
      const glues =
        GLUES_TO_PREV.test(cp) ||
        (REGIONAL_INDICATOR.test(cp) && REGIONAL_INDICATOR.test(prev)) ||
        (isPictographic(cp) && emojiBeforeJoiner(prev));
      if (glues) {
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
 * Clean the name (cleanPlayerName), then keep at most `max` visible characters
 * and MAX_PLAYER_NAME_RAW raw units (never splits an emoji).
 */
export function clampPlayerName(str: string, max: number = MAX_PLAYER_NAME): string {
  const cleaned = cleanPlayerName(str);
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

export interface NameEdit {
  value: string;
  /** Where the cursor goes: right after the inserted text that was kept. */
  caret: number;
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * What a name box should hold after the browser applied an edit (a
 * keystroke, a paste, an autocorrect, a finished Japanese/Chinese/Korean
 * conversion). Works like the browser's own maxLength: the text the player
 * already had is never cut; only the newly inserted piece is shortened so
 * the total fits, and the cursor lands right after what was kept.
 *
 * `caret` is the cursor position the browser reports after the edit (the
 * end of the inserted text). It tells apart "aaa" -> "aaaa" edits; without
 * it the common start and end of the two strings are used.
 */
export function fitNameEdit(prev: string, next: string, caret?: number | null): NameEdit {
  const cleaned = cleanPlayerName(next);
  if (playerNameFits(cleaned)) {
    const at = caret == null ? cleaned.length : cleanPlayerName(next.slice(0, caret)).length;
    return { value: cleaned, caret: Math.min(at, cleaned.length) };
  }

  // Find the inserted piece: next = head + inserted + tail, where head and
  // tail are text the box already held.
  let tailLen: number;
  if (caret != null && caret >= 0 && caret <= next.length && next.length - caret <= prev.length && prev.endsWith(next.slice(caret))) {
    tailLen = next.length - caret;
  } else {
    tailLen = 0;
    const most = Math.min(prev.length, next.length);
    while (tailLen < most && prev[prev.length - 1 - tailLen] === next[next.length - 1 - tailLen]) tailLen++;
  }
  const headMax = Math.min(prev.length, next.length) - tailLen;
  let headLen = 0;
  while (headLen < headMax && prev[headLen] === next[headLen]) headLen++;
  // Never split an emoji's two halves between head, insert and tail.
  if (headLen > 0 && isHighSurrogate(next.charCodeAt(headLen - 1))) headLen--;
  if (tailLen > 0 && isLowSurrogate(next.charCodeAt(next.length - tailLen))) tailLen--;

  const head = next.slice(0, headLen);
  const inserted = next.slice(headLen, next.length - tailLen);
  const tail = next.slice(next.length - tailLen);

  // The text that was already there doesn't fit by itself (shouldn't
  // happen, the box always holds a fitting name): cut from the end.
  if (!playerNameFits(cleanPlayerName(head + tail))) {
    const value = clampPlayerName(next);
    return { value, caret: value.length };
  }

  let kept = "";
  for (const ch of splitNameChars(inserted)) {
    if (!playerNameFits(cleanPlayerName(head + kept + ch + tail))) break;
    kept += ch;
  }
  const value = cleanPlayerName(head + kept + tail);
  return { value, caret: Math.min(cleanPlayerName(head + kept).length, value.length) };
}

/** fitNameEdit without the cursor: just the text the box should hold. */
export function applyNameEdit(prev: string, next: string, caret?: number | null): string {
  return fitNameEdit(prev, next, caret).value;
}
