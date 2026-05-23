// A chunky monospace numeric chip with " pts" suffix in a smaller weight.
// Used wherever a question's point value is shown.
//   <PointTag value={500} color={categoryColor("Music")} />

import type { CSSProperties } from "react";

export type PointTagSize = "sm" | "md" | "lg" | "xl";

const SIZE_PRESETS: Record<PointTagSize, { f: number; py: number; px: number; r: number }> = {
  sm: { f: 18, py: 4,  px: 10, r: 6 },
  md: { f: 28, py: 6,  px: 14, r: 8 },
  lg: { f: 48, py: 10, px: 20, r: 12 },
  xl: { f: 80, py: 14, px: 28, r: 14 },
};

export interface PointTagProps {
  value: number;
  /** Background color. Typically the category color. */
  color?: string;
  /** Text color (default near-black). */
  ink?: string;
  size?: PointTagSize;
  style?: CSSProperties;
}

export function PointTag({ value, color = "#FF6A3D", ink = "#0E0805", size = "md", style }: PointTagProps) {
  const sz = SIZE_PRESETS[size];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: sz.f * 0.18,
        padding: `${sz.py}px ${sz.px}px`,
        borderRadius: sz.r,
        background: color,
        color: ink,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        fontSize: sz.f,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      <span>{value}</span>
      <span style={{ fontSize: sz.f * 0.34, opacity: 0.6, fontWeight: 500, letterSpacing: 0 }}>pts</span>
    </span>
  );
}
