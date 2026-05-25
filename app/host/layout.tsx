// Host laptop layout.
//
// Desktop-first. The host's surface is a single laptop window — every nested
// page renders inside a LaptopShell. We don't add a sidebar here because each
// page renders its own chrome (HostDashboard owns the sidebar; the setup
// flow has its own narrow toolbar; the live console is a full-bleed grid).
//
// Auth is enforced by middleware.ts (any request under (host) is bounced to
// /login unless a Supabase Auth user is present).
//
// Theme: wraps every /host/* route in a <ThemeProvider> tied to the host's
// `default_theme_key`. Pages that render per-night content (setup, live)
// nest their own ThemeProvider with `resolveTheme(night, host)` so any
// explicit per-night override still wins. Non-per-night routes (dashboard,
// library, settings, themes, admin) inherit the host's preference here,
// keeping the experience consistent as the host navigates between them.
//
// Falls through to SYSTEM_DEFAULT when the host row hasn't loaded yet
// (e.g. between auth + first DB read) so the layout never renders an
// untyped theme. The root layout's <ThemeProvider> at the document level
// is what handles the truly-pre-auth surfaces (/login, /).

import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/system";
import { getAuthedHost } from "@/lib/api/auth";
import { resolveTheme, SYSTEM_DEFAULT_THEME } from "@/lib/theme/resolveTheme";

export default async function HostLayout({ children }: { children: ReactNode }) {
  const auth = await getAuthedHost();
  const themeKey = auth.ok
    ? resolveTheme(null, auth.host)
    : SYSTEM_DEFAULT_THEME;

  return (
    <ThemeProvider themeKey={themeKey}>
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
    </ThemeProvider>
  );
}
