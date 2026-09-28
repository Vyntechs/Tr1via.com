// HOST LOGIN — email first. Step 1 looks exactly like the page hosts
// already know: one email field, one "Sign in or start free" button.
// Wrapped in the shared host shell so the same door works on any device.
//
// POST /api/auth/start decides step 2 on the server:
//   - "password": the account has a password → password box, "Show
//     password", "Forgot password?" (emails a 6-digit reset code).
//     Sign-in: POST /api/auth/login.
//   - "code": the account has no password yet → the server just emailed a
//     6-digit code. Step 1 of 2 · Check your email → POST
//     /api/auth/verify-code → signed in → Step 2 of 2 · Create your
//     password (/host/set-password).
//   - "signup": no account → pick a password (+ type it again), then we
//     email a code to prove the address (POST /api/auth/send-code), then
//     POST /api/auth/host-access creates the account. The new host lands on
//     /host → /host/onboarding (no hosts row yet).
// The server writes the session cookies on its 200 response; the page then
// goes to a safe intended /host path.

"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LaptopShell } from "@/components/shells";
import { Display, Eyebrow, Wordmark, useTheme } from "@/components/system";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { hostReturnPath } from "@/lib/host/hostReturnPath";
import { PasswordField, ShowPasswordToggle } from "@/components/host/PasswordField";
import { CodeBoxes, CODE_BOX_COUNT } from "@/components/host/CodeBoxes";
import { checkNewPassword } from "@/lib/auth/password-gate";
import { PASSWORD_SAVED_SIGN_IN_MESSAGE } from "@/lib/auth/auth-messages";
import { HostWhatsNew } from "@/components/host/HostWhatsNew";
import { SIGN_IN_PASSWORD_NEWS } from "@/lib/host/whats-new";

type Step = "email" | "password" | "code" | "signup";
type CodePurpose = "login" | "reset" | "signup";

// While a request is out, the button says what's actually happening.
type Busy = "checking" | "signing-in" | "sending-code" | "checking-code";
const BUSY_LABEL: Record<Busy, string> = {
  checking: "One moment…",
  "signing-in": "Signing in…",
  "sending-code": "Sending your code…",
  "checking-code": "Checking…",
};

type FormState =
  | { kind: "idle" }
  | { kind: "sending"; busy: Busy }
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string };

interface ApiBody {
  step?: Step;
  purpose?: CodePurpose;
  maskedEmail?: string;
  redirect?: string;
  code?: string;
  error?: string;
  field?: string;
}

const OFFLINE_MESSAGE = "We couldn't reach TR1VIA. Check your internet, then try again.";

export default function HostLoginPage() {
  return (
    <LaptopShell>
      <HostLoginInner />
    </LaptopShell>
  );
}

