// /host/set-password wording for each way a host arrives.
//   from=code  → "Step 2 of 2 · Create your password"
//   from=reset → "Choose a new password"
//   (none)     → the in-app prompt, unchanged

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OTHER_DEVICES_NOTE, SetPasswordClient } from "@/app/host/set-password/SetPasswordClient";
import { ThemeProvider } from "@/components/system";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("says 'at least 8 characters' and warns about other devices before saving", () => {
    renderFrom(null);
    expect(document.body).toHaveTextContent("Use at least 8 characters.");
    expect(document.body).not.toHaveTextContent("letters or numbers");
    expect(document.body).toHaveTextContent(
      "This device stays signed in. Your phone or other computers will ask for the new password once.",
    );
  });

  it("the in-app prompt has no step label", () => {
    renderFrom(null);
    expect(screen.queryByTestId("set-password-step")).toBeNull();
    expect(document.body).toHaveTextContent("So only you can open your trivia nights.");
  });

  it("done screen says plainly that other devices will ask for the new password once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    renderFrom(null);
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "trivia-night" } });
    fireEvent.change(screen.getByLabelText("Type it again"), { target: { value: "trivia-night" } });
    fireEvent.click(screen.getByTestId("set-password-submit"));
    expect(await screen.findByTestId("set-password-other-devices")).toHaveTextContent(
      "If TR1VIA is open on your phone or another computer, it will ask you to sign in once with this new password.",
    );
    expect(OTHER_DEVICES_NOTE).toContain("sign in once with this new password");
  });

  it("saved but not signed back in → goes to /login, which says to sign in with the new password", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            code: "sign_in_again",
            error: "Your password is saved. Sign in with it now.",
            redirect: "/login?notice=password-saved&next=%2Fhost",
          }),
          { status: 409 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderFrom("code");
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "trivia-night" } });
    fireEvent.change(screen.getByLabelText("Type it again"), { target: { value: "trivia-night" } });
    fireEvent.click(screen.getByTestId("set-password-submit"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?notice=password-saved&next=%2Fhost"));
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.next).toBe("/host");
  });
});
