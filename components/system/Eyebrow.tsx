// Tiny uppercase mono label above a heading. Used for "QUESTION 10 · GEOGRAPHY",
// "HOST · LINDA", section headers, etc. Designer's standard caps + tracking
// pattern. Always Geist Mono, always uppercase, always wide tracking.

import type { CSSProperties, ReactNode } from "react";

export interface EyebrowProps {
  children: ReactNode;
  color?: string;
  size?: number;
  weight?: number;
  style?: CSSProperties;
}

export function Eyebrow({ children, color, size = 11, weight = 600, style }: EyebrowProps) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: color ?? "currentColor",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
