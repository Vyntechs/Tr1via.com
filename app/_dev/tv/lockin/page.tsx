// Internal gallery for the TV lock-in choreography. Right now only the
// chosen variant — the pile-up — is implemented; future variants would
// slot in here for side-by-side comparison.

"use client";

import type { ReactNode } from "react";
import { useTheme, Wordmark, Eyebrow } from "@/components/system";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import { LockInPileUp } from "@/components/tv/lockin";

export default function TVLockinGallery() {
  const { themeKey, setThemeKey, t } = useTheme();
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 48px 96px",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Wordmark size={36} />
            <span style={{ width: 1, height: 22, background: t.line }} />
            <Eyebrow color={t.inkMid} size={12}>TV · LOCK-IN CHOREOGRAPHY</Eyebrow>
          </div>
          <select
            value={themeKey}
            onChange={(e) => setThemeKey(e.target.value as ThemeKey)}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${t.line}`,
              background: t.surface,
              color: t.ink,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {THEME_KEYS.map((k) => (
              <option key={k} value={k} style={{ background: t.paper, color: t.ink }}>
                {TR1VIA_THEMES[k].name}
              </option>
            ))}
          </select>
        </div>

        <p style={{ maxWidth: 720, fontSize: 14, color: t.inkMid, lineHeight: 1.5, marginTop: 0, marginBottom: 36 }}>
          Chosen variant: the pile-up. Each name tile lands like a card on a table —
          weighty, not bouncy. Subtle tilt per tile so the stack reads as physical, not
          a grid. Driven by a <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>tiles</code>{" "}
          prop so live data can replace the demo roster (defaults shown).
        </p>

        <ScreenCard step="A" title="Lock-in · pile-up" note="21 of 32 locked in · 16:9 stage">
          <LockInPileUp />
        </ScreenCard>
      </div>
    </main>
  );
}

function ScreenCard({
  step,
  title,
  note,
  children,
}: {
  step: string;
  title: string;
  note: string;
  children: ReactNode;
}) {
  const { t } = useTheme();
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <Eyebrow color={t.accent} size={11}>VARIANT {step}</Eyebrow>
          <span style={{ fontSize: 15, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</span>
        </div>
        <span style={{ fontSize: 12, color: t.inkMute }}>{note}</span>
      </div>
      <div
        style={{
          width: 1280,
          height: 720,
          maxWidth: "100%",
          margin: "0 auto",
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${t.line}`,
          boxShadow: t.dark
            ? "0 20px 60px -20px rgba(0,0,0,.6)"
            : "0 20px 60px -20px rgba(27,19,12,.18)",
          background: t.paper,
        }}
      >
        {children}
      </div>
    </section>
  );
}
