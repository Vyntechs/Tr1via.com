import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Proof } from "@/components/marketing/Proof";

describe("Proof", () => {
  it("renders NO quote when none is provided (never fabricates one)", () => {
    const { queryByTestId } = render(<Proof quote={null} />);
    expect(queryByTestId("proof-quote")).toBeNull();
  });

  it("still shows honest signal when there is no quote", () => {
    const { getByText } = render(<Proof quote={null} />);
    expect(getByText(/running weekly/i)).toBeTruthy();
  });

  it("renders the real quote with anonymous attribution when provided", () => {
    const { getByTestId } = render(
      <Proof
        quote={{ text: "My Tuesdays are packed now.", attribution: "a host running TR1VIA weekly" }}
      />,
    );
    const q = getByTestId("proof-quote");
    expect(q.textContent).toContain("My Tuesdays are packed now.");
    expect(q.textContent).not.toMatch(/heather/i); // never the real name
  });
});
