// Internal shared helpers for the question-generation flow components.
// Not re-exported from the barrel — only the HostGen* screens themselves
// consume these. Two helpers:
//   - StockImage: a striped placeholder where a real Pexels photo will go.
//   - DifficultyBar: 7-segment difficulty meter, lit to the question's rating.
//
// In production StockImage will be replaced with the real Pexels-backed
// component; for the static gallery we keep dependencies zero (no external
// network requests for image previews).

"use client";

import type { CSSProperties, ReactNode } from "react";

export interface StockImageProps {
  seed?: string;
  /** Real photo URL (e.g. Pexels). When set, renders an <img>; when null,
   *  falls back to the seeded striped placeholder. */
  src?: string | null;
  height?: number | string;
  radius?: string;
  caption?: string | null;
  children?: ReactNode;
  style?: CSSProperties;
}

/**
 * Photo slot. When `src` is provided (production path — Pexels-backed) it
 * renders the actual image with object-fit:cover. When `src` is null/empty
 * (demo gallery, mid-generation, or photo attach failed) it falls back to
 * a seeded striped placeholder so adjacent slots read as distinct.
 * A subtle bottom vignette stays on top in both cases so captions and
 * overlays remain legible.
 */
export function StockImage({
  seed = "p1",
  src,
  height = 168,
  radius = "10px 10px 0 0",
  caption,
  children,
  style = {},
}: StockImageProps) {
  // Deterministic hash so the same seed always yields the same hue.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const hueB = (hue + 28) % 360;
  const hasSrc = typeof src === "string" && src.length > 0;
  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: radius,
        position: "relative",
        overflow: "hidden",
        background: hasSrc
          ? "#222"
          : `repeating-linear-gradient(135deg, hsl(${hue}deg 38% 28%) 0 14px, hsl(${hueB}deg 32% 22%) 14px 28px), #222`,
        ...style,
      }}
    >
      {hasSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt=""
          loading="lazy"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
      {/* Subtle bottom vignette so captions and overlays sit cleanly */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0) 55%)",
          pointerEvents: "none",
        }}
      />
      {caption && (
        <span
          style={{
            position: "absolute",
            bottom: 10,
            left: 12,
            fontFamily: "var(--font-mono)",
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: "0.08em",
            color: "rgba(255,255,255,.85)",
            textTransform: "uppercase",
          }}
        >
          {caption}
        </span>
      )}
      {children}
    </div>
  );
}

export interface DifficultyBarProps {
  value: number;
  color: string;
  max?: number;
  height?: number;
}

/** 7-segment difficulty meter. Lit segments use `color`, dim ones a faint grey. */
export function DifficultyBar({ value, color, max = 7, height = 4 }: DifficultyBarProps) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 14,
            height,
            borderRadius: 2,
            background: i < value ? color : "rgba(127,127,127,.18)",
          }}
        />
      ))}
    </div>
  );
}
