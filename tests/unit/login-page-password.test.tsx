// /login page — email + password.
//
// Proves: a password box with a working "Show password" switch; sign-in
// posts email + password to /api/auth/login; a pre-password account sees
// the "Text Brandon" message; an unknown email flips to account creation
// with a "Type it again" box that posts to /api/auth/host-access.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, refresh: h.refresh, push: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import LoginPage from "@/app/(host)/login/page";
import { ThemeProvider } from "@/components/system";

function HostLoginPage() {
  return (
    <ThemeProvider themeKey="house">
      <LoginPage />
    </ThemeProvider>
  );
}

const fetchMock = vi.fn();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email", { exact: true }), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: password } });
}

describe("/login with passwords", () => {
  it("has a password box whose Show password switch reveals the letters", () => {
    render(<HostLoginPage />);
    const pw = screen.getByLabelText("Password", { exact: true }) as HTMLInputElement;
    expect(pw.type).toBe("password");
    fireEvent.click(screen.getByTestId("show-password-toggle"));
    expect(pw.type).toBe("text");
  });

  it("signs in with email + password and returns to /host", async () => {
    respond(200, { ok: true });
    render(<HostLoginPage />);
    fill("brandon@vyntechs.com", "trivia-night");
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/host"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(JSON.parse(init.body)).toEqual({ email: "brandon@vyntechs.com", password: "trivia-night" });
  });

  it("shows the Text Brandon message for an account without a password", async () => {
    respond(403, {
      code: "no_password",
      error: "This account doesn't have a password yet. Text Brandon for a sign-in link.",
    });
    render(<HostLoginPage />);
    fill("heather@example.com", "anything1");
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account doesn't have a password yet. Text Brandon for a sign-in link.",
    );
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("offers to create an account for an unknown email, then signs up", async () => {
    respond(404, { code: "no_account", error: "We don't have an account for that email yet." });
    render(<HostLoginPage />);
    fill("new@example.com", "trivia-night");
    fireEvent.click(screen.getByTestId("login-submit"));
    const again = await screen.findByLabelText("Type it again");
    expect(screen.getByTestId("login-notice")).toHaveTextContent(/don't have an account/);

    fireEvent.change(again, { target: { value: "trivia-night" } });
    respond(200, { ok: true });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/host"));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/auth/host-access");
    expect(JSON.parse(init.body)).toEqual({
      email: "new@example.com",
      password: "trivia-night",
      confirm: "trivia-night",
    });
  });

  it("catches mismatched passwords on sign-up before calling the server", async () => {
    render(<HostLoginPage />);
    fireEvent.click(screen.getByTestId("login-mode-switch"));
    fill("new@example.com", "trivia-night");
    fireEvent.change(screen.getByLabelText("Type it again"), { target: { value: "trivia-nite" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
