// 1-pixel divider, low opacity by default. Wrapper for the standard
// "horizontal hairline" used between sections.

import type { CSSProperties } from "react";

export interface RuleProps {
  color?: string;
  style?: CSSProperties;
}

export function Rule({ color, style }: RuleProps) {
  return (
    <div
      style={{
        height: 1,
        background: color ?? "currentColor",
        opacity: 0.14,
        ...style,
      }}
    />
  );
}
