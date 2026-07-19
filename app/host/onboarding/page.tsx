// /host/onboarding — one-time onboarding form. Collects display name +
// default venue, then POSTs to /(host)/auth/onboarding-complete which
// creates the hosts row and redirects back to /host.
//
// Client component because the form needs state + a fetch call.

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LaptopShell } from "@/components/shells";
import { Display, Eyebrow, useTheme } from "@/components/system";
import { useMediaQuery } from "@/components/system/useMediaQuery";

export default function OnboardingPage() {
  return (
    <LaptopShell>
      <OnboardingInner />
    </LaptopShell>
  );
}

function OnboardingInner() {
  const { t } = useTheme();
  const router = useRouter();
  // Below ~640px the "heading | form" two-column split stacks into one column
  // so the heading isn't clipped and the inputs/button sit fully on-screen.
  const compact = useMediaQuery("(max-width: 640px)");
  const [displayName, setDisplayName] = useState("");
  const [defaultVenue, setDefaultVenue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/auth/onboarding-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          defaultVenue: defaultVenue.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not complete onboarding");
      }
      router.replace("/host");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div
      data-host-mobile-surface="true"
      style={{
        flex: compact ? "none" : 1,
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : "1fr 1fr",
        gap: compact ? 24 : 56,
        padding: compact ? "24px 20px max(24px, env(safe-area-inset-bottom))" : "40px 56px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Eyebrow color={t.accent} size={11}>
          ONE-TIME SETUP
        </Eyebrow>
        <Display size={compact ? 44 : 72} color={t.ink} weight={700} tracking={-0.04} style={{ marginTop: 14, display: "block", lineHeight: 0.95 }}>
          What should we
          <br />
          <span style={{ color: t.accent }}>call you?</span>
        </Display>
        <div style={{ marginTop: 22, fontSize: 16, color: t.inkMid, lineHeight: 1.55, maxWidth: 460 }}>
          Two quick questions — then we&apos;ll set up your first night together.
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 380, justifyContent: "center" }}
      >
        <label
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: t.inkMute,
            fontWeight: 600,
          }}
        >
          Your name
        </label>
        <input
          type="text"
          required
          autoFocus
          placeholder="Linda Petrov"
          value={displayName}
          disabled={submitting}
          onChange={(e) => setDisplayName(e.target.value)}
          style={{
            padding: "16px 18px",
            fontSize: 17,
            background: t.surface,
            border: `1px solid ${t.line}`,
            borderRadius: 12,
            color: t.ink,
            outline: "none",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
          }}
        />
        <label
          style={{
            marginTop: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: t.inkMute,
            fontWeight: 600,
          }}
        >
          Your usual venue (optional)
        </label>
        <input
          type="text"
          placeholder="Soul Fire Pizza"
          value={defaultVenue}
          disabled={submitting}
          onChange={(e) => setDefaultVenue(e.target.value)}
          style={{
            padding: "16px 18px",
            fontSize: 17,
            background: t.surface,
            border: `1px solid ${t.line}`,
            borderRadius: 12,
            color: t.ink,
            outline: "none",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
          }}
        />
        <button
          type="submit"
          disabled={submitting || !displayName.trim()}
          style={{
            marginTop: 8,
            padding: "18px 22px",
            background: t.accent,
            color: "#FFF",
            border: "none",
            borderRadius: 14,
            fontSize: 16,
            fontWeight: 700,
            fontFamily: "var(--font-sans)",
            cursor: submitting ? "default" : "pointer",
            opacity: submitting || !displayName.trim() ? 0.7 : 1,
            letterSpacing: "-0.005em",
            boxShadow: `0 14px 28px -12px ${t.accent}66`,
          }}
        >
          {submitting ? "Finishing…" : "Take me to my dashboard  →"}
        </button>
        {error && (
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
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
