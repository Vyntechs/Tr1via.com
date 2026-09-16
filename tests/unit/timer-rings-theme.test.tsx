import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { TimerRing } from "@/components/system/TimerRing";
import { TVTimerArc } from "@/components/system/TVTimerArc";
import type { ThemeKey } from "@/lib/theme/tokens";
import type { ReactNode } from "react";

// Both components call useTheme() internally, so they must render inside a ThemeProvider.
function wrap(node: ReactNode, themeKey: ThemeKey = "house") {
  return <ThemeProvider themeKey={themeKey}>{node}</ThemeProvider>;
}

// Grabs the last circle with stroke-dashoffset — that's the main progress arc.
// (TimerRing also renders a bonus-indicator arc earlier in the SVG.)
function getProgressCircle(container: HTMLElement) {
  const all = container.querySelectorAll("circle[stroke-dashoffset]");
  return all[all.length - 1];
}

describe("TimerRing themeKey", () => {
  it("uses max=25 when themeKey='may' and max prop is omitted", () => {
    // seconds=25 fills the arc completely only when resolvedMax=25
    const { container } = render(wrap(<TimerRing seconds={25} themeKey="may" accent="#fff" />));
    const circle = getProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("uses the 25s default (house context) when themeKey is omitted", () => {
    // seconds=25 fills the arc completely only when resolvedMax=25
    const { container } = render(wrap(<TimerRing seconds={25} accent="#fff" />));
    const circle = getProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("respects explicit max prop over themeKey", () => {
    // max=10 wins even though themeKey='may' would give max=30
    const { container } = render(wrap(<TimerRing seconds={10} themeKey="may" max={10} accent="#fff" />));
    const circle = getProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });
});

// The bonus-indicator arc is the FIRST circle with a dashoffset (drawn before
// the progress arc). Only present while seconds > resolvedMax - 5.
function getBonusCircle(container: HTMLElement) {
  return container.querySelectorAll("circle[stroke-dashoffset]")[0];
}

// Grabs the progress arc circle from TVTimerArc — it renders exactly one
// circle with stroke-dashoffset (the background ring has no dashoffset).
function getTVProgressCircle(container: HTMLElement) {
  const all = container.querySelectorAll("circle[stroke-dashoffset]");
  return all[all.length - 1];
}

// Regression: render sites (PlayerQuestion, TVQuestion, HostPhoneLive, PlayerLocked)
// pass NEITHER themeKey NOR max. The ring must therefore read the ACTIVE theme from
// context — otherwise it can pin a stale max while the timer counts from 25, so the
// arc sits full before depleting ("lapping"). seconds=23 is inside the 25s
// speed-bonus window (seconds > 25 - 5 = 20), so the bonus arc renders too.
describe("rings fall back to the active theme's duration (no lapping)", () => {
  it("TimerRing reads the ThemeProvider theme when themeKey/max omitted — 25", () => {
    // At 23s into a 25s theme the arc must be partially depleted.
    const ctx = render(wrap(<TimerRing seconds={23} accent="#fff" />, "may"));
    const ref = render(wrap(<TimerRing seconds={23} max={25} accent="#fff" />));
    expect(getProgressCircle(ctx.container)?.getAttribute("stroke-dashoffset")).toBe(
      getProgressCircle(ref.container)?.getAttribute("stroke-dashoffset"),
    );
    expect(getProgressCircle(ctx.container)?.getAttribute("stroke-dashoffset")).not.toBe("0");
  });

  it("TimerRing scales the speed-bonus arc to the theme — 5/25 on may", () => {
    const ctx = render(wrap(<TimerRing seconds={23} accent="#fff" />, "may"));
    const ref = render(wrap(<TimerRing seconds={23} max={25} accent="#fff" />));
    expect(getBonusCircle(ctx.container)?.getAttribute("stroke-dasharray")).toBe(
      getBonusCircle(ref.container)?.getAttribute("stroke-dasharray"),
    );
  });

  it("TVTimerArc reads the ThemeProvider theme when themeKey/max omitted — 25", () => {
    const ctx = render(wrap(<TVTimerArc seconds={23} accent="#fff" />, "may"));
    const ref = render(wrap(<TVTimerArc seconds={23} max={25} accent="#fff" />));
    expect(getTVProgressCircle(ctx.container)?.getAttribute("stroke-dashoffset")).toBe(
      getTVProgressCircle(ref.container)?.getAttribute("stroke-dashoffset"),
    );
    expect(getTVProgressCircle(ctx.container)?.getAttribute("stroke-dashoffset")).not.toBe("0");
  });
});

describe("TVTimerArc themeKey", () => {
  it("uses max=25 when themeKey='may' and max prop is omitted", () => {
    // seconds=25 fills the arc completely only when resolvedMax=25
    const { container } = render(wrap(<TVTimerArc seconds={25} themeKey="may" accent="#fff" />));
    const circle = getTVProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("uses the 25s default (house context) when themeKey is omitted", () => {
    // seconds=25 fills the arc completely only when resolvedMax=25
    const { container } = render(wrap(<TVTimerArc seconds={25} accent="#fff" />));
    const circle = getTVProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });
});
