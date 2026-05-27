// HOST LOGIN — magic-link only. One email field, one button. After submit
// we show a "check your email" confirmation in the same shell, so the host
// never has to leave the page or reload. Wrapped in the LaptopShell so it
// matches the rest of the host-laptop aesthetic.
//
// Auth: Supabase signInWithOtp. The redirectTo points at /auth/callback,
// which exchanges the code for a session and routes the host to either
// /host/onboarding (first time) or /host (returning).

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LaptopShell } from "@/components/shells";
import { Display, Eyebrow, Wordmark, useTheme } from "@/components/system";
import { getSupabaseBrowser } from "@/lib/supabase/client";

type FormState =
  | { kind: "idle" }
  | { kind: "sending" }
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
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });
  // If the visitor already has a session, show "signed in as X" with a
  // sign-out option BEFORE the email form. Solves the "I never get asked
  // for email" problem where a stale cookie silently inherited a session.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setState({ kind: "sending" });
    try {
      // The server looks up the email against the hosts table and mints
      // that host's session on the response. No magic link, no email
      // round-trip — sign-in completes in one request.
      const res = await fetch("/api/auth/founder-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.ok) {
        router.replace("/host");
        return;
      }
      if (res.status === 404) {
        setState({
          kind: "error",
          message:
            "We don't recognize that email. Ask Brandon to add you on the founder dashboard, then try again.",
        });
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setState({
        kind: "error",
        message: body?.error ?? `Sign-in failed (${res.status})`,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  const isSending = state.kind === "sending";

  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 56,
        padding: "40px 56px",
        overflow: "hidden",
      }}
    >
      {/* Left — brand + pitch */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Wordmark size={26} />
        <Eyebrow color={t.accent} size={11} style={{ marginTop: 28, display: "block" }}>
          HOST · SIGN IN
        </Eyebrow>
        <Display
          size={84}
          color={t.ink}
          weight={700}
          tracking={-0.04}
          style={{ marginTop: 14, display: "block", lineHeight: 0.95 }}
        >
          The host&apos;s
          <br />
          <span style={{ color: t.accent }}>laptop.</span>
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
          One click to sign in. No password, no email check &mdash; just
          type the email Brandon set up for you.
        </p>
      </div>

      {/* Right — the form, the sent-confirmation, or the signed-in panel */}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {signedInAs ? (
          <SignedInPanel
            email={signedInAs}
            onGoToDashboard={() => router.replace("/host")}
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

            <button
              type="submit"
              disabled={isSending || !email.trim()}
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
              {isSending ? "Signing in…" : "Sign in  →"}
            </button>

            {state.kind === "error" && (
              <div
                role="alert"
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

            <Eyebrow color={t.inkMute} size={10} style={{ display: "block", marginTop: 10 }}>
              NEW HERE? ASK BRANDON TO ADD YOU FROM THE FOUNDER DASHBOARD.
            </Eyebrow>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Right-column when the visitor already has a Supabase session. Lead with
 * "Go to your dashboard" — the email form below is for switching accounts,
 * not for the already-signed-in case. Previously (pre-magic-link removal)
 * this surface also protected against an authed visitor mashing "Send
 * sign-in link" and tripping Supabase's per-email OTP rate limit, which
 * is what Heather hit on 2026-05-25. With magic-link gone the urgency of
 * that protection drops, but the UX win — "you're already signed in, go
 * to your dashboard" instead of an empty-form invitation — stays.
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

