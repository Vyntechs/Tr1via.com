// Join screen name box: stops at 16 visible characters, shows a quiet
// "n/16" counter, and shortens an old long prefilled name so a returning
// player can still tap Join.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { PlayerJoin } from "@/components/player/PlayerJoin";
import { AddLatecomerModal } from "@/components/host/AddLatecomerModal";

// Simulate a keystroke the way a browser does: the box already holds the
// new text and the cursor sits right after the inserted letter.
function typeAt(input: HTMLInputElement, value: string, caret: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.setSelectionRange(caret, caret);
  fireEvent.input(input);
}

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
  it("at 16/16, typing in the middle is ignored: no lost last letter, cursor stays put", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Jennifer Thompso" } });
    expect(input.value).toBe("Jennifer Thompso");
    // Player taps after "Jennifer" and types "r".
    typeAt(input, "Jenniferr Thompso", 9);
    expect(input.value).toBe("Jennifer Thompso");
    expect(input.selectionStart).toBe(8);
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("16/16");
    // Deleting still works.
    fireEvent.change(input, { target: { value: "Jennifer Thomps" } });
    expect(input.value).toBe("Jennifer Thomps");
  });

  it("links the box to the hint and counter in words, with one quiet note at the cap", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    expect(input).toHaveAccessibleDescription(/Keep it kind\. 0 of 16 characters/);
    const note = screen.getByTestId("player-name-limit-note");
    expect(note).toHaveAttribute("aria-live", "polite");
    fireEvent.change(input, { target: { value: "Maya" } });
    expect(input).toHaveAccessibleDescription(/4 of 16 characters/);
    expect(note).toHaveTextContent(/^$/);
    fireEvent.change(input, { target: { value: "ABCDEFGHIJKLMNOPQ" } });
    expect(note).toHaveTextContent("Name is full, 16 characters.");
  });

  it("strips stacked glitch marks as they are typed or pasted", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Z" + "\u0301".repeat(40) + "ed" } });
    expect(input.value).toBe("Z" + "\u0301".repeat(3) + "ed");
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("3/16");
  });
});

describe("AddLatecomerModal name cap", () => {
  it("stops the host's latecomer box at 16 characters and ignores keys when full", () => {
    render(<AddLatecomerModal onCancel={() => {}} onSubmit={async () => {}} />);
    const input = screen.getByTestId("latecomer-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Christopher Smith Jr" } });
    expect(input.value).toBe("Christopher Smit");
    typeAt(input, "Christopherr Smit", 12);
    expect(input.value).toBe("Christopher Smit");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "Pizza Party Pal🍕🍕" } });
    expect(input.value).toBe("Pizza Party Pal🍕");
  });
});