function HostLoginInner() {
  const { t } = useTheme();
  const router = useRouter();
  // Below ~640px the two-column "pitch | form" splits into a single stacked
  // column so the email field + submit button are fully on-screen and tappable.
  const compact = useMediaQuery("(max-width: 640px)");
  const [step, setStep] = useState<Step>("email");
  // "What's new": why she's being asked for a code and a password. Opens
  // each time a host with no password yet gets a fresh code, so it stops
  // by itself once she has one.
  const [passwordNewsOpen, setPasswordNewsOpen] = useState(false);
  const [purpose, setPurpose] = useState<CodePurpose>("login");
  const [email, setEmail] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  // A new host's signup code that checked out but whose password Supabase
  // refused (its own password rules). The server didn't use the code up,
  // so after she picks a better password we try the same code again
  // instead of emailing a new one.
  const [signupCode, setSignupCode] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // If the visitor already has a session, show "signed in as X" with a
  // sign-out option BEFORE the email form. Solves the "I never get asked
  // for email" problem where a stale cookie silently inherited a session.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  function intendedHostPath() {
    return hostReturnPath(new URLSearchParams(window.location.search).get("next"));
  }

  useEffect(() => {
    // Sent here by /host/set-password when the password saved but this
    // device couldn't be signed back in.
    const passwordSaved =
      new URLSearchParams(window.location.search).get("notice") === "password-saved";
    const supabase = getSupabaseBrowser();
    supabase.auth
      .getUser()
      .then(({ data }) => setSignedInAs(data.user?.email ?? null))
      .catch(() => {})
      .finally(() => {
        if (passwordSaved) {
          setState((s) =>
            s.kind === "idle" ? { kind: "notice", message: PASSWORD_SAVED_SIGN_IN_MESSAGE } : s,
          );
        }
      });
  }, []);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore — refresh shows the form regardless
    }
    setSignedInAs(null);
    setSigningOut(false);
    router.refresh();
  }

  async function post(path: string, body: unknown): Promise<{ res: Response; body: ApiBody | null }> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    return { res, body: (await res.json().catch(() => null)) as ApiBody | null };
  }

  function goToCode(nextPurpose: CodePurpose, masked: string | undefined) {
    setSignupCode(null);
    setPurpose(nextPurpose);
    setMaskedEmail(masked ?? "");
    setCode("");
    setStep("code");
  }

  function startOver() {
    setSignupCode(null);
    setStep("email");
    setPasswordNewsOpen(false);
    setPassword("");
    setConfirm("");
    setCode("");
    setState({ kind: "idle" });
  }

  // Step 1 — email only.
  async function handleEmailSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    // Might send a code (no password yet) or not — the server decides.
    setState({ kind: "sending", busy: "checking" });
    try {
      const { res, body } = await post("/api/auth/start", { email: trimmed });
      if (body?.step === "code") {
        // 200 = code just sent. 429 = too many codes this hour; she can
        // still use the newest one she already has.
        goToCode("login", body.maskedEmail);
        setState(res.ok ? { kind: "idle" } : { kind: "error", message: body.error ?? "" });
        // Only when a code really just went out (the pop-up says so).
        if (res.ok) setPasswordNewsOpen(true);
        return;
      }
      if (res.ok && body?.step === "password") {
        setStep("password");
        setState({ kind: "idle" });
        return;
      }
      if (res.ok && body?.step === "signup") {
        setStep("signup");
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "error", message: body?.error ?? `Sign-in failed (${res.status})` });
    } catch {
      setState({ kind: "error", message: OFFLINE_MESSAGE });
    }
  }

  // Step 2 — password.
  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password) {
      setState({ kind: "error", message: "Please type your password." });
      return;
    }
    setState({ kind: "sending", busy: "signing-in" });
    try {
      const { res, body } = await post("/api/auth/login", { email: email.trim(), password });
      if (res.ok) {
        router.replace(intendedHostPath());
        return;
      }
      setState({ kind: "error", message: body?.error ?? `Sign-in failed (${res.status})` });
    } catch {
      setState({ kind: "error", message: OFFLINE_MESSAGE });
    }
  }

  // "Forgot password?", "Send a new code", and the new-account code.
  async function sendCode(nextPurpose: CodePurpose) {
    setState({ kind: "sending", busy: "sending-code" });
    try {
      const { res, body } = await post("/api/auth/send-code", {
        email: email.trim(),
        purpose: nextPurpose,
      });
      if (res.ok) {
        const alreadyOnCode = step === "code" && purpose === nextPurpose;
        goToCode(nextPurpose, body?.maskedEmail);
        setState(
          alreadyOnCode
            ? { kind: "notice", message: "We sent a new code. Use the one in the newest email." }
            : { kind: "idle" },
        );
        return;
      }
      if (body?.code === "too_many_codes") {
        // Same as the email step (/api/auth/start): she already has recent
        // codes for this, so show the code boxes with the message.
        goToCode(nextPurpose, body.maskedEmail ?? maskedEmail);
        setState({ kind: "error", message: body.error ?? "" });
        return;
      }
      if (body?.code === "account_exists") {
        setStep("password");
        setPassword("");
      }
      setState({ kind: "error", message: body?.error ?? `Something went wrong (${res.status})` });
    } catch {
      setState({ kind: "error", message: OFFLINE_MESSAGE });
    }
  }

  // New account — pick a password, then prove the email with a code.
  async function handleSignupSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const check = checkNewPassword(password, confirm);
    if (!check.ok) {
      setState({ kind: "error", message: check.error });
      return;
    }
    if (signupCode) {
      await submitCode(signupCode);
      return;
    }
    await sendCode("signup");
  }

  async function submitCode(digits: string) {
    if (state.kind === "sending") return;
    if (digits.length !== CODE_BOX_COUNT) {
      setState({ kind: "error", message: "Please type all 6 numbers from the email." });
      return;
    }
    setState({ kind: "sending", busy: "checking-code" });
    try {
      if (purpose === "signup") {
        const { res, body } = await post("/api/auth/host-access", {
          email: email.trim(),
          password,
          confirm,
          code: digits,
        });
        if (res.ok) {
          router.replace(intendedHostPath());
          return;
        }
        if (body?.code === "account_ready") {
          // Account made, but signing in right after failed: the code is
          // used up, so go to the normal password sign-in (her password is
          // still typed in).
          setSignupCode(null);
          setCode("");
          setStep("password");
          setState({ kind: "notice", message: body.error ?? "Your account is ready. Sign in with your password." });
          return;
        }
        if (body?.code === "account_exists") {
          setSignupCode(null);
          setStep("password");
          setPassword("");
        } else if (body?.field === "password" || body?.field === "confirm") {
          // The code was right and is still good; only the password needs fixing.
          setSignupCode(digits);
          setStep("signup");
        } else {
          setSignupCode(null);
          setCode("");
          setStep("code");
        }
        setState({ kind: "error", message: body?.error ?? `Something went wrong (${res.status})` });
        return;
      }
      const { res, body } = await post("/api/auth/verify-code", {
        email: email.trim(),
        purpose,
        code: digits,
        next: intendedHostPath(),
      });
      if (res.ok) {
        router.replace(body?.redirect ?? intendedHostPath());
        return;
      }
      setCode("");
      setState({ kind: "error", message: body?.error ?? `Something went wrong (${res.status})` });
    } catch {
      setState({ kind: "error", message: OFFLINE_MESSAGE });
    }
  }

  function handleCodeChange(digits: string) {
    setCode(digits);
    if (state.kind === "error") setState({ kind: "idle" });
    // Typing (or pasting) the 6th number sends it — one less tap.
    if (digits.length === CODE_BOX_COUNT) void submitCode(digits);
  }

  const closePasswordNews = useCallback(() => {
    setPasswordNewsOpen(false);
    // Straight to the code boxes, ready to type.
    requestAnimationFrame(() => document.getElementById("email-code")?.focus());
  }, []);

  const isSending = state.kind === "sending";
  const busyLabel = state.kind === "sending" ? BUSY_LABEL[state.busy] : "";

  return (
    <div
      data-host-mobile-surface="true"
      style={{
        // Natural height when stacked so the single column sits top-aligned
        // instead of the two rows centering apart with a gap between them.
        flex: compact ? "none" : 1,
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : "1fr 1fr",
        gap: compact ? 28 : 56,
        padding: compact ? "24px 20px max(24px, env(safe-area-inset-bottom))" : "40px 56px",
        overflow: compact ? "visible" : "hidden",
      }}
    >
      {/* Left — brand + pitch */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Wordmark size={26} />
        <Eyebrow color={t.accent} size={11} style={{ marginTop: 28, display: "block" }}>
          HOST · SIGN IN OR START FREE
        </Eyebrow>
        <Display
          size={compact ? 48 : 84}
          color={t.ink}
          weight={700}
          tracking={-0.04}
          style={{ marginTop: 14, display: "block", lineHeight: 0.95 }}
        >
          Your game.
          <br />
          <span style={{ color: t.accent }}>Your control.</span>
        </Display>
        <p
          style={{
            marginTop: 24,
            fontSize: 17,
            color: t.inkMid,
            lineHeight: 1.55,
            maxWidth: 460,
            fontWeight: 500,
          }}
        >
          Type your email to sign in &mdash; or to start a free 30-day
          trial if you&apos;re new.
        </p>
      </div>

      {/* Right — the current step, or the signed-in panel */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {signedInAs ? (
          <SignedInPanel
            email={signedInAs}
            onGoToDashboard={() => router.replace(intendedHostPath())}
            onSignOut={handleSignOut}
            signingOut={signingOut}
          />
        ) : step === "email" ? (
          <form onSubmit={handleEmailSubmit} style={formStyle}>
            <label htmlFor="email" style={labelStyle(t.inkMute)}>
              Email
            </label>
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={isSending}
              placeholder="you@yourplace.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                padding: "16px 18px",
                fontSize: 17,
                fontFamily: "var(--font-sans)",
                fontWeight: 500,
                color: t.ink,
                background: t.surface,
                border: `1px solid ${t.line}`,
                borderRadius: 12,
                outline: "none",
              }}
            />

            <PrimaryButton disabled={isSending || !email.trim()} dim={isSending}>
              {isSending ? busyLabel : "Sign in or start free  →"}
            </PrimaryButton>

            <Message state={state} />

            <Eyebrow color={t.inkMute} size={10} style={{ display: "block", marginTop: 10 }}>
              NEW HERE? TYPE YOUR EMAIL, THEN PICK A PASSWORD TO START YOUR FREE TRIAL.
            </Eyebrow>
            <LegalLinks />
          </form>
        ) : step === "password" ? (
          <form onSubmit={handlePasswordSubmit} style={formStyle}>
            <SigningInAs email={email.trim()} onChange={startOver} disabled={isSending} />
            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              revealed={revealed}
              autoComplete="current-password"
              disabled={isSending}
              autoFocus
            />
            <ShowPasswordToggle
              revealed={revealed}
              onToggle={() => setRevealed((v) => !v)}
              disabled={isSending}
            />
            <PrimaryButton disabled={isSending || !password} dim={isSending}>
              {isSending ? busyLabel : "Sign in  →"}
            </PrimaryButton>
            <Message state={state} />
            <LinkButton testId="login-forgot" onClick={() => sendCode("reset")} disabled={isSending}>
              Forgot password?
            </LinkButton>
          </form>
        ) : step === "signup" ? (
          <form onSubmit={handleSignupSubmit} style={formStyle}>
            {/* A regular host who mistyped her email lands here too — so the
                email comes first, big, with the way back right under it. */}
            <EmailCheck email={email.trim()} onChange={startOver} disabled={isSending} />
            <Eyebrow color={t.accent} size={11} style={{ display: "block", marginTop: 6 }}>
              STEP 1 OF 2 · CREATE YOUR PASSWORD
            </Eyebrow>
            <p style={leadStyle(t.ink)}>
              New to TR1VIA? Pick a password for your new account. Then we&apos;ll email you a
              6-digit code to make sure the email is yours.
            </p>
            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              revealed={revealed}
              autoComplete="new-password"
              disabled={isSending}
              autoFocus
            />
            <PasswordField
              id="confirm-password"
              label="Type it again"
              value={confirm}
              onChange={setConfirm}
              revealed={revealed}
              autoComplete="new-password"
              disabled={isSending}
            />
            <ShowPasswordToggle
              revealed={revealed}
              onToggle={() => setRevealed((v) => !v)}
              disabled={isSending}
            />
            <PrimaryButton disabled={isSending || !password || !confirm} dim={isSending}>
              {isSending ? busyLabel : "Continue  →"}
            </PrimaryButton>
            <Message state={state} />
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode(code);
            }}
            style={formStyle}
          >
            <Eyebrow color={t.accent} size={11} style={{ display: "block" }}>
              {purpose === "login"
                ? "STEP 1 OF 2 · CHECK YOUR EMAIL"
                : purpose === "signup"
                  ? "STEP 2 OF 2 · CHECK YOUR EMAIL"
                  : "RESET YOUR PASSWORD · CHECK YOUR EMAIL"}
            </Eyebrow>
            <p data-testid="login-code-sent" style={leadStyle(t.ink)}>
              We emailed a 6-digit code to{" "}
              <strong style={{ overflowWrap: "anywhere" }}>{maskedEmail || "your email"}</strong>.
              Type it here.
            </p>
            <CodeBoxes
              value={code}
              onChange={handleCodeChange}
              disabled={isSending}
              invalid={state.kind === "error"}
              autoFocus
              compact={compact}
            />
            <PrimaryButton disabled={isSending || code.length !== CODE_BOX_COUNT} dim={isSending}>
              {isSending
                ? busyLabel
                : purpose === "signup"
                  ? "Create my free account  →"
                  : "Continue  →"}
            </PrimaryButton>
            <Message state={state} />
            <LinkButton testId="login-resend" onClick={() => sendCode(purpose)} disabled={isSending}>
              Send a new code
            </LinkButton>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: t.inkMid, fontWeight: 500 }}>
              Didn&apos;t get it? Check spam, or text Brandon.
            </p>
            <LinkButton testId="login-start-over" onClick={startOver} disabled={isSending} muted>
              Use a different email
            </LinkButton>
          </form>
        )}
      </div>
      <HostWhatsNew
        open={passwordNewsOpen}
        news={SIGN_IN_PASSWORD_NEWS}
        onClose={closePasswordNews}
      />
    </div>
  );
}

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  maxWidth: 380,
} as const;

