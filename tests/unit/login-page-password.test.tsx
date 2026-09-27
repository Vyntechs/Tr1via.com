// /login page — email first, then the step the server picks.
//
// Proves: step 1 looks like today's live page (one email box, one button,
// no password box, no "No password, no email check" claim); a password
// account gets a password box with "Show password" and "Forgot password?";
// an account with no password gets the 6-digit code step (masked email,
// "Send a new code", "Check spam, or text Brandon") and a correct code goes
// on to "Create your password"; a new email picks a password, proves the
// email with a code, then the account is created.

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

function call(i: number) {
  const [url, init] = fetchMock.mock.calls[i];
  return { url, body: JSON.parse(init.body) };
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

async function submitEmail(email: string) {
  fireEvent.change(screen.getByLabelText("Email", { exact: true }), { target: { value: email } });
  fireEvent.click(screen.getByTestId("login-submit"));
}

describe("/login step 1 — looks like today's page", () => {
  it("shows the same headline, one email box and one button — no password box", () => {
    render(<HostLoginPage />);
    expect(document.body).toHaveTextContent("Your game.");
    expect(document.body).toHaveTextContent("Your control.");
    expect(screen.getByLabelText("Email", { exact: true })).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toHaveTextContent("Sign in or start free");
    expect(screen.queryByLabelText("Password", { exact: true })).toBeNull();
    expect(document.body).not.toHaveTextContent(/no password|no email check/i);
  });

  it("posts only the email to /api/auth/start", async () => {
    respond(200, { step: "password" });
    render(<HostLoginPage />);
    await submitEmail("brandon@vyntechs.com");
    await screen.findByLabelText("Password", { exact: true });
    expect(call(0)).toEqual({ url: "/api/auth/start", body: { email: "brandon@vyntechs.com" } });
  });
});

describe("/login — account with a password", () => {
  it("password box + Show password, then signs in and returns to /host", async () => {
    respond(200, { step: "password" });
    render(<HostLoginPage />);
    await submitEmail("brandon@vyntechs.com");
    const pw = (await screen.findByLabelText("Password", { exact: true })) as HTMLInputElement;
    expect(pw.type).toBe("password");
    fireEvent.click(screen.getByTestId("show-password-toggle"));
    expect(pw.type).toBe("text");
    expect(screen.getByTestId("login-email-shown")).toHaveTextContent("brandon@vyntechs.com");

    fireEvent.change(pw, { target: { value: "trivia-night" } });
    respond(200, { ok: true });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/host"));
    expect(call(1)).toEqual({
      url: "/api/auth/login",
      body: { email: "brandon@vyntechs.com", password: "trivia-night" },
    });
  });

  it("Forgot password? emails a reset code, then a correct code goes to 'Choose a new password'", async () => {
    respond(200, { step: "password" });
    render(<HostLoginPage />);
    await submitEmail("brandon@vyntechs.com");
    await screen.findByLabelText("Password", { exact: true });

    respond(200, { ok: true, maskedEmail: "b***@vyntechs.com" });
    fireEvent.click(screen.getByTestId("login-forgot"));
    expect(await screen.findByTestId("login-code-sent")).toHaveTextContent(
      "We emailed a 6-digit code to b***@vyntechs.com. Type it here.",
    );
    expect(document.body).toHaveTextContent("RESET YOUR PASSWORD");
    expect(call(1)).toEqual({
      url: "/api/auth/send-code",
      body: { email: "brandon@vyntechs.com", purpose: "reset" },
    });

    respond(200, { ok: true, redirect: "/host/set-password?from=reset&next=%2Fhost" });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/host/set-password?from=reset&next=%2Fhost"),
    );
    expect(call(2)).toEqual({
      url: "/api/auth/verify-code",
      body: { email: "brandon@vyntechs.com", purpose: "reset", code: "123456", next: "/host" },
    });
  });
});

