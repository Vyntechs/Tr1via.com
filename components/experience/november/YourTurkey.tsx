// November · "your turkey": the player's own turkey on their phone, the same
// one that stands in the row on the venue TV.
//
//   arrive   walks in from the left (lobby), then idles
//   waiting  small life: head bob, peck, blink (tail down)
//   lit      tail fans the moment the answer locks in, and stays fanned
//   blaze    right answer: gobble, with a warm glow behind
//   smoke    wrong answer: droops, a few feathers drift off
//   toppled  no answer: dives into the hay bale (shown at the reveal only)
//
// One frame-sized box with the sprite strip as its background, stepped with
// background-position. Only one frame is ever painted or composited: the old
// strip-wide transformed layer (~21000 device px on a 3x phone) is past
// iPhone Safari's texture and memory limits. Reduced motion shows the TV's
// settled still frame.
// Pure decoration with its own crash guard: if it fails it disappears and
// the screen it sits on carries on.

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { featherUrl } from "@/lib/experience/november/harvest";
import {
  PHONE_WALK_MS,
  phoneTurkeyPlan,
  phoneTurkeyStripPx,
  phoneTurkeyUrl,
  stripKeyframes,
  type PhoneTurkeyMood,
} from "@/lib/experience/november/phone";

export interface YourTurkeyProps {
  mood: PhoneTurkeyMood;
  /** Side of the square art box in px (feet sit at ~91% of it). */
  size: number;
  style?: CSSProperties;
}

export function YourTurkey(props: YourTurkeyProps) {
  return (
    <ThemeLayerBoundary name="november:your-turkey">
      <YourTurkeyArt {...props} />
    </ThemeLayerBoundary>
  );
}

const KEYFRAMES = `
@keyframes tr1via-nov-walkin { from { transform: translateX(-170%); } to { transform: translateX(0); } }
@keyframes tr1via-nov-glow { 0%, 100% { opacity: .72; } 50% { opacity: 1; } }
@keyframes tr1via-nov-bloom { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: scale(1); } }
@keyframes tr1via-nov-feather {
  0% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(-90%, -210%) rotate(-150deg); }
}`;

function YourTurkeyArt({ mood, size: requestedSize, style }: YourTurkeyProps) {
  const reduced = usePrefersReducedMotion();
  // Whole pixels, so every frame step lands on a pixel and no neighbour
  // frame bleeds in at the box edge.
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? Math.round(requestedSize) : 0;
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (mood !== "arrive" || reduced) return;
    const id = window.setTimeout(() => setArrived(true), PHONE_WALK_MS);
    return () => window.clearTimeout(id);
  }, [mood, reduced]);

  const plan = phoneTurkeyPlan(mood, { reduced, arrived });
  const url = phoneTurkeyUrl(plan.anim, phoneTurkeyStripPx(plan.anim, size));
  const stripW = size * plan.frames;
  const walking = plan.anim === "walk";
  const shown = mood === "arrive" ? "waiting" : mood;

  // Explicit pixel keyframes (no var() inside @keyframes): Safari-safe.
  const run =
    plan.play === "still"
      ? null
      : plan.play === "loop"
        ? { kf: stripKeyframes(-stripW), secs: plan.frames / plan.fps, steps: plan.frames, tail: "infinite" }
        : { kf: stripKeyframes(-(plan.frames - 1) * size), secs: (plan.frames - 1) / plan.fps, steps: plan.frames - 1, tail: "both" };
  const strip: CSSProperties = run
    ? { animation: `${run.kf.name} ${run.secs}s steps(${run.steps}) ${run.tail}` }
    : { backgroundPosition: `${-plan.frame * size}px 0px` };

  return (
    <span
      aria-hidden
      data-testid="your-turkey"
      data-turkey-mood={shown}
      data-turkey-anim={plan.anim}
      style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0, ...style }}
    >
      <style href="tr1via-nov-phone-turkey" precedence="default">
        {KEYFRAMES}
      </style>
      {run ? (
        <style href={run.kf.name} precedence="default">
          {run.kf.css}
        </style>
      ) : null}
      {shown === "blaze" ? (
        <span
          style={{
            position: "absolute",
            inset: "-14% -18% 4%",
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(255,214,120,.62), rgba(255,170,70,.22) 60%, rgba(255,170,70,0))",
            animation: reduced ? undefined : "tr1via-nov-bloom .5s ease-out both, tr1via-nov-glow 2.6s ease-in-out .5s infinite",
          }}
        />
      ) : null}
      {/* contact shadow under the feet */}
      <span
        style={{
          position: "absolute",
          left: "22%",
          right: "22%",
          top: "86%",
          height: "9%",
          borderRadius: "50%",
          background: "radial-gradient(closest-side, rgba(20,10,5,.55), rgba(20,10,5,0))",
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          animation: walking ? `tr1via-nov-walkin ${PHONE_WALK_MS}ms cubic-bezier(.25,.6,.35,1) both` : undefined,
        }}
      >
        <span
          key={`${plan.anim}-${plan.play}`}
          data-testid="your-turkey-frame"
          style={{
            display: "block",
            width: size,
            height: size,
            backgroundImage: `url("${url}")`,
            backgroundSize: `${stripW}px ${size}px`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "0px 0px",
            ...strip,
          }}
        />
      </span>
      {shown === "smoke" && !reduced ? (
        <>
          <Feather n={1} size={size} left="30%" top="38%" delay={0.1} />
          <Feather n={3} size={size} left="20%" top="48%" delay={0.5} />
          <Feather n={2} size={size} left="36%" top="30%" delay={1.0} />
        </>
      ) : null}
    </span>
  );
}

function Feather({ n, size, left, top, delay }: { n: 1 | 2 | 3 | 4; size: number; left: string; top: string; delay: number }) {
  const d = Math.max(8, size * 0.17);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={featherUrl(n)}
      alt=""
      width={d}
      height={d}
      style={{
        position: "absolute",
        left,
        top,
        width: d,
        height: d,
        maxWidth: "none",
        opacity: 0,
        animation: `tr1via-nov-feather 3.4s ease-out ${delay}s 2 both`,
      }}
    />
  );
}
