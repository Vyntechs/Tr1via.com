// tests/component/TVQuestion-marquee-swap.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TVQuestion } from "@/components/tv/TVQuestion";

const baseProps = {
  category: "Geography",
  value: 100,
  question: "Which state?",
  seconds: 15,
  options: [
    { n: 1, text: "Florida" },
    { n: 2, text: "Alaska" },
    { n: 3, text: "California" },
    { n: 4, text: "Maine" },
  ],
};

const marqueeChips = [
  { playerId: "p1", name: "ALEX", color: "#5AA8E0", score: 7200, joinIndex: 0 },
  { playerId: "p2", name: "SARA", color: "#F2A02D", score: 8400, joinIndex: 1 },
];

describe("TVQuestion bottom-strip swap", () => {
  it("renders the marquee when themeKey is 'may' and marqueeChips provided", () => {
    render(<TVQuestion {...baseProps} themeKey="may" marqueeChips={marqueeChips} />);
    expect(screen.getByTestId("tv-scoreboard-marquee")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-question-pile")).toBeNull();
  });

  it("renders the existing pile when themeKey is not 'may'", () => {
    render(<TVQuestion {...baseProps} themeKey="house" />);
    expect(screen.queryByTestId("tv-scoreboard-marquee")).toBeNull();
    expect(screen.getByTestId("tv-question-pile")).toBeInTheDocument();
  });

  it("falls back to the pile if themeKey is 'may' but no marqueeChips provided", () => {
    render(<TVQuestion {...baseProps} themeKey="may" />);
    expect(screen.queryByTestId("tv-scoreboard-marquee")).toBeNull();
    expect(screen.getByTestId("tv-question-pile")).toBeInTheDocument();
  });
});
