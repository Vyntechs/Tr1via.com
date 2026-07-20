import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostPhoneLive } from "@/components/host/HostPhoneLive";
import { resolveTheme } from "@/lib/theme/resolve";
import { contrastRatio, readableForeground } from "@/lib/theme/contrast";
import { THEME_KEYS } from "@/lib/theme/tokens";

describe("HostPhoneLive", () => {
  it("shows only aggregate live facts and an explicitly unconfirmed venue preview", () => {
    const { container } = render(
      <HostPhoneLive
        themeKey="march"
        secondsRemaining={21}
        lockedCount={24}
        totalPlayers={31}
        categoryName="Soaps"
        pointValue={300}
        prompt="Which antibacterial ingredient was ruled ineligible?"
      />,
    );

    expect(screen.getByText("21")).toBeVisible();
    expect(screen.getByText("24 of 31 locked")).toBeVisible();
    expect(screen.getByText("7 waiting")).toBeVisible();
    expect(screen.getAllByText(/Soaps · 300 pts/i)).toHaveLength(2);
    expect(screen.getAllByText("Which antibacterial ingredient was ruled ineligible?")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Expected venue TV question preview — not confirmed" })).toBeVisible();
    expect(screen.getByText("Venue TV not confirmed")).toBeVisible();
    expect(screen.queryByText(/connected|healthy|app-switched|suspicious/i)).not.toBeInTheDocument();
    expect(container.firstChild).toHaveStyle({ color: resolveTheme("march").ink });
  });

  it("never renders a negative waiting count and keeps every action at least 48px", () => {
    const onEndEarly = vi.fn();
    const onUndo = vi.fn();
    render(
      <HostPhoneLive
        themeKey="april"
        lockedCount={5}
        totalPlayers={3}
        onEndEarly={onEndEarly}
        onUndo={onUndo}
        canUndo
      />,
    );

    expect(screen.getByText("0 waiting")).toBeVisible();
    const endEarly = screen.getByRole("button", { name: /End early/ });
    const undo = screen.getByRole("button", { name: /Undo/ });
    expect(endEarly).toHaveStyle({ minHeight: "48px" });
    expect(undo).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(endEarly);
    fireEvent.click(undo);
    expect(onEndEarly).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it.each(THEME_KEYS)("keeps the %s primary action readable", (themeKey) => {
    render(<HostPhoneLive themeKey={themeKey} onEndEarly={vi.fn()} />);
    expect(screen.getByRole("button", { name: /End early/ })).toHaveStyle({
      color: readableForeground(resolveTheme(themeKey).accent),
    });
  });

  it.each(THEME_KEYS)("keeps every small %s live-status text role at AA contrast", (themeKey) => {
    const theme = resolveTheme(themeKey);
    render(<HostPhoneLive themeKey={themeKey} lockedCount={1} totalPlayers={2} />);
    for (const text of ["QUESTION LIVE", "1 waiting", "EXPECTED VENUE TV", "Venue TV not confirmed"]) {
      expect(screen.getByText(text)).toHaveStyle({ color: theme.ink });
      expect(contrastRatio(theme.ink, theme.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
