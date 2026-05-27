// useAutoFitText — pick the largest font-size from a candidate list that lets
// the text fit inside its container without overflow.
//
// Why this exists: a question prompt on a player's phone needs to be (a) as
// big as possible so it's readable from arm's length in a noisy bar and
// (b) never truncated with "..." or overflow the screen. A fixed font-size
// can't hit both targets across a 21-char prompt and a 163-char prompt on
// devices from iPhone SE to iPhone 15 Pro Max.
//
// How it works: caller renders the text inside a container (the "frame") and
// the hook attaches refs to both. On mount + on container/text resize, we
// walk the candidate font-sizes from largest to smallest, applying each to
// the text element, and keep the first one whose rendered size fits. We
// debounce via rAF so a measurement loop never blocks paint.
//
// Bounds discipline: bisect over a *fixed* set of candidates (not a 1px
// search) — keeps perf predictable, avoids subpixel oscillation on devices
// with sub-pixel font rendering, and makes test assertions deterministic.

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface UseAutoFitTextOptions {
  /** Candidate font-sizes in CSS pixels. Defaults: 16, 18, 20, 22, 24, 26, 28. */
  sizes?: readonly number[];
  /**
   * Lower bound — if the text doesn't fit even at the smallest size, we still
   * apply this size (text will wrap to more lines; the container can scroll
   * or shrink-wrap, whichever its CSS allows). Default: smallest size.
   */
  minSize?: number;
  /**
   * Vertical safety margin (px) subtracted from container height during the
   * fit check. Guards against off-by-one between scrollHeight and clientHeight
   * caused by line-height fractional rendering. Default: 2.
   */
  fitTolerance?: number;
  /** Disable measurement (use the largest size as-is). Useful in tests. */
  disabled?: boolean;
}

/**
 * Default candidate font-sizes for player question prompts:
 *   16 → smallest readable from arm's length
 *   28 → biggest size that doesn't dominate the screen on a 393px-wide phone
 */
const DEFAULT_SIZES = [16, 17, 18, 20, 22, 24, 26, 28] as const;

export function useAutoFitText({
  sizes = DEFAULT_SIZES,
  minSize,
  fitTolerance = 2,
  disabled = false,
}: UseAutoFitTextOptions = {}) {
  const frameRef = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const sortedSizes = [...sizes].sort((a, b) => a - b);
  const floor = minSize ?? sortedSizes[0] ?? 16;
  const ceiling = sortedSizes[sortedSizes.length - 1] ?? 16;
  const [fontSize, setFontSize] = useState<number>(ceiling);

  // Use a layout effect for the *initial* measurement so the user never sees
  // a flash of mis-sized text. Subsequent re-runs from the ResizeObserver
  // are fine to be effects.
  useLayoutEffect(() => {
    if (disabled) {
      setFontSize(ceiling);
      return;
    }
    const frame = frameRef.current;
    const text = textRef.current;
    if (!frame || !text) return;

    let raf = 0;

    function measure() {
      // Cancel any in-flight measure — we only care about the latest layout.
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!frame || !text) return;
        const frameHeight = frame.clientHeight;
        // Edge case: container has 0 height (not yet laid out). Bail; the
        // ResizeObserver below will retry once the container has a size.
        if (frameHeight <= 0) return;

        let bestSize = floor;
        // Walk from largest → smallest; first one that fits wins.
        for (let i = sortedSizes.length - 1; i >= 0; i--) {
          const candidate = sortedSizes[i];
          text.style.fontSize = `${candidate}px`;
          // Force a synchronous layout read; scrollHeight reflects the
          // actual content height including wrapped lines.
          const contentHeight = text.scrollHeight;
          if (contentHeight <= frameHeight + fitTolerance) {
            bestSize = candidate;
            break;
          }
        }
        // Pin the imperative inline style to the winning size. Don't clear
        // it: if `setFontSize` happens to match React's current state, React
        // will skip the re-render and the inline style would be lost. By
        // writing `bestSize` directly we guarantee the DOM matches state
        // regardless of whether React reconciles.
        text.style.fontSize = `${bestSize}px`;
        setFontSize(bestSize);
      });
    }

    measure();

    // Watch both the frame (its size can change on orientation flip) and
    // the text node (its content can change between questions).
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    ro.observe(text);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // We intentionally re-run when the *set* of candidate sizes changes.
    // sortedSizes is derived from `sizes` so we depend on the stringified key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, ceiling, floor, fitTolerance, sortedSizes.join(",")]);

  return { frameRef, textRef, fontSize };
}

/**
 * Pure helper for the fit policy — used by unit tests where jsdom can't
 * actually lay out text. Given a list of candidate sizes and a function that
 * reports rendered height per size, returns the largest size that fits.
 */
export function pickFittingSize(
  sizes: readonly number[],
  frameHeight: number,
  measureAt: (size: number) => number,
  fitTolerance = 2,
): number {
  if (sizes.length === 0) return 0;
  const sorted = [...sizes].sort((a, b) => a - b);
  const floor = sorted[0];
  if (frameHeight <= 0) return floor;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const candidate = sorted[i];
    const height = measureAt(candidate);
    if (height <= frameHeight + fitTolerance) {
      return candidate;
    }
  }
  return floor;
}
