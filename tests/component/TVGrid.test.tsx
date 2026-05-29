import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TVGrid, type TVGridLeaderRow } from "@/components/tv/TVGrid";

const TOP5: TVGridLeaderRow[] = [
  { rank: 1, name: "Devon", score: 2140 },
  { rank: 2, name: "Iris", score: 1990 },
  { rank: 3, name: "Priya", score: 1820 },
  { rank: 4, name: "Cole", score: 1740 },
  { rank: 5, name: "Ezra", score: 1610 },
];

describe("TVGrid — idle sidebar standings", () => {
  it("shows the top FOUR places, not just the leader", () => {
    render(<TVGrid themeKey="house" leaders={TOP5} />);
    const rows = screen.getAllByTestId(/^tv-grid-standing-\d+$/);
    expect(rows).toHaveLength(4);
    const names = rows.map((r) => within(r).getByTestId("tv-grid-standing-name").textContent);
    expect(names).toEqual(["Devon", "Iris", "Priya", "Cole"]);
  });

  it("renders each standing's score", () => {
    render(<TVGrid themeKey="house" leaders={TOP5} />);
    const leaderRow = screen.getByTestId("tv-grid-standing-1");
    expect(within(leaderRow).getByTestId("tv-grid-standing-name").textContent).toBe("Devon");
    expect(leaderRow.textContent).toContain("2,140");
  });

  it("renders fewer rows when fewer than four players exist", () => {
    render(<TVGrid themeKey="house" leaders={TOP5.slice(0, 2)} />);
    expect(screen.getAllByTestId(/^tv-grid-standing-\d+$/)).toHaveLength(2);
  });

  it("hides the standings card entirely when there are no players", () => {
    render(<TVGrid themeKey="house" leaders={[]} />);
    expect(screen.queryByTestId("tv-grid-standings")).toBeNull();
    expect(screen.queryAllByTestId(/^tv-grid-standing-\d+$/)).toHaveLength(0);
  });

  it("clips long names instead of breaking the layout", () => {
    const long: TVGridLeaderRow[] = [
      { rank: 1, name: "Bartholomew Featherstonehaugh", score: 999 },
    ];
    render(<TVGrid themeKey="house" leaders={long} />);
    const name = screen.getByTestId("tv-grid-standing-name");
    // Full name stays in the DOM (accessible); CSS ellipsis does the clipping.
    expect(name.textContent).toBe("Bartholomew Featherstonehaugh");
    expect(name.getAttribute("style") ?? "").toContain("ellipsis");
  });
});