describe("/login — account with no password yet (Heather)", () => {
  it("Step 1 of 2: code step with masked email, big boxes, resend and help line", async () => {
    respond(200, { step: "code", purpose: "login", maskedEmail: "h***@example.com" });
    render(<HostLoginPage />);
    await submitEmail("heather@example.com");
    expect(await screen.findByTestId("login-code-sent")).toHaveTextContent(
      "We emailed a 6-digit code to h***@example.com. Type it here.",
    );
    expect(document.body).toHaveTextContent("STEP 1 OF 2 · CHECK YOUR EMAIL");
    expect(document.body).toHaveTextContent("Didn't get it? Check spam, or text Brandon.");
    for (let i = 0; i < 6; i++) expect(screen.getByTestId(`code-box-${i}`)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password", { exact: true })).toBeNull();

    respond(200, { ok: true, maskedEmail: "h***@example.com" });
    fireEvent.click(screen.getByTestId("login-resend"));
    expect(await screen.findByTestId("login-notice")).toHaveTextContent(/sent a new code/);
    expect(call(1)).toEqual({
      url: "/api/auth/send-code",
      body: { email: "heather@example.com", purpose: "login" },
    });
  });

  it("pasting the code fills the boxes and signs in → Create your password", async () => {
    respond(200, { step: "code", purpose: "login", maskedEmail: "h***@example.com" });
    render(<HostLoginPage />);
    await submitEmail("heather@example.com");
    const input = await screen.findByLabelText("6-digit code");
    respond(200, { ok: true, redirect: "/host/set-password?from=code&next=%2Fhost" });
    fireEvent.change(input, { target: { value: "12 34 56" } });
    expect(screen.getByTestId("code-box-0")).toHaveTextContent("1");
    expect(screen.getByTestId("code-box-5")).toHaveTextContent("6");
    await waitFor(() =>
      expect(h.replace).toHaveBeenCalledWith("/host/set-password?from=code&next=%2Fhost"),
    );
    expect(call(1).body).toMatchObject({ purpose: "login", code: "123456" });
  });

  it("a wrong code shows a plain message and clears the boxes", async () => {
    respond(200, { step: "code", purpose: "login", maskedEmail: "h***@example.com" });
    render(<HostLoginPage />);
    await submitEmail("heather@example.com");
    const input = (await screen.findByLabelText("6-digit code")) as HTMLInputElement;
    respond(400, {
      code: "wrong_code",
      error: "That code doesn't match. Check the newest email from TR1VIA and try again.",
    });
    fireEvent.change(input, { target: { value: "000000" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That code doesn't match.");
    expect(input.value).toBe("");
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("if the code can't be sent, says to text Brandon and stays on step 1", async () => {
    respond(503, {
      code: "code_not_sent",
      error: "We couldn't send the code. Text Brandon for a sign-in link.",
    });
    render(<HostLoginPage />);
    await submitEmail("heather@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't send the code. Text Brandon for a sign-in link.",
    );
    expect(screen.getByLabelText("Email", { exact: true })).toBeInTheDocument();
  });
});

describe("/login — brand-new host", () => {
  it("picks a password, proves the email with a code, then the account is created", async () => {
    respond(200, { step: "signup" });
    render(<HostLoginPage />);
    await submitEmail("new@example.com");
    expect(await screen.findByText("STEP 1 OF 2 · CREATE YOUR PASSWORD")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "trivia-night" },
    });
    fireEvent.change(screen.getByLabelText("Type it again"), { target: { value: "trivia-night" } });

    respond(200, { ok: true, maskedEmail: "n***@example.com" });
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("STEP 2 OF 2 · CHECK YOUR EMAIL")).toBeInTheDocument();
    expect(call(1)).toEqual({
      url: "/api/auth/send-code",
      body: { email: "new@example.com", purpose: "signup" },
    });

    respond(200, { ok: true });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "654321" } });
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/host"));
    expect(call(2)).toEqual({
      url: "/api/auth/host-access",
      body: {
        email: "new@example.com",
        password: "trivia-night",
        confirm: "trivia-night",
        code: "654321",
      },
    });
  });

  it("catches mismatched passwords before emailing a code", async () => {
    respond(200, { step: "signup" });
    render(<HostLoginPage />);
    await submitEmail("new@example.com");
    fireEvent.change(await screen.findByLabelText("Password", { exact: true }), {
      target: { value: "trivia-night" },
    });
    fireEvent.change(screen.getByLabelText("Type it again"), { target: { value: "trivia-nite" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/don't match/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("'Use a different email' goes back to step 1", async () => {
    respond(200, { step: "signup" });
    render(<HostLoginPage />);
    await submitEmail("new@example.com");
    fireEvent.click(await screen.findByTestId("login-change-email"));
    expect(screen.getByLabelText("Email", { exact: true })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password", { exact: true })).toBeNull();
  });
});

describe("/login — plain words for a non-technical host", () => {
  function pending() {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
    return (status: number, body: unknown) =>
      resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  }

  it("the trial line says what actually happens", () => {
    render(<HostLoginPage />);
    expect(document.body).toHaveTextContent(
      "NEW HERE? TYPE YOUR EMAIL, THEN PICK A PASSWORD TO START YOUR FREE TRIAL.",
    );
    expect(document.body).not.toHaveTextContent(/JUST TYPE YOUR EMAIL/);
  });

  it("'Forgot password?' shows 'Sending your code…', not 'Signing in…'", async () => {
    respond(200, { step: "password" });
    render(<HostLoginPage />);
    await submitEmail("brandon@vyntechs.com");
    await screen.findByLabelText("Password", { exact: true });
    const finish = pending();
    fireEvent.click(screen.getByTestId("login-forgot"));
    expect(await screen.findByTestId("login-submit")).toHaveTextContent("Sending your code…");
    expect(screen.getByTestId("login-submit")).not.toHaveTextContent("Signing in");
    finish(200, { ok: true, maskedEmail: "b***@vyntechs.com" });
    expect(await screen.findByText("RESET YOUR PASSWORD · CHECK YOUR EMAIL")).toBeInTheDocument();
  });

  it("the email step never claims to be signing in while it looks the email up", async () => {
    render(<HostLoginPage />);
    const finish = pending();
    await submitEmail("heather@example.com");
    expect(screen.getByTestId("login-submit")).toHaveTextContent("One moment…");
    finish(200, { step: "code", purpose: "login", maskedEmail: "h***@example.com" });
    expect(await screen.findByTestId("login-code-sent")).toBeInTheDocument();
  });

  it("new-account screen: 'Is this right? <email>' with 'Use a different email' right there", async () => {
    respond(200, { step: "signup" });
    render(<HostLoginPage />);
    await submitEmail("heahter@example.com");
    const check = await screen.findByTestId("login-signup-email-check");
    expect(check).toHaveTextContent("Is this right?");
    expect(check).toHaveTextContent("heahter@example.com");
    expect(check).toHaveTextContent("Use a different email");
  });
});
