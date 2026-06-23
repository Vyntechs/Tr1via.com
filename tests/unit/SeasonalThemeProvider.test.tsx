// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeasonalThemeProvider } from "@/components/system/SeasonalThemeProvider";
import { useTheme } from "@/components/system/ThemeProvider";

function Probe() {
  const { themeKey } = useTheme();
  return <span data-testid="k">{themeKey}</span>;
}

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-theme");
});

describe("SeasonalThemeProvider", () => {
  it("themes to the visitor's live month, ignoring a stale SSR key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 2)); // July; SSR baked June
    render(
      <SeasonalThemeProvider ssrThemeKey="june">
        <Probe />
      </SeasonalThemeProvider>,
    );
    expect(screen.getByTestId("k").textContent).toBe("july");
    expect(document.documentElement.getAttribute("data-theme")).toBe("july");
  });
});
