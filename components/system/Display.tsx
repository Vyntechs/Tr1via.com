// Bricolage Grotesque — the "hero" display voice. Reserved for big editorial
// moments (lobby headlines, winner reveal, intermission, finale). Never used
// for body copy. Geist handles all the workhorse type.

import type { CSSProperties, ReactNode } from "react";

export interface DisplayProps {
  children: ReactNode;
  /** Pixel size as a number, or any CSS length string (e.g. `"clamp(80px, 16vh, 188px)"`)
   *  for callers that need the headline to respond to viewport. */
  size?: number | string;
  color?: string;
  weight?: number;
  tracking?: number;
  italic?: boolean;
  style?: CSSProperties;
}

export function Display({
  children,
  size = 96,
  color,
  weight = 600,
  tracking = -0.04,
  italic = false,
  style,
}: DisplayProps) {
  return (
    <span
      style={{
        fontFamily: "var(--font-display)",
        fontOpticalSizing: "auto",
        fontWeight: weight,
        fontStretch: "85%",
        fontStyle: italic ? "italic" : "normal",
        fontSize: typeof size === "number" ? size : size,
        letterSpacing: `${tracking}em`,
        lineHeight: 0.92,
        color: color ?? "currentColor",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
