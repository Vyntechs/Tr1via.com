// November · the winner moment: a wishbone snaps in two above the champion's
// name and autumn leaves burst out across the night field (Figma "9 Winner").
// Decoration only: no text, nothing to click. With reduced motion it shows the
// snapped wishbone and the leaves at rest, no movement. The wishbone is drawn
// (thick bone arms, a knob at the top) so it reads from across the bar, and
// the leaves rest above or right of the winner's name, never on it.

"use client";

import type { CSSProperties } from "react";
import { NOV_WINNER_LEAVES, NOV_WISHBONE_BOX } from "@/lib/experience/november/tvLook";

const leaf = (n: number) => `/themes/november/leaves/leaf-${n}.webp`;
const { x: WB_X, y: WB_Y, w: WB_W, h: WB_H } = NOV_WISHBONE_BOX;

const CSS = `
@keyframes nov-wish-left { 0% { transform: rotate(0deg) translateX(0) } 18% { transform: rotate(0deg) translateX(0) } 30% { transform: rotate(-11deg) translateX(-14px) } 100% { transform: rotate(-14deg) translateX(-18px) } }
@keyframes nov-wish-right { 0% { transform: rotate(0deg) translateX(0) } 18% { transform: rotate(0deg) translateX(0) } 30% { transform: rotate(11deg) translateX(14px) } 100% { transform: rotate(14deg) translateX(18px) } }
@keyframes nov-snap { 0%, 22% { opacity: 0; transform: scale(.3) } 30% { opacity: 1; transform: scale(1.5) } 100% { opacity: .55; transform: scale(1) } }
@keyframes nov-leaf { 0%, 24% { opacity: 0; transform: translate(var(--fx), var(--fy)) rotate(0deg) scale(.4) } 34% { opacity: 1 } 100% { opacity: .9; transform: translate(0, 0) rotate(var(--spin)) scale(1) } }
@media (prefers-reduced-motion: reduce) { [data-nov-burst] * { animation: none !important } }
[data-world-field="still"] [data-nov-burst] * { animation: none !important }
`;

/** One half of the drawn wishbone: a thick bone arm (dark edge, cream bone,
 *  soft highlight). The knob at the joint cracks in two with it. */
function WishboneHalf({ side }: { side: "left" | "right" }) {
  const left = side === "left";
  // Arm from the top joint (110, 30) bowing down and out to a foot that
  // kicks outward, like a real wishbone.
  const arm = left ? "M106 34 C 92 58, 70 88, 52 116 L 34 124" : "M114 34 C 128 58, 150 88, 168 116 L 186 124";
  return (
    <svg
      width={WB_W}
      height={WB_H}
      viewBox={`0 0 ${WB_W} ${WB_H}`}
      style={{
        position: "absolute",
        left: WB_X,
        top: WB_Y,
        overflow: "visible",
        transformOrigin: left ? "52px 116px" : "168px 116px",
        // Snapped at rest, so reduced motion (no animation) still shows the snap.
        transform: left ? "rotate(-14deg) translateX(-18px)" : "rotate(14deg) translateX(18px)",
        animation: `nov-wish-${side} 2.6s cubic-bezier(.2,.8,.2,1) both`,
        // Each half shows only its own side of the joint.
        clipPath: left ? "inset(-20% 50% -20% -20%)" : "inset(-20% -20% -20% 50%)",
        filter: "drop-shadow(0 6px 10px rgba(10,5,2,.55))",
      }}
    >
      <path d={arm} fill="none" stroke="#5A3416" strokeWidth={36} strokeLinecap="round" strokeLinejoin="round" />
      <path d={arm} fill="none" stroke="#EAD3A0" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" />
      <path d={arm} fill="none" stroke="#FFF3D6" strokeWidth={7} strokeLinecap="round" opacity={0.7} transform="translate(-3 -3)" />
      <circle cx={110} cy={26} r={25} fill="#5A3416" />
      <circle cx={110} cy={26} r={19} fill="#EAD3A0" />
      <circle cx={104} cy={20} r={6} fill="#FFF3D6" opacity={0.75} />
    </svg>
  );
}

export function NovemberWinnerBurst() {
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
      {NOV_WINNER_LEAVES.map(([x, y, size, n, spin], i) => (
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
            ["--fy" as string]: `${120 - y}px`,
            ["--spin" as string]: `${spin}deg`,
            transform: `rotate(${spin}deg)`,
            animation: `nov-leaf 2.8s cubic-bezier(.15,.8,.25,1) both`,
          } as CSSProperties}
        />
      ))}
      <WishboneHalf side="left" />
      <WishboneHalf side="right" />
      <div
        style={{
          position: "absolute",
          left: WB_X + WB_W / 2 - 24,
          top: WB_Y + 2,
          width: 48,
          height: 48,
          borderRadius: 99,
          background: "radial-gradient(circle, rgba(255,226,150,.95), rgba(255,190,96,0) 70%)",
          animation: "nov-snap 2.6s ease-out both",
        }}
      />
    </div>
  );
}
