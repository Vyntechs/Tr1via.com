"use client";

import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/components/system/ThemeProvider";
import { monthThemeKey } from "@/lib/theme/monthThemeScript";
import type { ThemeKey } from "@/lib/theme/tokens";

/**
 * The public-site default theme: the LIVE calendar month, computed on the
 * client so a statically-cached page wears the real current month (matching
 * the pre-paint inline script) instead of the month it was built in.
 *
 * `ssrThemeKey` is the server's best-effort month, used for the first server
 * paint and the no-JS case. Surfaces that need a specific theme (a live game,
 * host setup) mount their own <ThemeProvider> deeper in the tree and override
 * this — so this only governs anonymous/public pages.
 */
export function SeasonalThemeProvider({
  ssrThemeKey,
  children,
}: {
  ssrThemeKey: ThemeKey;
  children: ReactNode;
}) {
  const [themeKey] = useState<ThemeKey>(() =>
    typeof document === "undefined"
      ? ssrThemeKey
      : monthThemeKey(new Date().getMonth()) ?? ssrThemeKey,
  );
  return <ThemeProvider themeKey={themeKey}>{children}</ThemeProvider>;
}
