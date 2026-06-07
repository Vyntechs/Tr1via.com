// HOST · ACCOUNT CHIP. Top-right affordance on the host's prep/admin
// screens. Shows the signed-in email + a Sign Out button. Solves the
// "I never get asked to log in, it just put me in someone else's account"
// problem — once you can see who you're signed in as, switching is
// obvious.
//
// Deliberately hidden on the in-show surfaces: the live console is mirrored
// to the venue TV (guests would see the host's email + Sign Out), and the
// host phone is an in-hand control during the show. The chip adds no value
// there and is clutter / a privacy leak, so it only renders on prep screens.

"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/system";

// Route prefixes where the chip is suppressed (mirrored TV / in-hand phone).
const IN_SHOW_PREFIXES = ["/host/live", "/host/phone"];

export interface AccountChipProps {
  /** The signed-in user's email — shown in the chip so the host always
   *  knows whose account they're using. */
  email: string;
}

export function AccountChip({ email }: AccountChipProps) {
  const { t } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  // Suppress on the live console (mirrored to the TV) and the host phone.
  const hidden = IN_SHOW_PREFIXES.some((p) => pathname?.startsWith(p));

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // ignore — we redirect either way; middleware will catch the
      // unauthenticated state on the next request.
    }
    router.replace("/login");
    router.refresh();
  }

  if (hidden) return null;

  return (
    <div
      data-testid="account-chip"
      style={{
        position: "fixed",
        top: 12,
        right: 18,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px 6px 14px",
        borderRadius: 99,
        background: t.dark ? "rgba(244,230,196,.08)" : "rgba(27,19,12,.06)",
        border: `1px solid ${t.line}`,
        backdropFilter: "blur(8px)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: t.inkMid,
          fontWeight: 500,
          maxWidth: 220,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={email}
      >
        {email}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        data-testid="account-chip-sign-out"
        style={{
          padding: "4px 10px",
          borderRadius: 99,
          border: "none",
          background: t.accent,
          color: "#FFF",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.02em",
          fontFamily: "var(--font-sans)",
          cursor: signingOut ? "default" : "pointer",
          opacity: signingOut ? 0.6 : 1,
        }}
      >
        {signingOut ? "…" : "Sign out"}
      </button>
    </div>
  );
}
