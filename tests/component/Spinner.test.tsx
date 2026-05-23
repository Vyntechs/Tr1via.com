// Spinner — tasteful CSS-only loading indicator. Exposes a status role +
// aria-label so AT can announce "loading" without clutter. Three sizes.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Spinner } from "@/components/system/Spinner";
import { ThemeProvider } from "@/components/system/ThemeProvider";

function renderInTheme(node: React.ReactNode) {
  return render(<ThemeProvider themeKey="house">{node}</ThemeProvider>);
}

describe("Spinner", () => {
  afterEach(() => cleanup());
  it("renders a status role with a default aria-label", () => {
    renderInTheme(<Spinner />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAccessibleName(/loading/i);
  });

  it("accepts a custom aria-label", () => {
    renderInTheme(<Spinner label="Catching up to the room" />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      /catching up to the room/i,
    );
  });

  it("renders in three sizes", () => {
    const { rerender } = renderInTheme(<Spinner size="sm" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(
      <ThemeProvider themeKey="house">
        <Spinner size="md" />
      </ThemeProvider>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    rerender(
      <ThemeProvider themeKey="house">
        <Spinner size="lg" />
      </ThemeProvider>,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
