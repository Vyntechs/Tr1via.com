import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerLocked } from "@/components/player/PlayerLocked";
import type { ReactNode } from "react";

let reducedMotion = false;

vi.mock("@/lib/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => reducedMotion,
}));

afterEach(() => {
  reducedMotion = false;
});

function wrap(node: ReactNode) {
  return <ThemeProvider themeKey="june">{node}</ThemeProvider>;
}

describe("PlayerLocked — live lock-in count", () => {
  it("shows 'X of Y locked in' when lockedCount + totalPlayers are provided", () => {
    const { getByTestId } = render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} />));
    expect(getByTestId("lockin-progress").textContent).toMatch(/12 of 18 locked in/i);
  });

  it("fills the bar proportionally to count/total", () => {
    const { getByTestId } = render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} />));
    // 12 / 18 = 66.67% → rounded to 67%
    expect((getByTestId("lockin-fill") as HTMLElement).style.width).toBe("67%");
  });

  it("clamps the fill to 100% when everyone has locked in", () => {
    const { getByTestId } = render(wrap(<PlayerLocked lockedCount={18} totalPlayers={18} />));
    expect((getByTestId("lockin-fill") as HTMLElement).style.width).toBe("100%");
  });

  it("omits the live bar entirely when count/total are not provided (gallery/demo)", () => {
    const { queryByTestId } = render(wrap(<PlayerLocked />));
    expect(queryByTestId("lockin-progress")).toBeNull();
  });

  it("does not render the bar when totalPlayers is 0 (no divide-by-zero)", () => {
    const { queryByTestId } = render(wrap(<PlayerLocked lockedCount={0} totalPlayers={0} />));
    expect(queryByTestId("lockin-progress")).toBeNull();
  });

  it("can show the Room Magic sent line without removing the live lock-in count", () => {
    render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} roomMagicEnabled />));

    expect(screen.getByTestId("lockin-progress").textContent).toMatch(/12 of 18 locked in/i);
    expect(screen.getByText("Sent to the room.")).toBeInTheDocument();
  });

  it("marks the Room Magic confirmation with a stable test id", () => {
    render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} roomMagicEnabled />));

    expect(screen.getByTestId("player-house-lights-confirmation")).toHaveTextContent(
      "Sent to the room.",
    );
  });

  it("suppresses pulse animation in reduced motion mode", () => {
    reducedMotion = true;
    render(wrap(<PlayerLocked lockedCount={12} totalPlayers={18} roomMagicEnabled />));

    expect(screen.getByTestId("player-lockin-pulse-dot")).toHaveStyle({
      animation: "none",
    });
    expect(screen.getByTestId("player-waiting-pulse-dot")).toHaveStyle({
      animation: "none",
    });
  });
});
