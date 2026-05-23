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