function labelStyle(color: string) {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color,
    fontWeight: 600,
  } as const;
}

function leadStyle(color: string) {
  return { margin: 0, fontSize: 18, lineHeight: 1.5, color, fontWeight: 500 } as const;
}

function PrimaryButton({
  children,
  disabled,
  dim,
}: {
  children: ReactNode;
  disabled: boolean;
  dim: boolean;
}) {
  const { t } = useTheme();
  return (
    <button
      type="submit"
      data-testid="login-submit"
      disabled={disabled}
      style={{
        marginTop: 4,
        padding: "18px 22px",
        background: t.accent,
        color: "#FFF",
        border: "none",
        borderRadius: 14,
        fontFamily: "var(--font-sans)",
        fontSize: 16,
        fontWeight: 700,
        cursor: dim ? "default" : "pointer",
        opacity: dim ? 0.7 : 1,
        boxShadow: `0 14px 28px -12px ${t.accent}66`,
        letterSpacing: "-0.005em",
      }}
    >
      {children}
    </button>
  );
}

function LinkButton({
  children,
  onClick,
  disabled,
  testId,
  muted = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  testId: string;
  muted?: boolean;
}) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        alignSelf: "flex-start",
        padding: 0,
        background: "transparent",
        border: "none",
        color: muted ? t.inkMid : t.accent,
        fontFamily: "var(--font-sans)",
        fontSize: 15,
        fontWeight: 700,
        textDecoration: "underline",
        textUnderlineOffset: 3,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SigningInAs({
  email,
  onChange,
  disabled,
}: {
  email: string;
  onChange: () => void;
  disabled: boolean;
}) {
  const { t } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Eyebrow color={t.inkMute} size={10}>
        SIGNING IN AS
      </Eyebrow>
      <div
        data-testid="login-email-shown"
        style={{ fontSize: 18, fontWeight: 700, color: t.ink, wordBreak: "break-all" }}
      >
        {email}
      </div>
      <LinkButton testId="login-change-email" onClick={onChange} disabled={disabled} muted>
        Not you? Use a different email
      </LinkButton>
    </div>
  );
}

