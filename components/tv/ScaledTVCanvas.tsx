"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  TV_LOGICAL_HEIGHT,
  TV_LOGICAL_WIDTH,
  fitTVCanvas,
} from "@/lib/tv/fitTVCanvas";

export interface ScaledTVCanvasProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  frameTestId?: string;
  canvasTestId?: string;
  interactive?: boolean;
}

interface FrameSize {
  width: number;
  height: number;
}

/**
 * A television is a fixed composition, not a responsive webpage. This shell
 * keeps every child on the same 1600×900 stage and scales that finished stage
 * to fit the available rectangle without cropping or reflowing it.
 */
export function ScaledTVCanvas({
  children,
  className,
  style,
  ariaLabel,
  frameTestId,
  canvasTestId,
  interactive = false,
}: ScaledTVCanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState<FrameSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const update = (width: number, height: number) => {
      setFrameSize((current) =>
        Math.abs(current.width - width) < 0.01 && Math.abs(current.height - height) < 0.01
          ? current
          : { width, height },
      );
    };

    const rect = frame.getBoundingClientRect();
    update(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (next) update(next.width, next.height);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const fit = fitTVCanvas(frameSize.width, frameSize.height);
  const left = (frameSize.width - fit.width) / 2;
  const top = (frameSize.height - fit.height) / 2;

  return (
    <div
      ref={frameRef}
      className={className}
      aria-label={ariaLabel}
      data-testid={frameTestId}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#000",
        ...style,
      }}
    >
      <div
        data-testid={canvasTestId}
        style={{
          position: "absolute",
          left,
          top,
          width: `${TV_LOGICAL_WIDTH}px`,
          height: `${TV_LOGICAL_HEIGHT}px`,
          transform: `scale(${fit.scale})`,
          transformOrigin: "top left",
          pointerEvents: interactive ? "auto" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
