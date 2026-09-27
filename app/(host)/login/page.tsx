// HOST LOGIN — email + password. Wrapped in the shared host shell so the
// same account-first door works on any device.
//
// Two modes on one page:
//   - Sign in (default): POST /api/auth/login. Only accounts that have
//     created a password (app_metadata.password_set_at) get in. Older
//     accounts see "This account doesn't have a password yet. Text Brandon
//     for a sign-in link." — the founder's /host/admin link is the way back.
//   - New here: POST /api/auth/host-access with email + password + confirm.
//     Creates the account with its password and starts the free trial via
//     /host/onboarding (app/host/page.tsx redirects there when there's no
//     hosts row yet).
// Either way the server writes the session cookies on its 200 response and
// the client returns to a safe intended /host path.

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LaptopShell } from "@/components/shells";
import { Display, Eyebrow, Wordmark, useTheme } from "@/components/system";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { hostReturnPath } from "@/lib/host/hostReturnPath";
import { PasswordField, ShowPasswordToggle } from "@/components/host/PasswordField";
import { checkNewPassword } from "@/lib/auth/password-gate";

type Mode = "signin" | "signup";

type FormState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "notice"; message: string }
  | { kind: "error"; message: string };

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
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      setSignedInAs(data.user?.email ?? null);
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

  function switchMode(next: Mode) {
    setMode(next);
    setConfirm("");
    setState({ kind: "idle" });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setState({ kind: "error", message: "Please type your email and your password." });
      return;
    }
    if (mode === "signup") {
      const check = checkNewPassword(password, confirm);
      if (!check.ok) {
        setState({ kind: "error", message: check.error });
        return;
      }
    }

    setState({ kind: "sending" });
    try {
      const res = await fetch(mode === "signin" ? "/api/auth/login" : "/api/auth/host-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(
          mode === "signin"
            ? { email: trimmed, password }
            : { email: trimmed, password, confirm },
        ),
      });
      if (res.ok) {
        router.replace(intendedHostPath());
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null;
      if (mode === "signin" && body?.code === "no_account") {
        // Unknown email → offer to create the account right here, keeping
        // what they typed.
        setMode("signup");
        setConfirm("");
        setState({ kind: "notice", message: body.error ?? "Create your free account below." });
        return;
      }
      if (mode === "signup" && body?.code === "account_exists") {
        setMode("signin");
        setState({ kind: "error", message: body.error ?? "Please sign in instead." });
        return;
      }
      setState({
        kind: "error",
        message: body?.error ?? `Sign-in failed (${res.status})`,
      });
    } catch {
      setState({
        kind: "error",
        message: "We couldn't reach TR1VIA. Check your internet, then try again.",
      });
    }
  }

  const isSending = state.kind === "sending";

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
          Sign in with your email and password &mdash; or start a free
          30-day trial if you&apos;re new.
        </p>
      </div>

      {/* Right — the form, the sent-confirmation, or the signed-in panel */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {signedInAs ? (
          <SignedInPanel
            email={signedInAs}
            onGoToDashboard={() => router.replace(intendedHostPath())}
            onSignOut={handleSignOut}
            signingOut={signingOut}
          />
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              maxWidth: 380,
            }}
          >
            <label
              htmlFor="email"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: t.inkMute,
                fontWeight: 600,
              }}
            >
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

            <PasswordField
              id="password"
              label="Password"
              value={password}
              onChange={setPassword}
              revealed={revealed}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              disabled={isSending}
            />
            {mode === "signup" && (
              <PasswordField
                id="confirm-password"
                label="Type it again"
                value={confirm}
                onChange={setConfirm}
                revealed={revealed}
                autoComplete="new-password"
                disabled={isSending}
              />
            )}
            <ShowPasswordToggle
              revealed={revealed}
              onToggle={() => setRevealed((v) => !v)}
              disabled={isSending}
            />

            <button
              type="submit"
              data-testid="login-submit"
              disabled={isSending || !email.trim() || !password}
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
                cursor: isSending ? "default" : "pointer",
                opacity: isSending ? 0.7 : 1,
                boxShadow: `0 14px 28px -12px ${t.accent}66`,
                letterSpacing: "-0.005em",
              }}
            >
              {isSending
                ? mode === "signin"
                  ? "Signing in…"
                  : "Creating your account…"
                : mode === "signin"
                  ? "Sign in  →"
                  : "Create my free account  →"}
            </button>

            {state.kind === "notice" && (
              <div
                role="status"
                data-testid="login-notice"
                style={{
                  marginTop: 6,
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: t.surface,
                  color: t.ink,
                  fontSize: 14,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {state.message}
              </div>
            )}

            {state.kind === "error" && (
              <div
                role="alert"
                data-testid="login-error"
                style={{
                  marginTop: 6,
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: t.surface,
                  color: t.wrong,
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {state.message}
              </div>
            )}

            <button
              type="button"
              data-testid="login-mode-switch"
              onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
              disabled={isSending}
              style={{
                alignSelf: "flex-start",
                marginTop: 10,
                padding: 0,
                background: "transparent",
                border: "none",
                color: t.accent,
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 700,
                textDecoration: "underline",
                textUnderlineOffset: 3,
                cursor: isSending ? "default" : "pointer",
              }}
            >
              {mode === "signin"
                ? "New here? Create a free account"
                : "Already have an account? Sign in"}
            </button>
            <div
              style={{
                display: "block",
                marginTop: 14,
                fontSize: 12,
                fontWeight: 500,
                color: t.inkMute,
              }}
            >
              <a
                href="/terms"
                style={{ color: t.inkMute, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                Terms of Service
              </a>
              {" · "}
              <a
                href="/privacy"
                style={{ color: t.inkMute, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                Privacy Policy
              </a>
            </div>
          </form>
        )}
      </div>
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
