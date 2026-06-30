import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import {
  PlayerRevealCorrect,
  PlayerRevealWrong,
} from "@/components/player";

function wrap(node: React.ReactNode) {
  return <ThemeProvider themeKey="june">{node}</ThemeProvider>;
}

function controls() {
  return <div data-testid="room-magic-controls">Reaction controls</div>;
}

describe("player reveal Room Magic slot", () => {
  it("renders Room Magic controls on the correct reveal when supplied", () => {
    render(wrap(<PlayerRevealCorrect roomMagicControls={controls()} />));

    expect(screen.getByTestId("room-magic-controls")).toBeInTheDocument();
  });

  it("renders Room Magic controls on the wrong reveal when supplied", () => {
    render(wrap(<PlayerRevealWrong roomMagicControls={controls()} />));

    expect(screen.getByTestId("room-magic-controls")).toBeInTheDocument();
  });

  it("omits controls when the page does not supply the reveal-only slot", () => {
    render(wrap(<PlayerRevealWrong />));

    expect(screen.queryByTestId("room-magic-controls")).not.toBeInTheDocument();
  });
});
