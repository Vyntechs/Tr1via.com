// A fixed design box, scaled to fit wherever it lands.
//
// October's re-laid-out TV screens (lobby, between games, winner) are drawn
// at the exact pixel positions of the Figma frames, on a 1600×680 box (the
// TV's top part; the pumpkin patch owns the rest). On the venue TV that box
// is exactly the space available, so it renders 1:1. On the host's laptop
// console, where the TV panel is whatever size the window is, the same
// composition scales down as one picture instead of reflowing.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export const OCTOBER_STAGE_W = 1600;
export const OCTOBER_STAGE_H = 680;

export function FitStage({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = Math.min(rect.width / OCTOBER_STAGE_W, rect.height / OCTOBER_STAGE_H);
      setScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
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
