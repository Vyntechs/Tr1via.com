// tests/component/TVQuestion-marquee-swap.test.tsx
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("removes the public image panel if the external image fails to load", () => {
    const { container } = render(
      <TVQuestion
        {...baseProps}
        themeKey="house"
        imageUrl="https://images.pexels.com/photos/missing.jpeg"
      />,
    );
    const img = container.querySelector("img");
    if (!img) throw new Error("expected TV question image to render before error");
    expect(img).toBeInTheDocument();
    fireEvent.error(img);
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("removes an already-broken public image after mount", async () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(0);
    try {
      const { container } = render(
        <TVQuestion
          {...baseProps}
          themeKey="house"
          imageUrl="https://images.pexels.com/photos/cached-missing.jpeg"
        />,
      );
      await waitFor(() => expect(container.querySelector("img")).not.toBeInTheDocument());
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });
});
