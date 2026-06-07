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
// Account chip: fixed top-right on every /host/* route, shows the
// signed-in email + a Sign Out button. Solves the silent-session
// inheritance problem (visit /host on a borrowed device → silently land
// in someone else's account because there was no sign-out anywhere).
//
// Falls through to SYSTEM_DEFAULT when the host row hasn't loaded yet
// (e.g. between auth + first DB read) so the layout never renders an
// untyped theme. The root layout's <ThemeProvider> at the document level
// is what handles the truly-pre-auth surfaces (/login, /).

import type { CSSProperties, ReactNode } from "react";
import { ThemeProvider } from "@/components/system";
import { AccountChip } from "@/components/host/AccountChip";
import { getAuthedHost } from "@/lib/api/auth";
import { getSupabaseServer } from "@/lib/supabase/server";
import { resolveTheme, SYSTEM_DEFAULT_THEME } from "@/lib/theme/resolveTheme";

// Height of the top strip kept clear for the fixed AccountChip. The chip sits
// at top:12 and is ~33px tall, so 52 clears it with a small breathing gap.
// Tracks AccountChip's `top` + height — bump together if the chip grows.
// Exposed to descendants as the `--host-chip-reserve` CSS var so a fixed-
// viewport page (the live console pins height:100dvh, no scroll) can subtract
// the same amount instead of overflowing under the reserve.
const CHIP_RESERVE = 52;

export default async function HostLayout({ children }: { children: ReactNode }) {
  const auth = await getAuthedHost();
  const themeKey = auth.ok
    ? resolveTheme(null, auth.host)
    : SYSTEM_DEFAULT_THEME;

  // Email surfaces in the AccountChip so the host always knows whose
  // account they're using. Pulled from the Supabase auth user (not the
  // hosts row, which doesn't carry it). When auth is missing the chip
  // hides — middleware will bounce the request to /login regardless.
  let email: string | null = null;
  if (auth.ok) {
    const supa = await getSupabaseServer();
    const { data: { user } } = await supa.auth.getUser();
    email = user?.email ?? null;
  }

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
          // Reserve a top strip for the fixed AccountChip so it never sits on
          // top of a page's own top-right controls (the setup "Pick" header's
          // flavor pills + "Another 20" button were getting covered). Only
          // when the chip actually renders. border-box keeps the padding
          // inside 100dvh so scrolling pages gain no scrollbar; the reserve is
          // published as --host-chip-reserve so the fixed-height live console
          // can subtract it (page.tsx) instead of overflowing.
          ["--host-chip-reserve" as string]: email ? `${CHIP_RESERVE}px` : "0px",
          boxSizing: "border-box",
          paddingTop: "var(--host-chip-reserve)",
        } as CSSProperties}
      >
        {children}
        {email && <AccountChip email={email} />}
      </div>
    </ThemeProvider>
  );
}
