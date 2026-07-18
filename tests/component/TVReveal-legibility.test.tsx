import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TVReveal } from "@/components/tv/TVReveal";

const props = {
  themeKey: "house" as const,
  headerEyebrow: "GAME 1 · SOAPS · 700 PTS",
  question:
    "Which antibacterial ingredient was among 19 substances the FDA ruled ineligible for consumer antiseptic washes in 2016?",
  correctNumber: 2,
  correctText: "Triclosan",
  fact: "The FDA said manufacturers had not provided enough evidence that triclosan was safe and effective for long-term daily use.",
  fastestFive: [
    { name: "Lauren B.", time: "15.8s" },
    { name: "Net Slapper", time: "20.2s" },
  ],
};

describe("TVReveal venue legibility", () => {
  it("keeps the reveal on the stable theme reading surface", () => {
    render(<TVReveal {...props} />);
    expect(screen.getByTestId("tv-reveal")).toHaveAttribute(
      "data-reading-surface",
      "theme-paper",
    );
  });

  it("uses correct color as a controlled answer accent, not the full screen", () => {
    render(<TVReveal {...props} />);
    const card = screen.getByTestId("tv-reveal-answer-card");
    expect(card.style.borderLeftWidth).toBe("14px");
    expect(card.style.borderLeftStyle).toBe("solid");
  });

  it("sizes the fact and fastest names for across-venue reading", () => {
    render(<TVReveal {...props} />);
    expect(screen.getByTestId("tv-reveal-fact").style.fontSize).toBe(
      "clamp(30px, 3.5vmin, 38px)",
    );
    for (const name of screen.getAllByTestId("tv-reveal-fastest-name")) {
      expect(name.style.fontSize).toBe("clamp(28px, 3vmin, 34px)");
    }
  });
});
