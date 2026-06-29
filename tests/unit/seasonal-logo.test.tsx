import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider, Wordmark, seasonalLogoSkinForTheme } from "@/components/system";

describe("seasonal TR1VIA logo", () => {
  it("neutral themes wear the live calendar month skin", () => {
    expect(seasonalLogoSkinForTheme("daylight", new Date(2026, 6, 4))).toBe("july");
    expect(seasonalLogoSkinForTheme("house", new Date(2026, 5, 15))).toBe("june");
  });

  it("explicit month themes keep their own skin", () => {
    expect(seasonalLogoSkinForTheme("june", new Date(2026, 6, 4))).toBe("june");
    expect(seasonalLogoSkinForTheme("july", new Date(2026, 5, 15))).toBe("july");
  });

  it("renders a deterministic seasonal skin without a ThemeProvider", () => {
    const { container } = render(<Wordmark seasonalKey="july" />);
    expect(container.querySelector('[data-logo-skin="july"]')).toBeTruthy();
    expect(container.querySelector('[data-logo-mark="shuffled-one"]')).toBeTruthy();
    expect(container.querySelector('[data-logo-motif="july"]')).toBeTruthy();
    expect(container.querySelector('[data-logo-motif-scale="thumbnail"]')).toBeTruthy();
  });

  it("reads the active ThemeProvider skin when no override is passed", () => {
    const { container } = render(
      <ThemeProvider themeKey="june">
        <Wordmark />
      </ThemeProvider>,
    );

    expect(container.querySelector('[data-logo-skin="june"]')).toBeTruthy();
    expect(container.querySelector('[data-logo-motif="june"]')).toBeTruthy();
  });

  it("can render the plain mark when a surface needs it", () => {
    const { container } = render(<Wordmark seasonal={false} seasonalKey="july" />);
    expect(container.querySelector('[data-logo-skin="none"]')).toBeTruthy();
    expect(container.querySelector('[data-logo-mark="shuffled-one"]')).toBeTruthy();
    expect(container.querySelector("[data-logo-motif]")).toBeNull();
  });
});
