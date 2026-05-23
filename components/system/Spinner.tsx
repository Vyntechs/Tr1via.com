// Spinner — a tasteful loading indicator.
//
// Pure CSS: a 270-degree arc on a transparent ring, rotating continuously
// via the `tr1via-spin` keyframe in globals.css. Honors prefers-reduced-
// motion (the global reduced-motion rule shortens the animation, so the
// arc just sits stationary — which still reads as a circular "in-progress"
// indicator without spinning).
//
// Three sizes (sm/md/lg). Color defaults to var(--accent). Has role="status"
// so AT users hear it as a live update; the visible glyph stays decorative.

"use client";

import type { CSSProperties } from "react";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Stroke + arc color. Defaults to the current theme accent. */
  color?: string;
  /** Ring color (the un-lit portion). Defaults to a soft line. */
  trackColor?: string;
  /** AT label. Defaults to "Loading". */
  label?: string;
  style?: CSSProperties;
}

const SIZE_PX: Record<SpinnerSize, { box: number; ring: number }> = {
  sm: { box: 18, ring: 2 },
  md: { box: 28, ring: 2.5 },
  lg: { box: 48, ring: 3.5 },
};

export function Spinner({
  size = "md",
  color = "var(--accent)",
  trackColor = "var(--line)",
  label = "Loading",
  style,
}: SpinnerProps) {
  const sz = SIZE_PX[size];
  return (
    <span
      role="status"
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: sz.box,
        height: sz.box,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: sz.box,
          height: sz.box,
          borderRadius: "50%",
          // Set each side explicitly so React's rerender doesn't warn about
          // the shorthand `border` colliding with non-shorthand overrides.
          borderStyle: "solid",
          borderWidth: sz.ring,
          borderTopColor: color,
          borderRightColor: color,
          borderBottomColor: trackColor,
          borderLeftColor: trackColor,
          // `tr1via-spin` is defined in app/globals.css. The 800ms-per-turn
          // budget respects the global motion rule for a single rotation.
          animation: "tr1via-spin 800ms linear infinite",
          boxSizing: "border-box",
        }}
      />
      <span
        // Visually hidden text so the status label is announced even if the
        // ring is invisible to AT (the role=status alone reads as an empty
        // live region in some clients).
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {label}
      </span>
    </span>
  );
}