/**
 * New-account screen: "Is this right? <email> — Use a different email".
 * Nobody has an account with this email, which for a regular host almost
 * always means a typo — so make the email impossible to miss.
 */
function EmailCheck({
  email,
  onChange,
  disabled,
}: {
  email: string;
  onChange: () => void;
  disabled: boolean;
}) {
  const { t } = useTheme();
  return (
    <div
      data-testid="login-signup-email-check"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "16px 18px",
        borderRadius: 14,
        background: t.surface,
        border: `2px solid ${t.accent}`,
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 700, color: t.ink }}>Is this right?</div>
      <div
        data-testid="login-email-shown"
        style={{ fontSize: 22, fontWeight: 800, color: t.ink, overflowWrap: "anywhere", letterSpacing: "-0.01em" }}
      >
        {email}
      </div>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: t.inkMid, fontWeight: 500 }}>
        No TR1VIA account uses this email yet. Already a host? Check it for typos.
      </p>
      <LinkButton testId="login-change-email" onClick={onChange} disabled={disabled}>
        Use a different email
      </LinkButton>
    </div>
  );
}

function Message({ state }: { state: FormState }) {
  const { t } = useTheme();
  if (state.kind !== "notice" && state.kind !== "error") return null;
  const isError = state.kind === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      data-testid={isError ? "login-error" : "login-notice"}
      style={{
        marginTop: 6,
        padding: "12px 14px",
        borderRadius: 10,
        background: t.surface,
        color: isError ? t.wrong : t.ink,
        fontSize: isError ? 13 : 14,
        fontWeight: 500,
        lineHeight: 1.4,
      }}
    >
      {state.message}
    </div>
  );
}

