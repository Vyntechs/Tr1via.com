import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HostCommandCenter } from "@/components/host/HostCommandCenter";
import { HostGameStatus } from "@/components/host/HostGameStatus";
import { ThemeProvider } from "@/components/system";
import { TR1VIA_THEMES } from "@/lib/theme/tokens";
import styles from "@/components/host/HostCommandCenter.module.css";

describe("HostCommandCenter", () => {
  it("keeps every live control one tap away and reports current game truth", () => {
    const onNavigate = vi.fn();

    render(
      <ThemeProvider themeKey="house">
        <HostCommandCenter
          stage="board"
          active="board"
          playerCount={31}
          lockedCount={0}
          delivery={{ tv: "current", currentPhones: 31, recoveringPhones: 0 }}
          onNavigate={onNavigate}
        >
          <div>Board body</div>
        </HostCommandCenter>
      </ThemeProvider>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("data-stage", "board");
    expect(screen.getByRole("navigation", { name: "Host controls" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Game Status")).toBeVisible();
    expect(screen.getByText("TV live")).toBeVisible();
    expect(screen.getByText("31 phones live")).toBeVisible();
    expect(screen.getByText("Board body")).toBeVisible();

    for (const section of ["Players", "Scores", "TV"]) {
      fireEvent.click(screen.getByRole("button", { name: section }));
    }

    expect(onNavigate).toHaveBeenNthCalledWith(1, "players");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "scores");
    expect(onNavigate).toHaveBeenNthCalledWith(3, "tv");
  });

  it("inherits the active monthly theme instead of forcing a July palette", () => {
    render(
      <ThemeProvider themeKey="april">
        <HostCommandCenter
          stage="board"
          playerCount={0}
          lockedCount={0}
          delivery={{ tv: "current", currentPhones: 0, recoveringPhones: 0 }}
          onNavigate={vi.fn()}
        >
          <div>Board body</div>
        </HostCommandCenter>
      </ThemeProvider>,
    );

    const shell = screen.getByRole("main");
    expect(shell.style.getPropertyValue("--host-paper")).toBe(TR1VIA_THEMES.april.paper);
    expect(shell.style.getPropertyValue("--host-accent")).toBe(TR1VIA_THEMES.april.accent);
  });

  it("uses scoped module classes for both the shell and standalone status", () => {
    const { container } = render(
      <ThemeProvider themeKey="house">
        <HostGameStatus
          stage="board"
          playerCount={1}
          lockedCount={0}
          delivery={{ tv: "current", currentPhones: 1, recoveringPhones: 0 }}
        />
      </ThemeProvider>,
    );

    expect(container.firstElementChild).toHaveClass(styles.status);
    expect(styles.root).not.toBe("host-command-center");
  });
});
