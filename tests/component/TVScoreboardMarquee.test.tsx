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

  it("uses join order as the tiebreaker when scores are equal", () => {
    const tied: MarqueeChip[] = [
      { playerId: "a", name: "A", color: "#fff", score: 100, joinIndex: 2 },
      { playerId: "b", name: "B", color: "#fff", score: 100, joinIndex: 0 },
      { playerId: "c", name: "C", color: "#fff", score: 100, joinIndex: 1 },
    ];
    render(<TVScoreboardMarquee chips={tied} />);
    const rendered = screen.getAllByTestId("marquee-chip").map(
      (el) => within(el).getByText(/A|B|C/).textContent
    );
    expect(rendered).toEqual(["B", "C", "A"]);
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
    expect(dot.getAttribute("style") ?? "").toContain("#5AA8E0");
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
