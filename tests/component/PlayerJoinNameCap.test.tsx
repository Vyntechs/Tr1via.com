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

describe("name box review 2 fixes", () => {
  it("leaves a Japanese/Chinese conversion alone until it finishes, then fits it", () => {
    const onSubmit = vi.fn();
    render(wrap(<PlayerJoin playerName="" onSubmit={onSubmit} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCDEFGHIJKLMN" } }); // 14
    fireEvent.compositionStart(input);
    typeAt(input, "ABCDEFGHIJKLMNy", 15);
    typeAt(input, "ABCDEFGHIJKLMNや", 15);
    typeAt(input, "ABCDEFGHIJKLMNやま", 16);
    typeAt(input, "ABCDEFGHIJKLMNやまだ", 17);
    // Over 16 while converting: not touched, so the keyboard isn't interrupted.
    expect(input.value).toBe("ABCDEFGHIJKLMNやまだ");
    typeAt(input, "ABCDEFGHIJKLMN山田太郎", 18);
    expect(input.value).toBe("ABCDEFGHIJKLMN山田太郎");
    fireEvent.compositionEnd(input);
    // Conversion done: only the inserted part is cut to fit.
    expect(input.value).toBe("ABCDEFGHIJKLMN山田");
    expect(input.selectionStart).toBe(16);
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("16/16");
    // Safari sends one more plain input after the conversion: no change.
    typeAt(input, "ABCDEFGHIJKLMN山田", 16);
    expect(input.value).toBe("ABCDEFGHIJKLMN山田");
    fireEvent.click(screen.getByTestId("player-join-submit"));
    expect(onSubmit).toHaveBeenCalledWith("ABCDEFGHIJKLMN山田");
  });

  it("submitting mid-conversion still sends at most 16 characters", () => {
    const onSubmit = vi.fn();
    render(wrap(<PlayerJoin playerName="" onSubmit={onSubmit} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABCDEFGHIJKLMN" } });
    fireEvent.compositionStart(input);
    typeAt(input, "ABCDEFGHIJKLMNzhangwei", 22);
    fireEvent.click(screen.getByTestId("player-join-submit"));
    expect(onSubmit).toHaveBeenCalledWith("ABCDEFGHIJKLMNzh");
  });

  it("paste over a selection in a full box pastes what fits and keeps the rest", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abcdefghijklmnop" } });
    // "abc" selected, "XYZW" pasted: the browser leaves the cursor after it.
    typeAt(input, "XYZWdefghijklmnop", 4);
    expect(input.value).toBe("XYZdefghijklmnop");
    expect(input.selectionStart).toBe(3);
    // Select-all + paste replaces the whole name.
    typeAt(input, "Christopher Columbus", 20);
    expect(input.value).toBe("Christopher Colu");
    expect(input.selectionStart).toBe(16);
  });

  it("paste in the middle keeps the end of what was typed, cursor after the paste", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Bob the Builder" } });
    typeAt(input, "Captain Bob the Builder", 8);
    expect(input.value).toBe("CBob the Builder");
    expect(input.selectionStart).toBe(1);
  });

  it("an invisible-only name can't join; a direction override is stripped", () => {
    const onSubmit = vi.fn();
    render(wrap(<PlayerJoin playerName="" onSubmit={onSubmit} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    const submit = screen.getByTestId("player-join-submit");
    fireEvent.change(input, { target: { value: "\u200B\u200B\u3164\u2800" } });
    expect(input.value).toBe("");
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: "\u202Eevil name" } });
    expect(input.value).toBe("evil name");
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("evil name");
  });

  it("host latecomer box: same conversion handling and invisible-only check", () => {
    render(<AddLatecomerModal onCancel={() => {}} onSubmit={async () => {}} />);
    const input = screen.getByTestId("latecomer-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "\u200B\u3164" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "ABCDEFGHIJKLMN" } });
    fireEvent.compositionStart(input);
    typeAt(input, "ABCDEFGHIJKLMNやまだ", 17);
    expect(input.value).toBe("ABCDEFGHIJKLMNやまだ");
    typeAt(input, "ABCDEFGHIJKLMN山田太郎", 18);
    fireEvent.compositionEnd(input);
    expect(input.value).toBe("ABCDEFGHIJKLMN山田");
  });
});

describe("review 3: Android Gboard composing a Latin word past 16", () => {
  it("counter stays at 16/16, no full note until the word ends, then the box is cut", () => {
    render(wrap(<PlayerJoin playerName="" onSubmit={() => {}} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    const note = screen.getByTestId("player-name-limit-note");
    fireEvent.change(input, { target: { value: "Christopher " } }); // 12
    fireEvent.compositionStart(input);
    typeAt(input, "Christopher J", 13);
    typeAt(input, "Christopher Joh", 15);
    typeAt(input, "Christopher John", 16);
    typeAt(input, "Christopher Johns", 17);
    typeAt(input, "Christopher Johnson", 19);
    expect(input.value).toBe("Christopher Johnson"); // untouched mid-word
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("16/16");
    expect(screen.getByTestId("player-name-counter")).not.toHaveTextContent("19");
    expect(note).toHaveTextContent("");
    fireEvent.compositionEnd(input);
    expect(input.value).toBe("Christopher John");
    expect(screen.getByTestId("player-name-counter")).toHaveTextContent("16/16");
    expect(note).toHaveTextContent("Name is full, 16 characters.");
  });

  it("the Enter that confirms a conversion does not submit; a real Enter does", () => {
    const onSubmit = vi.fn();
    render(wrap(<PlayerJoin playerName="" onSubmit={onSubmit} />));
    const input = screen.getByTestId("player-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Maya" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.submit(input.form!);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    fireEvent.submit(input.form!);
    expect(onSubmit).toHaveBeenCalledWith("Maya");
  });
});

describe("review 3: host latecomer box and the conversion Enter", () => {
  it("Enter that confirms a conversion does not add the latecomer", () => {
    const onSubmit = vi.fn(async () => {});
    render(<AddLatecomerModal onCancel={() => {}} onSubmit={onSubmit} />);
    const input = screen.getByTestId("latecomer-name-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "山田" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    expect(onSubmit).toHaveBeenCalledWith("山田");
  });
});

