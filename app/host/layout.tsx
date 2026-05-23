// Host laptop layout.
//
// Desktop-first. The host's surface is a single laptop window — every nested
// page renders inside a LaptopShell. We don't add a sidebar here because each
// page renders its own chrome (HostDashboard owns the sidebar; the setup
// flow has its own narrow toolbar; the live console is a full-bleed grid).
//
// Auth is enforced by middleware.ts (any request under (host) is bounced to
// /login unless a Supabase Auth user is present).

import type { ReactNode } from "react";

export default function HostLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        background: "var(--paper)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
      }}
    >
      {children}
    </div>
  );
}
