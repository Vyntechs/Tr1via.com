import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HostGenLoading } from "@/components/host/gen/HostGenLoading";
import {
  buildTracker,
  LIVE_WINDOW_MS,
  livenessAt,
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
    checkTotal: 40,
    startedAt: Date.now() - 84_000,
    lastSignalAt: Date.now() - 1_000,
    failuresKnown: true,
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
    expect(count("check")).toBe("12/40");
    expect(count("photos")).toBe("0/20");
    expect(stage("write")).toHaveAttribute("data-stage-state", "done");
    expect(stage("check")).toHaveAttribute("data-stage-state", "active");
    expect(stage("photos")).toHaveAttribute("data-stage-state", "waiting");
    expect(screen.getByTestId("host-gen-stage-detail-check").textContent).toBe(
      "2 checks per question",
    );
    // 12 of 40 checks (both passes added) = 30% of the checking stage.
    expect(parseFloat(fill("check"))).toBe(30);
    expect(parseFloat(fill("photos"))).toBe(0);
    expect(screen.getByTestId("host-gen-status-line").textContent).toBe(
      "Fact-checking answers",
    );
  });

  it("leaves stages that haven't started empty while writing", () => {
    render(
      <HostGenLoading
        themeKey="house"
        topic="Pixar"
        loaded={[]}
        progress={progress({ phase: "writing", written: 7, checked: undefined, checkTotal: undefined })}
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
        progress={progress({ phase: "repairing", written: 20, certified: 17, clean: 17, failedLastRound: 3, checked: undefined, checkTotal: undefined })}
      />,
    );
    expect(screen.getByTestId("host-gen-status-line").textContent).toBe(
      "3 failed the check. Writing replacements",
    );
    expect(screen.getByTestId("host-gen-stage-detail-check").textContent).toBe("3 to replace");
  });

  it("follows the real counts through a refill and an auto-resume, and says why they drop", () => {
    const view = (over: Partial<HostGenProgress>) => (
      <HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress(over)} />
    );
    const shownPct = () => screen.getAllByText(/^\d+%$/)[0]!.textContent;
    const headline = () => screen.getByTestId("host-gen-status-line").textContent;
    const none = { checked: undefined, checkTotal: undefined };
    const { rerender, unmount } = render(view({ checked: 40, checkTotal: 40 }));
    expect(shownPct()).toBe("78%");
    expect(parseFloat(fill("check"))).toBe(100);
    // 3 failed: the bar and the percent drop to the truth, and the headline
    // says why.
    rerender(view({ ...none, phase: "repairing", certified: 17, clean: 17, failedLastRound: 3 }));
    expect(shownPct()).toBe("75%");
    expect(parseFloat(fill("check"))).toBe(85);
    expect(count("check")).toBe("17/20");
    expect(headline()).toBe("3 failed the check. Writing replacements");
    // Paused in round 1 with nothing saved, then auto-resumed: the new
    // attempt really starts from zero, and the screen says so.
    rerender(view({ phase: "checking", certified: 0, checked: 16, checkTotal: 40 }));
    expect(shownPct()).toBe("65%");
    rerender(view({ ...none, phase: "writing", written: 5, certified: 0, clean: 0, resumedWith: 0 }));
    expect(shownPct()).toBe("14%");
    expect(parseFloat(fill("write"))).toBe(25);
    expect(parseFloat(fill("check"))).toBe(0);
    expect(count("write")).toBe("5/20");
    expect(headline()).toBe("Starting over after a pause. Writing questions");
    // A new build always comes on a fresh screen, which starts from its own
    // real counts.
    unmount();
    render(view({ ...none, phase: "writing", written: 2 }));
    expect(shownPct()).toBe("6%");
    expect(headline()).toBe("Writing questions");
  });

  it("shows no check number until the first live update after a reload", () => {
    const none = { checked: undefined, checkTotal: undefined };
    const { rerender } = render(
      <HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress({ ...none, phase: "repairing", written: 15, certified: 15 })} />,
    );
    expect(screen.queryByTestId("host-gen-stage-count-check")).toBeNull();
    expect(screen.getByTestId("host-gen-stage-detail-check").textContent).toBe("waiting for the next update");
    expect(parseFloat(fill("check"))).toBe(0);
    expect(screen.getAllByText(/^\d+%$/)[0]!.textContent).toBe("42%");
    rerender(
      <HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress({ ...none, phase: "repairing", written: 15, certified: 15, clean: 13 })} />,
    );
    expect(count("check")).toBe("13/20");
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

  it("stays live through a 25s quiet stretch and stops by 31s", () => {
    const now = 1_000_000;
    expect(LIVE_WINDOW_MS).toBe(30_000);
    const base = { startedAt: now - 120_000, phase: "images" as const };
    expect(livenessAt(now, { ...base, lastSignalAt: now - 25_000 }).live).toBe(true);
    expect(livenessAt(now, { ...base, lastSignalAt: now - 31_000 }).live).toBe(false);
  });

  it("stops the live pulse and says how long ago the last update was", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    render(<HostGenLoading themeKey="house" topic="Pixar" loaded={[]} progress={progress()} />);
    const liveness = screen.getByTestId("host-gen-liveness");
    expect(liveness).toHaveAttribute("data-live", "true");
    expect(screen.getByTestId("host-gen-live-dot")).toHaveAttribute("data-animating", "true");

    act(() => {
      vi.advanceTimersByTime(39_000);
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
    // writing done (0.56) + 12 of 40 checks = 30% of checking (0.22 * 0.3)
    expect(tr.overall).toBeCloseTo(0.56 + 0.22 * 0.3, 5);
    expect(buildTracker(progress({ phase: "queued", written: 0, checked: undefined, checkTotal: undefined })).overall).toBe(0);
  });

  it("never moves backward while both check passes report at the same time", () => {
    // Summed checks as the server sends them while the two passes'
    // chunks land interleaved.
    const sums = [0, 6, 12, 18, 24, 30, 36, 38, 40];
    const overall = sums.map((checked) => buildTracker(progress({ checked })).overall);
    for (let i = 1; i < overall.length; i++) {
      expect(overall[i]).toBeGreaterThanOrEqual(overall[i - 1]!);
    }
    const tr = buildTracker(progress({ checked: 20 }));
    // One pass finishing first (20 of 40) is half the stage, not all of it.
    expect(tr.stages[1].fraction).toBeCloseTo(0.5, 5);
    expect(tr.stages[1].detail).toBe("2 checks per question");
    expect(tr.headline).toBe("Fact-checking answers");
  });

  it("treats a refill batch of 11+ questions as a refill (checkTotal is doubled)", () => {
    const tr = buildTracker(progress({ certified: 8, checked: 4, checkTotal: 26, failedLastRound: 12 }));
    expect(tr.refillNeed).toBe(12);
    expect(tr.headline).toBe("12 failed the check. Checking the replacements");
  });

  it("counts photos against certified questions", () => {
    const tr = buildTracker(progress({ phase: "images", certified: 18, photos: 6 }));
    expect(tr.stages[2]).toMatchObject({ count: 6, total: 18, state: "active" });
    expect(tr.headline).toBe("Finding photos");
  });
});
