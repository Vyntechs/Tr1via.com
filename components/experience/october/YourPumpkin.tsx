// October · "your pumpkin" — the player's own jack-o'-lantern on their phone,
// the same one that sits in the patch on the venue TV.
//
//   waiting  unlit, sits above the answers        (shivers in the last 5 s)
//   lit      lights the instant you lock in
//   blaze    right answer
//   smoke    wrong answer: sags and puffs smoke
//   toppled  time ran out before you answered
//
// Pure decoration with its own crash guard: if it fails it disappears and
// the screen it sits on carries on. Motion is slow or small, and the app's
// reduced-motion rule stills it.

"use client";

import { useMemo, type CSSProperties } from "react";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import type { PumpkinMood } from "@/lib/experience/october/patch";
import {
  PUMPKIN_BLAZE,
  PUMPKIN_LIT,
  PUMPKIN_SMOKE_BODY,
  PUMPKIN_WAITING,
  artUrl,
  type OctoberArt,
} from "./art";

export interface YourPumpkinProps {
  mood: PumpkinMood;
  /** Height of the art box in px (the pumpkin fills its lower ~60%). */
  size: number;
  /** Shiver (the last five seconds, still unanswered). */
  shiver?: boolean;
  style?: CSSProperties;
}

const ART: Record<PumpkinMood, OctoberArt> = {
  waiting: PUMPKIN_WAITING,
  lit: PUMPKIN_LIT,
  blaze: PUMPKIN_BLAZE,
  smoke: PUMPKIN_SMOKE_BODY,
  toppled: PUMPKIN_WAITING,
};

export function YourPumpkin(props: YourPumpkinProps) {
  return (
    <ThemeLayerBoundary name="october:your-pumpkin">
      <YourPumpkinArt {...props} />
    </ThemeLayerBoundary>
  );
}

function YourPumpkinArt({ mood, size, shiver = false, style }: YourPumpkinProps) {
  const url = useMemo(() => artUrl(ART[mood]), [mood]);
  const width = (size * 160) / 200;

  const motion: CSSProperties =
    mood === "toppled"
      ? { animation: "tr1via-oct-tip .5s cubic-bezier(.5,0,.4,1) both", transformOrigin: "50% 78%" }
      : shiver && mood === "waiting"
        ? { animation: "tr1via-oct-shiver .16s ease-in-out infinite", transformOrigin: "50% 78%" }
        : mood === "blaze"
          ? { animation: "tr1via-oct-flame .9s ease-in-out infinite", transformOrigin: "50% 78%" }
          : {};
  const glow: CSSProperties =
    mood === "lit" || mood === "blaze"
      ? { animation: "tr1via-oct-light .3s ease-out both, tr1via-oct-breathe 2.6s ease-in-out .3s infinite" }
      : {};

  return (
    <span
      aria-hidden
      data-testid="your-pumpkin"
      data-pumpkin-mood={mood}
      style={{
        position: "relative",
        display: "inline-block",
        width,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      <span style={{ position: "absolute", inset: 0, display: "block", ...motion }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          width={width}
          height={size}
          style={{ display: "block", width, height: size, ...glow }}
        />
      </span>
      {mood === "smoke" ? (
        <>
          <Puff size={size} delay={0} left="54%" />
          <Puff size={size} delay={0.7} left="44%" />
        </>
      ) : null}
    </span>
  );
}

function Puff({ size, delay, left }: { size: number; delay: number; left: string }) {
  const d = size * 0.3;
  return (
    <span
      style={{
        position: "absolute",
        left,
        top: size * 0.22,
        width: d,
        height: d,
        borderRadius: "50%",
        background: "radial-gradient(closest-side, rgba(154,144,136,.7), rgba(154,144,136,0))",
        animation: `tr1via-oct-puff 2.4s ease-out ${delay}s infinite`,
        opacity: 0,
      }}
    />
  );
}
