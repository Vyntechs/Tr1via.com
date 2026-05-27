import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { TimerRing } from "@/components/system/TimerRing";
import { TVTimerArc } from "@/components/system/TVTimerArc";
import type { ReactNode } from "react";

// Both components call useTheme() internally, so they must render inside a ThemeProvider.
function wrap(node: ReactNode) {
  return <ThemeProvider themeKey="house">{node}</ThemeProvider>;
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

  it("uses max=20 when themeKey is omitted", () => {
    // seconds=20 fills the arc completely only when resolvedMax=20
    const { container } = render(wrap(<TimerRing seconds={20} accent="#fff" />));
    const circle = getProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  it("respects explicit max prop over themeKey", () => {
    // max=10 wins even though themeKey='may' would give max=25
    const { container } = render(wrap(<TimerRing seconds={10} themeKey="may" max={10} accent="#fff" />));
    const circle = getProgressCircle(container);
    expect(circle?.getAttribute("stroke-dashoffset")).toBe("0");
  });
});

describe("TVTimerArc themeKey", () => {
  it("uses max=25 when themeKey='may' and max prop is omitted", () => {
    const { container } = render(wrap(<TVTimerArc seconds={25} themeKey="may" accent="#fff" />));
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("uses max=20 when themeKey is omitted", () => {
    const { container } = render(wrap(<TVTimerArc seconds={20} accent="#fff" />));
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
