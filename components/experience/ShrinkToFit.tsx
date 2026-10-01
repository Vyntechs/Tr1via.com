// Shrinks its content, as one picture, only when it would not otherwise fit.
//
// A theme with a living world (October) gives the game screens the top part
// of the TV and keeps the bottom for its pumpkin patch. Most content fits that
// space at full size; a worst case (a long question, a long answer and a long
// fact) would be cut off. Wrapped in this, the content stays whole: it scales
// down just enough, and only on the nights and screens that need it.
//
// Measures layout sizes (offsetHeight), never on-screen sizes, so a stage that
// is itself scaled (the venue TV, the host's phone preview) isn't counted twice.

"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function ShrinkToFit({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const room = outer.clientHeight;
      const needed = inner.offsetHeight;
      if (room <= 0 || needed <= 0) return;
      // The content keeps its own line breaks (its width never changes with
      // the scale), so its height is fixed and one measurement is exact.
      const next = Math.min(1, room / needed);
      setScale((current) => (Math.abs(next - current) < 0.005 ? current : next));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    const first = window.setTimeout(fit, 0);
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={outerRef}
      data-testid="shrink-to-fit"
      data-fit-scale={scale.toFixed(2)}
      style={{ position: "relative", flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", ...style }}
    >
      <div
        ref={innerRef}
        style={{
          width: "100%",
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </div>
  );
}
