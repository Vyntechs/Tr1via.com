// TV — SECTION COMPLETE overlay.
//
// Mounts above the Jeopardy grid in the picking window between sections,
// floods the screen in the just-cleared category's color, holds the topic
// name big, and dissolves after ~1.8 s. The host then taps any cell in
// any remaining topic on the grid behind to pick the next question.
//
// Owned timing: the parent (HostLiveConsole or /tv/[code]) decides when to
// mount/unmount via useSectionCompleteCelebration. This component handles
// only the visual treatment; the keyframe duration matches the hook's
// CELEBRATION_DURATION_MS (1800 ms).
//
// `staticHold` is for the /dev/tv gallery — holds the frame at peak so
// designers can screenshot.

"use client";

import { Display, Eyebrow } from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";

export interface TVSectionCompleteProps {
  /** Display name of the topic that just cleared. */
  topicName: string;
  /** Hex from categories.color; falls back to categoryColor(topicName). */
  color?: string | null;
  /** Gallery affordance — holds the frame at peak opacity for screenshots. */
  staticHold?: boolean;
}

export function TVSectionComplete({
  topicName,
  color,
  staticHold = false,
}: TVSectionCompleteProps) {
  const cc = color ?? categoryColor(topicName);
  const animClass = staticHold ? "tv-sc-static" : "tv-sc-anim";
  return (
    <div
      data-testid="tv-section-complete"
      className={animClass}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: hexToRgba(cc, 0.92),
        color: "#0E0805",
        zIndex: 30,
        pointerEvents: "none",
      }}
    >
      <Eyebrow color="rgba(14,8,5,.6)" size={15}>
        SECTION COMPLETE
      </Eyebrow>
      <Display
        size="clamp(72px, 14vh, 168px)"
        weight={700}
        color="#0E0805"
        tracking={-0.025}
        style={{
          textAlign: "center",
          padding: "0 64px",
          lineHeight: 0.94,
        }}
      >
        {topicName}
      </Display>
      <div
        className="tv-sc-underline"
        aria-hidden="true"
        style={{
          width: 240,
          height: 5,
          background: "#0E0805",
          borderRadius: 3,
          transformOrigin: "center",
          opacity: 0.78,
        }}
      />
      <style>{`
        @keyframes tv-sc-in-and-out {
          0%   { opacity: 0; transform: scale(.94); }
          14%  { opacity: 1; transform: scale(1); }
          86%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(.97); }
        }
        @keyframes tv-sc-underline-grow {
          0%   { transform: scaleX(0); }
          14%  { transform: scaleX(0); }
          44%  { transform: scaleX(1); }
          100% { transform: scaleX(1); }
        }
        .tv-sc-anim {
          animation: tv-sc-in-and-out 1800ms cubic-bezier(.2,.7,.3,1) forwards;
        }
        .tv-sc-anim .tv-sc-underline {
          animation: tv-sc-underline-grow 1800ms cubic-bezier(.2,.7,.3,1) forwards;
        }
        .tv-sc-static {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .tv-sc-anim {
            animation: tv-sc-fade-only 1800ms linear forwards;
          }
          @keyframes tv-sc-fade-only {
            0%, 100% { opacity: 0; }
            10%, 90% { opacity: 1; }
          }
          .tv-sc-anim .tv-sc-underline {
            animation: none;
            transform: scaleX(1);
          }
        }
      `}</style>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "");
  if (cleaned.length !== 6) return hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
