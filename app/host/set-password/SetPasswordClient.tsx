// "Create your password" — deliberately dead simple for a non-technical
// host: one title, one sentence, two big boxes, one big button, plain
// errors, then a clear "you're all set" screen.
//
// Saving a password signs TR1VIA out on her OTHER devices (Supabase always
// does this on a password change — see app/api/auth/set-password/route.ts).
// This device stays signed in; the form and the done screen say so plainly.
// The page never runs inside a show: the gate skips /host/live and
// /host/phone, and the done button never returns to them.
//
// `from` tunes the words for how she got here:
//   "code"  — just signed in with an emailed code: "Step 2 of 2"
//   "reset" — "Forgot password?": "Choose a new password"
//   null    — the in-app prompt or the founder's sign-in link

"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { LaptopShell } from "@/components/shells";
import { Display, Eyebrow, Wordmark, useTheme } from "@/components/system";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { PasswordField, ShowPasswordToggle } from "@/components/host/PasswordField";
import { checkNewPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password-gate";

export type SetPasswordFrom = "code" | "reset" | null;

export const OTHER_DEVICES_NOTE =
  "If TR1VIA is open on your phone or another computer, it will ask you to sign in once with this new password.";

const COPY = {
  code: {
    eyebrow: "STEP 2 OF 2 · CREATE YOUR PASSWORD",
    title: "Create your password",
    lead: "You're signed in. Now pick a password, so next time you can sign in with your email and password.",
    button: "Save my password",
  },
  reset: {
    eyebrow: "LAST STEP · NEW PASSWORD",
    title: "Choose a new password",
    lead: "You're signed in. Pick a new password. It replaces your old one.",
    button: "Save my new password",
  },
  prompt: {
    eyebrow: null,
    title: "Create your password",
    lead: "So only you can open your trivia nights.",
    button: "Save my password",
  },
} as const;

type State =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "error"; message: string; field?: "password" | "confirm" }
  | { kind: "done" };

export function SetPasswordClient({
  returnPath,
  from = null,
}: {
  returnPath: string;
  from?: SetPasswordFrom;
}) {
  return (
    <LaptopShell>
      <Inner returnPath={returnPath} from={from} />
    </LaptopShell>
  );
}

