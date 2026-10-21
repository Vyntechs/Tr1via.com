import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HostGenLoading } from "@/components/host/gen/HostGenLoading";
import {
  buildTracker,
  LIVE_WINDOW_MS,
  type HostGenProgress,
} from "@/components/host/gen/genProgress";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function progress(over: Partial<HostGenProgress> = {}): HostGenProgress {
  return {
    phase: "checking",
    target: 20,
    written: 20,
    certified: 0,
    photos: 0,
    checked: 12,
    checkTotal: 20,
    checkPass: 1,
    startedAt: Date.now() - 84_000,
    lastSignalAt: Date.now() - 1_000,
    ...over,
  };
}

const stage = (key: string) => screen.getByTestId(`host-gen-stage-${key}`);
const count = (key: string) => screen.getByTestId(`host-gen-stage-count-${key}`).textContent;
const fill = (key: string) =>
  (screen.getByTestId(`host-gen-stage-fill-${key}`) as HTMLElement).style.width;

describe("HostGenLoading progress tracker", () => {
  it("shows each stage's real count and state mid-build", () => {
    render(<HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress()} />);
    expect(count("write")).toBe("20/20");
    expect(count("check")).toBe("12/20");
    expect(count("photos")).toBe("0/20");
    expect(stage("write")).toHaveAttribute("data-stage-state", "done");
    expect(stage("check")).toHaveAttribute("data-stage-state", "active");
    expect(stage("photos")).toHaveAttribute("data-stage-state", "waiting");
    expect(screen.getByTestId("host-gen-stage-detail-check").textContent).toBe("pass 1 of 2");
    // Pass 1 at 12/20 = 30% of the checking stage; photos untouched.
    expect(parseFloat(fill("check"))).toBe(30);
    expect(parseFloat(fill("photos"))).toBe(0);
    expect(screen.getByTestId("host-gen-status-line").textContent).toBe(
      "Fact-checking answers, pass 1 of 2",
    );
  });

  it("leaves stages that haven't started empty while writing", () => {
    render(
      <HostGenLoading
        themeKey="house"
        topic="Pixar"
        loaded={[]}
        progress={progress({ phase: "writing", written: 7, checked: undefined, checkTotal: undefined, checkPass: undefined })}
      />,
    );
    expect(count("write")).toBe("7/20");
    expect(parseFloat(fill("write"))).toBe(35);
    expect(stage("write")).toHaveAttribute("data-stage-state", "active");
    expect(stage("check")).toHaveAttribute("data-stage-state", "waiting");
    expect(parseFloat(fill("check"))).toBe(0);
    expect(stage("photos")).toHaveAttribute("data-stage-state", "waiting");
  });

  it("reads a refill round honestly", () => {
    render(
      <HostGenLoading
        themeKey="house"
        topic="Pixar"
        loaded={[]}
        progress={progress({ phase: "repairing", written: 17, certified: 17, checked: undefined, checkTotal: undefined, checkPass: undefined })}
      />,
    );
    expect(screen.getByTestId("host-gen-status-line").textContent).toBe(
      "Replacing 3 that failed the check",
    );
    expect(screen.getByTestId("host-gen-stage-detail-check").textContent).toBe("3 to replace");
  });

  it("shows elapsed time and says when the screen joined mid-build", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const { rerender } = render(
      <HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress()} />,
    );
    expect(screen.getByTestId("host-gen-elapsed").textContent).toBe("1:24 so far");
    rerender(
      <HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress({ joinedMidway: true })} />,
    );
    expect(screen.getByTestId("host-gen-elapsed").textContent).toMatch(/since you opened this/);
  });

  it("stops the live pulse and says how long ago the last update was", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    render(<HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress()} />);
    const liveness = screen.getByTestId("host-gen-liveness");
    expect(liveness).toHaveAttribute("data-live", "true");
    expect(screen.getByTestId("host-gen-live-dot")).toHaveAttribute("data-animating", "true");

    act(() => {
      vi.advanceTimersByTime(LIVE_WINDOW_MS + 21_000);
    });
    expect(liveness).toHaveAttribute("data-live", "false");
    expect(screen.getByTestId("host-gen-live-dot")).toHaveAttribute("data-animating", "false");
    expect(liveness.textContent).toBe("Waiting on the server. Last update 40s ago.");
  });

  it("never animates the pulse when the host prefers reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
    render(<HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress()} />);
    const liveness = screen.getByTestId("host-gen-liveness");
    expect(liveness).toHaveAttribute("data-reduced-motion", "true");
    expect(liveness).toHaveAttribute("data-live", "true");
    expect(screen.getByTestId("host-gen-live-dot")).toHaveAttribute("data-animating", "false");
  });

  it("has no forever-shimmer on the progress bars", () => {
    const { container } = render(
      <HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress()} />,
    );
    const tracker = screen.getByTestId("host-gen-tracker");
    expect(tracker.innerHTML).not.toMatch(/shimmer/);
    expect(container.innerHTML).not.toMatch(/tr1via-shimmer/);
  });
});

describe("buildTracker", () => {
  it("weights stages by typical time and only counts real progress", () => {
    const tr = buildTracker(progress());
    // writing done (0.56) + pass 1 at 12/20 = 30% of checking (0.22 * 0.3)
    expect(tr.overall).toBeCloseTo(0.56 + 0.22 * 0.3, 5);
    expect(buildTracker(progress({ phase: "queued", written: 0, checked: undefined, checkTotal: undefined, checkPass: undefined })).overall).toBe(0);
  });

  it("fills pass 2 from the second half of the checking stage", () => {
    const tr = buildTracker(progress({ checked: 10, checkPass: 2 }));
    expect(tr.stages[1].fraction).toBeCloseTo(0.75, 5);
    expect(tr.stages[1].detail).toBe("pass 2 of 2");
  });

  it("counts photos against certified questions", () => {
    const tr = buildTracker(progress({ phase: "images", certified: 18, photos: 6 }));
    expect(tr.stages[2]).toMatchObject({ count: 6, total: 18, state: "active" });
    expect(tr.headline).toBe("Finding photos");
  });
});
