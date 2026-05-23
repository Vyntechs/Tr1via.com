// Bricolage Grotesque — the "hero" display voice. Reserved for big editorial
// moments (lobby headlines, winner reveal, intermission, finale). Never used
// for body copy. Geist handles all the workhorse type.

import type { CSSProperties, ReactNode } from "react";

export interface DisplayProps {
  children: ReactNode;
  size?: number;
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
        fontSize: size,
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
