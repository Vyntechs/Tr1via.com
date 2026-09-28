// "Your show is running — you can create a password after the show."
//
// /host/set-password skips itself while one of her nights is running
// (lib/auth/live-show.ts) and sends her on with ?pw=after-show
// (PASSWORD_AFTER_SHOW_PARAM). This small note tells her why the password
// step didn't appear, instead of a silent bounce. It never blocks the page:
// a pill at the bottom that hides itself after a few seconds (or on "OK"),
// and the flag is dropped from the address bar so a reload doesn't repeat
// it. Never shown on the in-show pages (/host/live, /host/phone).

"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "@/components/system";
import {
  PASSWORD_AFTER_SHOW_PARAM,
  PASSWORD_AFTER_SHOW_VALUE,
  isInShowPath,
} from "@/lib/auth/password-gate";

export const PASSWORD_AFTER_SHOW_NOTE = "Your show is running — you can create a password after the show.";
const SHOW_FOR_MS = 10_000;

export function PasswordAfterShowNote() {
  const { t } = useTheme();
  const params = useSearchParams();
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const flagged = params?.get(PASSWORD_AFTER_SHOW_PARAM) === PASSWORD_AFTER_SHOW_VALUE;

  useEffect(() => {
    if (!flagged || isInShowPath(pathname)) return;
    setOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete(PASSWORD_AFTER_SHOW_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [flagged, pathname]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), SHOW_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open || isInShowPath(pathname)) return null;

  return (
    <div
      role="status"
      data-testid="password-after-show-note"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        zIndex: 40,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          maxWidth: 560,
          padding: "10px 10px 10px 18px",
          borderRadius: 99,
          background: t.surface,
          border: `1px solid ${t.line}`,
          boxShadow: "0 6px 24px rgba(0,0,0,.18)",
          color: t.ink,
          fontFamily: "var(--font-sans)",
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.35,
          pointerEvents: "auto",
        }}
      >
        <span>{PASSWORD_AFTER_SHOW_NOTE}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          data-testid="password-after-show-ok"
          style={{
            flexShrink: 0,
            minHeight: 36,
            padding: "6px 14px",
            borderRadius: 99,
            border: "none",
            background: t.accent,
            color: "#FFF",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
