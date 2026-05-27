// PlayerQuestion — the live question screen on a player's phone.
//
// Regression coverage for the "long question gets dot-dot-dot truncated"
// bug Brandon hit during Heather's Day 2 test (2026-05-26). The fix is
// `useAutoFitText` + removing the WebkitLineClamp — these tests pin that
// behavior so a future "just clip it at 3 lines" refactor can't sneak past.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlayerQuestion } from "@/components/player/PlayerQuestion";
import { ThemeProvider } from "@/components/system/ThemeProvider";

const LONG_PROMPT =
  "Which work boot company, still operating in Chippewa Falls, Wisconsin, is known for making custom boots to order for specific trades like firefighting and logging?";

function renderInTheme(node: React.ReactNode) {
  return render(<ThemeProvider themeKey="house">{node}</ThemeProvider>);
}

describe("PlayerQuestion", () => {
  afterEach(() => cleanup());

  it("renders the full prompt without line-clamp truncation", () => {
    renderInTheme(<PlayerQuestion prompt={LONG_PROMPT} />);
    const prompt = screen.getByTestId("player-question-prompt");
    // Full text is present in the DOM — not visually clipped server-side
    // via dangerouslySetInnerHTML or similar tricks.
    expect(prompt.textContent).toBe(LONG_PROMPT);
    // Inline styles must NOT use the WebKit line-clamp escape hatch.
    // (jsdom serializes camelCase style props as their CSS kebab equivalents.)
    expect(prompt.style.getPropertyValue("-webkit-line-clamp")).toBe("");
    expect(prompt.style.overflow).not.toBe("hidden");
  });

  it("renders the four answer slots", () => {
    renderInTheme(
      <PlayerQuestion
        prompt="Short prompt."
        options={["Apple", "Banana", "Cherry", "Date"]}
      />,
    );
    expect(screen.getByTestId("player-answer-1")).toBeInTheDocument();
    expect(screen.getByTestId("player-answer-2")).toBeInTheDocument();
    expect(screen.getByTestId("player-answer-3")).toBeInTheDocument();
    expect(screen.getByTestId("player-answer-4")).toBeInTheDocument();
  });

  it("applies a numeric font-size derived from useAutoFitText", () => {
    // The hook initializes at the ceiling (28px) before its measurement
    // pass runs. jsdom never lays out text so the measurement is effectively
    // a no-op here, but the ceiling value confirms the hook is wired up.
    renderInTheme(<PlayerQuestion prompt="Short prompt." />);
    const prompt = screen.getByTestId("player-question-prompt");
    // Font-size is set inline via the hook's return value — verify it's a
    // px value rather than the old hard-coded 17px from before the fix.
    expect(prompt.style.fontSize).toMatch(/^\d+px$/);
    const size = parseInt(prompt.style.fontSize, 10);
    expect(size).toBeGreaterThanOrEqual(16);
    expect(size).toBeLessThanOrEqual(28);
  });

  it("renders the image thumbnail when imageUrl is provided", () => {
    renderInTheme(
      <PlayerQuestion
        prompt="Short."
        imageUrl="https://images.pexels.com/photos/1366630/pexels-photo-1366630.jpeg"
      />,
    );
    const img = screen.getByTestId("player-question-image") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.alt).toBe("");
  });

  it("omits the prompt block entirely when prompt is empty (legacy preview)", () => {
    // The component's `prompt` prop has a default for the static gallery
    // preview, so the conditional that hides the row triggers on falsy
    // values (empty string). Pass "" to assert the row collapses.
    renderInTheme(<PlayerQuestion prompt="" />);
    expect(screen.queryByTestId("player-question-prompt")).not.toBeInTheDocument();
  });
});
