import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ScaledTVCanvas } from "@/components/tv/ScaledTVCanvas";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScaledTVCanvas", () => {
  it("scales and centers a fixed logical stage without reflowing it", () => {
    class PortraitResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 390, height: 844 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", PortraitResizeObserver);

    render(
      <ScaledTVCanvas frameTestId="frame" canvasTestId="canvas">
        <div>Audience composition</div>
      </ScaledTVCanvas>,
    );

    expect(screen.getByTestId("frame")).toHaveStyle({ overflow: "hidden" });
    expect(screen.getByTestId("canvas")).toHaveStyle({
      width: "1600px",
      height: "900px",
      left: "0px",
      top: "312.3125px",
      transform: "scale(0.24375)",
      transformOrigin: "top left",
    });
  });
});
