// Join screen name box: stops at 16 visible characters, shows a quiet
// "n/16" counter, and shortens an old long prefilled name so a returning
// player can still tap Join.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerJoin } from "@/components/player/PlayerJoin";

function wrap(node: ReactNode, themeKey: "house" | "october" | "september" = "house") {
  return <ThemeProvider themeKey={themeKey}>{node}</ThemeProvider>;
}

describe("PlayerJoin name cap", () => {
  it("shows a counter that follows what is typed", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("0/16");
    fireEvent.change(input, { target: { value: "Maya" } });
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("4/16");
  });

  it("stops at 16 characters", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCDEFGHIJKLMNOPQRST" } });
    expect(input.value).toBe("ABCDEFGHIJKLMNOP");
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("16/16");
  });

  it("counts an emoji as one and never cuts one in half", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Pizza Party Pal🍕🍕" } });
    expect(input.value).toBe("Pizza Party Pal🍕");
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("16/16");
  });

  it("shortens a long prefilled name and still lets the player join", () => {
    const onSubmit = vi.fn();
    render(wrap(<PlayerJoin playerName="Bartholomew The Magnificent" onSubmit={onSubmit} />, "october"));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    expect(input.value).toBe("Bartholomew The ");
    const submit = screen.getByTestId("player-join-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("Bartholomew The");
  });

  it("adds no counter to the static design preview", () => {
    render(wrap(<PlayerJoin />, "september"));
    expect(screen.queryByTestId("player-name-counter")).not.toBeInTheDocument();
  });
});
