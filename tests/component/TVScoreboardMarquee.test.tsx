import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TVScoreboardMarquee, type MarqueeChip } from "@/components/tv/TVScoreboardMarquee";

const chips: MarqueeChip[] = [
  { playerId: "p1", name: "ALEX",   color: "#5AA8E0", score: 7200, joinIndex: 2 },
  { playerId: "p2", name: "SARA",   color: "#F2A02D", score: 8400, joinIndex: 0 },
  { playerId: "p3", name: "MARK",   color: "#E64A8C", score: 7900, joinIndex: 1 },
  { playerId: "p4", name: "JULES",  color: "#7A4FCC", score: 6800, joinIndex: 3 },
];

describe("TVScoreboardMarquee — sort + chip rendering", () => {
  it("sorts chips by score descending", () => {
    render(<TVScoreboardMarquee chips={chips} />);
    const rendered = screen.getAllByTestId("marquee-chip").map(
      (el) => within(el).getByText(/SARA|ALEX|MARK|JULES/).textContent
    );
    expect(rendered).toEqual(["SARA", "MARK", "ALEX", "JULES"]);
  });

  it("uses the same alphabetical display order as every standings surface when scores tie", () => {
    const tied: MarqueeChip[] = [
      { playerId: "a", name: "A", color: "#fff", score: 100, joinIndex: 2 },
      { playerId: "b", name: "B", color: "#fff", score: 100, joinIndex: 0 },
      { playerId: "c", name: "C", color: "#fff", score: 100, joinIndex: 1 },
    ];
    render(<TVScoreboardMarquee chips={tied} />);
    const rendered = screen.getAllByTestId("marquee-chip").map(
      (el) => within(el).getByText(/A|B|C/).textContent
    );
    expect(rendered).toEqual(["A", "B", "C"]);
  });

  it("truncates long names to 12 chars + ellipsis", () => {
    const long: MarqueeChip[] = [
      { playerId: "x", name: "CHRISTOPHER COLUMBUS", color: "#fff", score: 0, joinIndex: 0 },
    ];
    render(<TVScoreboardMarquee chips={long} />);
    expect(screen.getByTestId("marquee-chip").textContent).toContain("CHRISTOPHER…");
  });

  it("renders a color dot styled with the player's color", () => {
    render(<TVScoreboardMarquee chips={[chips[0]!]} />);
    const dot = screen.getByTestId("marquee-chip-dot");
    // jsdom normalizes hex #5AA8E0 → rgb(90, 168, 224) in inline styles.
    expect(dot.getAttribute("style") ?? "").toContain("rgb(90, 168, 224)");
  });

  it("includes an aria-live region for screen reader announcements", () => {
    render(<TVScoreboardMarquee chips={chips} announcement="MARK locked in" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("MARK locked in");
  });

  it("renders +SPD badge on the spotlighted chip when speedBonus=true", () => {
    const speedChip: MarqueeChip = { ...chips[2]!, speedBonus: true };
    render(<TVScoreboardMarquee chips={[speedChip]} spotlightedPlayerId={speedChip.playerId} />);
    expect(screen.getByTestId("marquee-chip-spd")).toBeInTheDocument();
  });

  it("does NOT render +SPD badge when chip is not spotlighted", () => {
    const speedChip: MarqueeChip = { ...chips[2]!, speedBonus: true };
    render(<TVScoreboardMarquee chips={[speedChip]} />);
    expect(screen.queryByTestId("marquee-chip-spd")).toBeNull();
  });
});

describe("TVScoreboardMarquee — auto-scroll", () => {
  it("applies a scroll animation when chip count is high enough to overflow", () => {
    const many: MarqueeChip[] = Array.from({ length: 25 }, (_, i) => ({
      playerId: `p${i}`,
      name: `P${i.toString().padStart(2, "0")}`,
      color: "#fff",
      score: 1000 - i,
      joinIndex: i,
    }));
    const { container } = render(<TVScoreboardMarquee chips={many} />);
    const track = container.querySelector("[data-testid='marquee-track']");
    expect(track?.getAttribute("style") ?? "").toMatch(/animation/i);
  });

  it("does NOT apply scroll animation for a small chip count", () => {
    const few: MarqueeChip[] = [
      { playerId: "a", name: "A", color: "#fff", score: 0, joinIndex: 0 },
      { playerId: "b", name: "B", color: "#fff", score: 0, joinIndex: 1 },
    ];
    const { container } = render(<TVScoreboardMarquee chips={few} />);
    const track = container.querySelector("[data-testid='marquee-track']");
    expect(track?.getAttribute("style") ?? "").not.toMatch(/animation/i);
  });

  it("duplicate chip set is aria-hidden from screen readers", () => {
    const many: MarqueeChip[] = Array.from({ length: 25 }, (_, i) => ({
      playerId: `p${i}`,
      name: `P${i.toString().padStart(2, "0")}`,
      color: "#fff",
      score: 1000 - i,
      joinIndex: i,
    }));
    const { container } = render(<TVScoreboardMarquee chips={many} />);
    const hiddenWrapper = container.querySelector("[aria-hidden='true']");
    // The duplicate chip set must be inside an aria-hidden wrapper
    expect(hiddenWrapper).not.toBeNull();
    expect(hiddenWrapper?.children.length).toBe(25); // 25 duplicate chips
  });

  it("disables scroll animation when prefers-reduced-motion is set", () => {
    const originalMatchMedia = window.matchMedia;
    try {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (q: string) => ({
          matches: q.includes("reduce"),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
      const many: MarqueeChip[] = Array.from({ length: 25 }, (_, i) => ({
        playerId: `p${i}`,
        name: `P${i.toString().padStart(2, "0")}`,
        color: "#fff",
        score: 1000 - i,
        joinIndex: i,
      }));
      const { container } = render(<TVScoreboardMarquee chips={many} />);
      const track = container.querySelector("[data-testid='marquee-track']");
      expect(track?.getAttribute("style") ?? "").not.toMatch(/animation/i);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});
