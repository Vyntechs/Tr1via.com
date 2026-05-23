// macOS-style window chrome wrapper for host-laptop screens. Mirrors the
// design canvas's macos-window component. The chrome is intentionally
// visible in the design system + dev gallery — in the real production app
// these screens render full-window without the chrome (the browser provides
// it). The chrome stays as a wrapper for the design gallery and any
// "preview-on-canvas" routes.

"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { Wordmark } from "@/components/system/Wordmark";

export interface LaptopShellProps {
  title: string;
  children: ReactNode;
  /** Show macOS traffic-light chrome. Default true (for gallery). The live
   *  app overrides to false. */
  chrome?: boolean;
}

export function LaptopShell({ title, children, chrome = true }: LaptopShellProps) {
  const { t } = useTheme();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {chrome && (
        <div
          style={{
            height: 38,
            flex: "0 0 auto",
            background: t.dark ? "rgba(244,230,196,.04)" : "rgba(27,19,12,.05)",
            borderBottom: `1px solid ${t.line}`,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            gap: 10,
            boxSizing: "border-box",
          }}
        >
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#FF5F57" }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#FEBC2E" }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#28C840" }} />
          <div
            style={{
              flex: 1,
              textAlign: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <Wordmark size={13} accent={t.accent} ink={t.ink} />
            <span style={{ color: t.inkMute, fontSize: 11 }}>·</span>
            <span style={{ color: t.inkMid, fontSize: 12, fontWeight: 500 }}>{title}</span>
          </div>
          <div style={{ width: 40 }} />
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