function Inner({ returnPath, from }: { returnPath: string; from: SetPasswordFrom }) {
  const { t } = useTheme();
  const copy = COPY[from ?? "prompt"];
  const compact = useMediaQuery("(max-width: 640px)");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "saving") return;
    const check = checkNewPassword(password, confirm);
    if (!check.ok) {
      setState({ kind: "error", message: check.error, field: check.field });
      return;
    }
    setState({ kind: "saving" });
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password, confirm, next: returnPath }),
      });
      if (res.ok) {
        setState({ kind: "done" });
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { code?: string; error?: string; field?: "password" | "confirm"; redirect?: string }
        | null;
      if (body?.code === "sign_in_again" && body.redirect?.startsWith("/login")) {
        // Saved, but this device couldn't be signed back in. /login says
        // "Your password is saved. Sign in with it now."
        window.location.assign(body.redirect);
        return;
      }
      setState({
        kind: "error",
        message: body?.error ?? "Something went wrong. Please try again.",
        field: body?.field,
      });
    } catch {
      setState({
        kind: "error",
        message: "We couldn't reach TR1VIA. Check your internet, then try again.",
      });
    }
  }

  function goBack() {
    // Full page load (not router.push) so the sign-in check runs fresh and
    // sees the new password right away.
    window.location.assign(returnPath);
  }

  const saving = state.kind === "saving";
  const errorField = state.kind === "error" ? state.field : undefined;

  return (
    <div
      data-testid="set-password-screen"
      style={{
        flex: 1,
        display: "flex",
        alignItems: compact ? "flex-start" : "center",
        justifyContent: "center",
        padding: compact ? "28px 20px max(28px, env(safe-area-inset-bottom))" : "48px 32px",
        overflow: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column" }}>
        <Wordmark size={24} />

        {state.kind === "done" ? (
          <div data-testid="set-password-done" style={{ marginTop: 36 }}>
            <Display
              size={compact ? 44 : 64}
              color={t.ink}
              weight={700}
              tracking={-0.035}
              style={{ display: "block", lineHeight: 1 }}
            >
              You&apos;re all set.
            </Display>
            <p style={{ marginTop: 20, fontSize: 22, lineHeight: 1.45, color: t.inkMid, fontWeight: 500 }}>
              Your password is saved. Next time, sign in with your email and this password.
            </p>
            <p
              data-testid="set-password-other-devices"
              style={{ marginTop: 14, fontSize: 19, lineHeight: 1.45, color: t.ink, fontWeight: 600 }}
            >
              {OTHER_DEVICES_NOTE}
            </p>
            <BigButton onClick={goBack} testId="set-password-continue">
              Go to my trivia nights &nbsp;→
            </BigButton>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate style={{ marginTop: 36, display: "flex", flexDirection: "column" }}>
            {copy.eyebrow && (
              <Eyebrow
                color={t.accent}
                size={compact ? 12 : 13}
                style={{ display: "block", marginBottom: 14 }}
              >
                <span data-testid="set-password-step">{copy.eyebrow}</span>
              </Eyebrow>
            )}
            <Display
              size={compact ? 44 : 64}
              color={t.ink}
              weight={700}
              tracking={-0.035}
              style={{ display: "block", lineHeight: 1 }}
            >
              {copy.title}
            </Display>
            <p style={{ marginTop: 18, fontSize: 22, lineHeight: 1.45, color: t.inkMid, fontWeight: 500 }}>
              {copy.lead}
            </p>
            <p style={{ marginTop: 10, fontSize: 18, lineHeight: 1.45, color: t.inkMute, fontWeight: 500 }}>
              Use at least {MIN_PASSWORD_LENGTH} characters. Type it twice so we know it&apos;s right.
            </p>

            <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 20 }}>
              <PasswordField
                id="new-password"
                label="Password"
                value={password}
                onChange={setPassword}
                revealed={revealed}
                autoComplete="new-password"
                disabled={saving}
                invalid={errorField === "password"}
                large
                autoFocus
              />
              <PasswordField
                id="confirm-password"
                label="Type it again"
                value={confirm}
                onChange={setConfirm}
                revealed={revealed}
                autoComplete="new-password"
                disabled={saving}
                invalid={errorField === "confirm"}
                large
              />
              <ShowPasswordToggle
                revealed={revealed}
                onToggle={() => setRevealed((v) => !v)}
                disabled={saving}
                large
              />
            </div>

            {state.kind === "error" && (
              <div
                role="alert"
                data-testid="set-password-error"
                style={{
                  marginTop: 20,
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: `${t.wrong}18`,
                  color: t.wrong,
                  fontSize: 19,
                  fontWeight: 600,
                  lineHeight: 1.4,
                }}
              >
                {state.message}
              </div>
            )}

            <BigButton type="submit" disabled={saving} testId="set-password-submit">
              {saving ? "Saving…" : copy.button}
            </BigButton>
            <p style={{ marginTop: 14, fontSize: 16, lineHeight: 1.45, color: t.inkMute, fontWeight: 500 }}>
              This device stays signed in. Your phone or other computers will ask for the new password once.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function BigButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  testId: string;
}) {
  const { t } = useTheme();
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        marginTop: 28,
        width: "100%",
        padding: "22px 24px",
        background: t.accent,
        color: "#FFF",
        border: "none",
        borderRadius: 16,
        fontFamily: "var(--font-sans)",
        fontSize: 22,
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.7 : 1,
        boxShadow: `0 14px 28px -12px ${t.accent}66`,
      }}
    >
      {children}
    </button>
  );
}