function LegalLinks() {
  const { t } = useTheme();
  return (
    <div
      style={{
        display: "block",
        marginTop: 14,
        fontSize: 12,
        fontWeight: 500,
        color: t.inkMute,
      }}
    >
      <a href="/terms" style={{ color: t.inkMute, textDecoration: "underline", textUnderlineOffset: 3 }}>
        Terms of Service
      </a>
      {" · "}
      <a href="/privacy" style={{ color: t.inkMute, textDecoration: "underline", textUnderlineOffset: 3 }}>
        Privacy Policy
      </a>
    </div>
  );
}

/**
 * Right-column when the visitor already has a Supabase session. Lead with
 * "Go to your dashboard" — the email form below is for switching accounts,
 * not for the already-signed-in case. (This surface originally also guarded
 * against an authed visitor re-triggering the old magic-link OTP and
 * tripping Supabase's per-email rate limit, which is what the first host hit on
 * 2026-05-25; magic-link is gone now, but the "you're already signed in,
 * go to your dashboard" UX win stays.)
 */
function SignedInPanel({
  email,
  onGoToDashboard,
  onSignOut,
  signingOut,
}: {
  email: string;
  onGoToDashboard: () => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const { t } = useTheme();
  return (
    <div
      data-testid="login-signed-in-banner"
      style={{ maxWidth: 460, display: "flex", flexDirection: "column", gap: 18 }}
    >
      <div>
        <Eyebrow color={t.inkMute} size={10}>
          ALREADY SIGNED IN AS
        </Eyebrow>
        <div
          style={{
            marginTop: 6,
            fontSize: 22,
            fontWeight: 700,
            color: t.ink,
            wordBreak: "break-all",
            letterSpacing: "-0.01em",
          }}
        >
          {email}
        </div>
      </div>
      <button
        type="button"
        onClick={onGoToDashboard}
        data-testid="login-go-dashboard-btn"
        style={{
          padding: "18px 22px",
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          fontFamily: "var(--font-sans)",
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: `0 14px 28px -12px ${t.accent}66`,
          letterSpacing: "-0.005em",
        }}
      >
        Go to your dashboard  →
      </button>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        data-testid="login-sign-out-btn"
        style={{
          padding: "12px 18px",
          background: "transparent",
          color: t.inkMid,
          border: `1px solid ${t.line}`,
          borderRadius: 10,
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          fontWeight: 600,
          cursor: signingOut ? "default" : "pointer",
          opacity: signingOut ? 0.6 : 1,
        }}
      >
        {signingOut ? "Signing out…" : "Sign out and use a different email"}
      </button>
    </div>
  );
}
