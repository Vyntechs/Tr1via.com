// components/host/CodeBoxes — pasting the emailed code.
//
// Proves: the input has no maxLength (the browser would cut " 123456" or
// "123 456" to six characters BEFORE the digits are picked out), and
// whatever lands in it becomes the first six digits.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeBoxes, codeDigits } from "@/components/host/CodeBoxes";
import { ThemeProvider } from "@/components/system";

afterEach(() => cleanup());

describe("CodeBoxes paste", () => {
  it("has no maxLength, so a pasted code with spaces or words isn't cut short", () => {
    render(
      <ThemeProvider themeKey="house">
        <CodeBoxes value="" onChange={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("login-code-input")).not.toHaveAttribute("maxlength");
  });

  it.each([
    ["123 456", "123456"],
    [" 123456", "123456"],
    ["Your code: 123456", "123456"],
    ["123-456", "123456"],
    ["1234567890", "123456"],
    ["12", "12"],
  ])("pasting %j → %j", (pasted, digits) => {
    const onChange = vi.fn();
    render(
      <ThemeProvider themeKey="house">
        <CodeBoxes value="" onChange={onChange} />
      </ThemeProvider>,
    );
    fireEvent.change(screen.getByTestId("login-code-input"), { target: { value: pasted } });
    expect(onChange).toHaveBeenCalledWith(digits);
    expect(codeDigits(pasted)).toBe(digits);
  });
});
