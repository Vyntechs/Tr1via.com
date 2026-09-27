// /host/set-password wording for each way a host arrives.
//   from=code  → "Step 2 of 2 · Create your password"
//   from=reset → "Choose a new password"
//   (none)     → the in-app prompt, unchanged

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SetPasswordClient } from "@/app/host/set-password/SetPasswordClient";
import { ThemeProvider } from "@/components/system";

afterEach(cleanup);

function renderFrom(from: "code" | "reset" | null) {
  render(
    <ThemeProvider themeKey="house">
      <SetPasswordClient returnPath="/host" from={from} />
    </ThemeProvider>,
  );
}

describe("set-password walkthrough wording", () => {
  it("after an emailed code: Step 2 of 2 · Create your password", () => {
    renderFrom("code");
    expect(screen.getByTestId("set-password-step")).toHaveTextContent("STEP 2 OF 2 · CREATE YOUR PASSWORD");
    expect(document.body).toHaveTextContent("Create your password");
    expect(screen.getByTestId("set-password-submit")).toHaveTextContent("Save my password");
  });

  it("after Forgot password?: Choose a new password", () => {
    renderFrom("reset");
    expect(document.body).toHaveTextContent("Choose a new password");
    expect(screen.getByTestId("set-password-submit")).toHaveTextContent("Save my new password");
  });

  it("the in-app prompt has no step label", () => {
    renderFrom(null);
    expect(screen.queryByTestId("set-password-step")).toBeNull();
    expect(document.body).toHaveTextContent("So only you can open your trivia nights.");
  });
});
