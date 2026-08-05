import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PhoneScreen } from "@/components/shells/PhoneScreen";
import { ThemeProvider } from "@/components/system/ThemeProvider";

function renderScreen(scroll?: "auto" | "locked") {
  render(
    <ThemeProvider themeKey="house">
      <PhoneScreen data-testid="phone" scroll={scroll}>
        <button type="button">Last control</button>
      </PhoneScreen>
    </ThemeProvider>,
  );
  return screen.getByTestId("phone");
}

describe("PhoneScreen adaptive height", () => {
  it("scrolls dense screens vertically without allowing horizontal drift", () => {
    const phone = renderScreen();
    expect(phone).toHaveStyle({ overflowY: "auto", overflowX: "hidden" });
    expect(phone).toHaveAttribute(
      "style",
      expect.stringContaining("-webkit-overflow-scrolling: touch"),
    );
    expect(phone.style.overscrollBehaviorY).toBe("contain");
  });

  it("keeps bottom controls above a phone safe area", () => {
    const phone = renderScreen();
    // Additive, not max(): with `viewport-fit=cover` on the player group the
    // inset is system furniture drawn ON TOP of the screen, so it has to be
    // reserved on top of the normal 26px, not instead of it (issue #171).
    expect(phone.style.paddingBottom).toBe(
      "calc(26px + env(safe-area-inset-bottom))",
    );
  });

  it("can remain fit-to-viewport for the timed question interaction", () => {
    const phone = renderScreen("locked");
    expect(phone).toHaveStyle({ overflowY: "hidden", overflowX: "hidden" });
  });
});
