// A fixed design box, scaled to fit wherever it lands.
//
// October's re-laid-out TV screens (lobby, between games, winner) are drawn
// at the exact pixel positions of the Figma frames, on a 1600×680 box (the
// TV's top part; the pumpkin patch owns the rest). On the venue TV that box
// is exactly the space available, so it renders 1:1. On the host's laptop
// console, where the TV panel is whatever size the window is, the same
// composition scales down as one picture instead of reflowing.
//
// Measures LAYOUT size (offsetWidth/Height, ResizeObserver contentRect),
// never getBoundingClientRect: the venue TV and the host's phone preview
// already scale the whole stage, and the on-screen size would scale it twice.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export const OCTOBER_STAGE_W = 1600;
export const OCTOBER_STAGE_H = 680;

export function fitScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(width / OCTOBER_STAGE_W, height / OCTOBER_STAGE_H);
}

export function FitStage({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const apply = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const next = fitScale(width, height);
      setScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
    };
    const first = window.setTimeout(() => apply(frame.offsetWidth, frame.offsetHeight), 0);
    if (typeof ResizeObserver === "undefined") return () => window.clearTimeout(first);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    observer.observe(frame);
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={frameRef}
      data-testid="october-fit-stage"
      data-fit-scale={scale.toFixed(3)}
      // Content may spill a few pixels into the patch strip, as in the design.
      style={{ position: "relative", flex: 1, minHeight: 0, width: "100%", overflow: "visible" }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          width: OCTOBER_STAGE_W,
          height: OCTOBER_STAGE_H,
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: "top center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
