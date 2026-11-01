// November · the winner moment: a wishbone snaps in two above the champion's
// name and autumn leaves burst out across the night field (Figma "9 Winner").
// Decoration only: no text, nothing to click. With reduced motion it shows the
// snapped wishbone and the leaves at rest, no movement.

"use client";

import type { CSSProperties } from "react";

const WISHBONE = "/themes/november/props/wishbone.png";
const leaf = (n: number) => `/themes/november/leaves/leaf-${n}.webp`;

// The Figma's burst, trimmed to 14 leaves: x, y, size (stage px), leaf, spin.
const LEAVES: Array<[number, number, number, number, number]> = [
  [242, 148, 88, 1, -40], [1125, 115, 87, 2, 30], [660, 19, 60, 3, 120], [162, 194, 71, 4, -90],
  [1090, 143, 69, 5, 60], [369, 114, 49, 6, -20], [1025, 163, 92, 1, 150], [1277, 254, 43, 2, -60],
  [1188, 6, 71, 3, 80], [340, 175, 68, 4, 200], [149, 217, 76, 5, -130], [888, 35, 57, 6, 45],
  [1503, 491, 60, 1, 100], [469, 153, 91, 2, -75],
];

const CSS = `
@keyframes nov-wish-left { 0% { transform: rotate(0deg) translateX(0) } 18% { transform: rotate(0deg) translateX(0) } 30% { transform: rotate(-9deg) translateX(-26px) } 100% { transform: rotate(-12deg) translateX(-34px) } }
@keyframes nov-wish-right { 0% { transform: rotate(0deg) translateX(0) } 18% { transform: rotate(0deg) translateX(0) } 30% { transform: rotate(9deg) translateX(26px) } 100% { transform: rotate(12deg) translateX(34px) } }
@keyframes nov-snap { 0%, 22% { opacity: 0; transform: scale(.3) } 30% { opacity: 1; transform: scale(1.5) } 100% { opacity: .55; transform: scale(1) } }
@keyframes nov-leaf { 0%, 24% { opacity: 0; transform: translate(var(--fx), var(--fy)) rotate(0deg) scale(.4) } 34% { opacity: 1 } 100% { opacity: .9; transform: translate(0, 0) rotate(var(--spin)) scale(1) } }
@media (prefers-reduced-motion: reduce) { [data-nov-burst] * { animation: none !important } }
`;

export function NovemberWinnerBurst() {
  // Halves: the Figma crops one wishbone picture into a left and right frame
  // (each 167×251 of a 279 px square) at x 615 and 874, y 34.
  const half = (side: "left" | "right"): CSSProperties => ({
    position: "absolute",
    left: side === "left" ? 615 : 874,
    top: 34,
    width: 167,
    height: 251,
    overflow: "hidden",
    transformOrigin: side === "left" ? "100% 100%" : "0% 100%",
    animation: `nov-wish-${side} 2.6s cubic-bezier(.2,.8,.2,1) both`,
  });
  return (
    <div
      data-nov-burst=""
      data-testid="november-winner-burst"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "50%",
        top: 0,
        width: 1600,
        height: 680,
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <style>{CSS}</style>
      {LEAVES.map(([x, y, size, n, spin], i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={leaf(n)}
          alt=""
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: size,
            height: size,
            ["--fx" as string]: `${800 - x - size / 2}px`,
            ["--fy" as string]: `${250 - y}px`,
            ["--spin" as string]: `${spin}deg`,
            transform: `rotate(${spin}deg)`,
            animation: `nov-leaf 2.8s cubic-bezier(.15,.8,.25,1) both`,
          } as CSSProperties}
        />
      ))}
      <div style={half("left")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WISHBONE} alt="" style={{ position: "absolute", left: 0, top: 0, width: 279, height: 279 }} />
      </div>
      <div style={half("right")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WISHBONE} alt="" style={{ position: "absolute", left: -115, top: 0, width: 279, height: 279 }} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 778,
          top: 226,
          width: 44,
          height: 44,
          borderRadius: 99,
          background: "radial-gradient(circle, rgba(255,226,150,.95), rgba(255,190,96,0) 70%)",
          animation: "nov-snap 2.6s ease-out both",
        }}
      />
    </div>
  );
}
