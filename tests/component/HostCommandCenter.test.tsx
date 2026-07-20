import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HostCommandCenter } from "@/components/host/HostCommandCenter";

describe("HostCommandCenter", () => {
  it("keeps every live control one tap away and reports current game truth", () => {
    const onNavigate = vi.fn();

    render(
      <HostCommandCenter
        stage="board"
        active="board"
        playerCount={31}
        lockedCount={0}
        delivery={{ tv: "current", currentPhones: 31, recoveringPhones: 0 }}
        onNavigate={onNavigate}
      >
        <div>Board body</div>
      </HostCommandCenter>,
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
});
