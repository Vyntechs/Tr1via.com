// Tabular-nums monospace numerals. Reserved for live numbers (scores, timers,
// room codes, point counts). Never used for body text — that's Geist (sans).

import type { CSSProperties, ReactNode } from "react";

export interface NumericProps {
  children: ReactNode;
  size?: number;
  weight?: number;
  color?: string;
  tracking?: number;
  style?: CSSProperties;
}

export function Numeric({
  children,
  size = 16,
  weight = 500,
  color,
  tracking = -0.015,
  style,
}: NumericProps) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        fontWeight: weight,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: `${tracking}em`,
        color: color ?? "currentColor",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
