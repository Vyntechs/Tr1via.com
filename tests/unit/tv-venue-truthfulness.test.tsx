import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { TVRevealStumper } from "@/components/tv/TVRevealStumper";
import { TVGrid, type TVGridLeaderRow } from "@/components/tv/TVGrid";

// Two bugs the venue TV showed the whole room. Both are "the screen told the
// audience something untrue", which is worse than a crash — nobody in the bar
// can tell it is a bug, they just think the game is wrong.

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
}

describe("TV stumper reveal — never prints demo copy at a venue", () => {
  // TVRevealStumper carries demo defaults so /dev previews render with no
  // props. TVStateMachine used to omit pointBlurb and pass `undefined` for a
  // missing fact, which re-triggered those defaults — so a real 100-point
  // question announced itself as "a 700" with a "70-point speed bonus", and a
  // question with no fun-fact printed a stock paragraph about Egyptian honey.
  it("prints the REAL point value, not the demo 700", () => {
    render(wrap(
      <TVRevealStumper
        // Every prop TVStateMachine passes — omitting one is exactly how the
        // demo copy leaked to the venue in the first place.
        headerEyebrow="GAME 1 · PIXAR MOVIES · 100 PTS"
        category="Pixar movies"
        question="Which film opens with a wordless montage?"
        correctNumber={2}
        correctText="Up"
        fact=""
        gotIt={1}
        ofTotal={32}
        whoNailedIt={[{ name: "Omar", time: "3.3s" }]}
        pointBlurb="Hard questions are worth more on purpose. This was a 100. A 10-point speed bonus went to the fastest correct answer, under 5 seconds."
      />,
    ));
    expect(screen.getByText(/This was a 100/)).toBeInTheDocument();
    expect(screen.getByText(/10-point speed bonus/)).toBeInTheDocument();
    expect(screen.queryByText(/700/)).not.toBeInTheDocument();
    expect(screen.queryByText(/70-point/)).not.toBeInTheDocument();
  });

  it("shows no fun-fact at all when the question has none, rather than the canned honey fact", () => {
    render(wrap(
      <TVRevealStumper
        category="Pixar movies"
        question="Which film opens with a wordless montage?"
        correctNumber={2}
        correctText="Up"
        fact=""
        gotIt={0}
        ofTotal={32}
        whoNailedIt={[]}
        pointBlurb="Hard questions are worth more on purpose. This was a 300."
      />,
    ));
    expect(screen.queryByText(/honey/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Egyptian/i)).not.toBeInTheDocument();
  });

  it("omits the speed-bonus sentence when nobody beat 5 seconds", () => {
    render(wrap(
      <TVRevealStumper
        category="History"
        question="A hard one"
        correctNumber={1}
        correctText="Answer"
        fact=""
        gotIt={2}
        ofTotal={32}
        whoNailedIt={[{ name: "Iris", time: "11.2s" }]}
        pointBlurb="Hard questions are worth more on purpose. This was a 500."
      />,
    ));
    expect(screen.getByText(/This was a 500/)).toBeInTheDocument();
    expect(screen.queryByText(/speed bonus/i)).not.toBeInTheDocument();
  });
});

describe("TV standings — a tie must not duplicate a row", () => {
  // Rows were keyed on rank alone. Two players tied share a rank, so React saw
  // duplicate keys and could drop or double-render a row in front of the venue.
  const TIED: TVGridLeaderRow[] = [
    { rank: 1, name: "Maya", score: 400 },
    { rank: 2, name: "Omar", score: 300 },
    { rank: 2, name: "Priya", score: 300 }, // tie on rank 2
    { rank: 4, name: "Lucas", score: 100 },
  ];

  it("renders every tied player exactly once", () => {
    render(wrap(<TVGrid leaders={TIED} />));
    for (const row of TIED) {
      expect(screen.getAllByText(row.name)).toHaveLength(1);
    }
  });

  it("keeps all four standings rows when two share a rank", () => {
    render(wrap(<TVGrid leaders={TIED} />));
    expect(screen.getByText("Maya")).toBeInTheDocument();
    expect(screen.getByText("Omar")).toBeInTheDocument();
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.getByText("Lucas")).toBeInTheDocument();
  });
});
