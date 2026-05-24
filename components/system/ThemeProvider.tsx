"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveTheme, type ResolvedTheme } from "@/lib/theme/resolve";
import { type ThemeKey, isThemeKey } from "@/lib/theme/tokens";

interface ThemeContextValue {
  themeKey: ThemeKey;
  setThemeKey: (next: ThemeKey) => void;
  t: ResolvedTheme;
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  themeKey?: ThemeKey;
  children: ReactNode;
}

export function ThemeProvider({ themeKey: initial = "house", children }: ThemeProviderProps) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(initial);

  // Sync the incoming prop into state whenever the caller changes it.
  // For static call sites (gallery, demo defaults) this fires once on mount
  // and is otherwise a no-op. For the host theme picker — which threads a
  // changing `themeKey` down through HostGenOverview — it fires on every
  // new pick, triggering the data-theme effect below to repaint live.
  // Without this, useState(initial) frozen the prop at first render and
  // the host had to hard-refresh to see a new palette take effect.
  useEffect(() => {
    if (isThemeKey(initial)) setThemeKeyState(initial);
  }, [initial]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeKey);
  }, [themeKey]);

  const setThemeKey = useCallback((next: ThemeKey) => {
    if (!isThemeKey(next)) {
      // Silently fall back rather than throwing — themeKey can come from
      // user-editable settings or URL query params.
      return;
    }
    setThemeKeyState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ themeKey, setThemeKey, t: resolveTheme(themeKey) }),
    [themeKey, setThemeKey],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    throw new Error("useTheme() called outside <ThemeProvider>");
  }
  return ctx;
}
