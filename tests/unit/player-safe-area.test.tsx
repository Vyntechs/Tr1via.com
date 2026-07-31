// @vitest-environment jsdom
// Issue #171 — the player phone must reserve the device's system furniture
// (Android gesture nav bar, iPhone home indicator) instead of letting it sit
// on top of the last answer card.
//
// Two halves have to hold together, and each is useless without the other:
//   1. the player route group opts into `viewport-fit=cover`, which is what
//      makes `env(safe-area-inset-*)` resolve to anything but 0px;
//   2. PhoneScreen ADDS those insets to its padding rather than max()-ing
//      them, so the inset is reserved on top of the normal breathing room.
// A headless browser reports zero insets, so this is the durable guard.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { viewport } from "@/app/(player)/layout";
import { PhoneScreen } from "@/components/shells/PhoneScreen";
import { ThemeProvider } from "@/components/system/ThemeProvider";

describe("player surface safe-area handling", () => {
  it("opts the player route group into viewport-fit=cover", () => {
    expect(viewport.viewportFit).toBe("cover");
  });

  it("keeps the phone viewport at device width so the opt-in changes nothing else", () => {
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
  });

  it("adds the safe-area insets to PhoneScreen padding instead of replacing it", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider themeKey="house">
        <PhoneScreen data-testid="screen">
          <div />
        </PhoneScreen>
      </ThemeProvider>,
    );
    // `max(26px, env(...))` would let a 48px nav bar eat the padding whole;
    // the inset has to stack on top of it.
    expect(html).toContain("padding-bottom:calc(26px + env(safe-area-inset-bottom))");
    expect(html).not.toContain("max(26px, env(safe-area-inset-bottom))");
  });
});
