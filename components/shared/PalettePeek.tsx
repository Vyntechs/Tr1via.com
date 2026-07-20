// PalettePeek — the palette picker UI shared by the host setup screen.
//
// Renders all 14 themed palettes as cards in a 2-col grid bottom-sheet.
// Tapping a card fires `onPick(key)` — the caller decides what to do
// (PATCH the night row, set local theme state, etc.). Active palette
// can be controlled via `activeThemeKey` so the wrapper is the single
// source of truth.
//
// Lifted from components/player/ in this commit so the host setup
// screen could reuse it. The player surface no longer ships a picker.

"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { Wordmark } from "@/components/system/Wordmark";
import { Eyebrow } from "@/components/system/Eyebrow";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";

export interface PalettePeekProps {
  open: boolean;
  onClose: () => void;
  /** Currently-selected palette. Renders the active ring + lift. */
  activeThemeKey?: ThemeKey;
  /** Called when the user taps a palette card. Caller handles persistence. */
  onPick: (key: ThemeKey) => void;
  /** Optional headline override. Defaults to "Pick the game's mood." */
  title?: string;
  /** Optional footer caption. Defaults to "Saved instantly — players see it next reveal." */
  footer?: string;
}

export function PalettePeek({
  open,
  onClose,
  activeThemeKey,
  onPick,
  title = "Pick the game’s mood.",
  footer = "Saved instantly — players see it on the next page load.",
}: PalettePeekProps) {
  const { t } = useTheme();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!open) return null;

  const handlePick = (key: ThemeKey) => {
    onPick(key);
    setToast("Locked in");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a palette"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        pointerEvents: "auto",
      }}
    >
      <div
        data-testid="palette-peek-backdrop"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.62)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          animation: "tr1via-rise .35s cubic-bezier(.2,.7,.3,1) both",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          maxHeight: "82dvh",
          background: t.paper,
          color: t.ink,
          borderRadius: "20px 20px 0 0",
          border: `1px solid ${t.line}`,
          borderBottom: "none",
          padding: "20px 18px 28px",
          overflowY: "auto",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
          animation: "tr1via-rise .42s cubic-bezier(.2,.7,.3,1) both",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBottom: 14,
            borderBottom: `1px solid ${t.lineSoft}`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Eyebrow color={t.inkMid} size={10}>
              Theme
            </Eyebrow>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 38,
              height: 38,
              borderRadius: 99,
              border: `1px solid ${t.line}`,
              background: t.surface,
              color: t.ink,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          {THEME_KEYS.map((key) => {
            const def = TR1VIA_THEMES[key];
            const active = key === activeThemeKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handlePick(key)}
                aria-label={`${def.name} palette`}
                aria-pressed={active}
                style={{
                  position: "relative",
                  textAlign: "left",
                  border: active ? `1.5px solid ${def.accent}` : `1px solid ${t.line}`,
                  borderRadius: 14,
                  background: def.paper,
                  color: def.ink,
                  padding: "12px 12px 10px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  font: "inherit",
                  overflow: "hidden",
                  transition: "transform .2s cubic-bezier(.2,.7,.3,1), border-color .2s",
                  transform: active ? "translateY(-1px)" : "translateY(0)",
                  boxShadow: active ? `0 6px 18px ${def.accent}33` : "none",
                }}
              >
                <Wordmark size={18} accent={def.accent} ink={def.ink} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    opacity: 0.75,
                    lineHeight: 1.2,
                  }}
                >
                  {def.name}
                </span>
                <div style={{ display: "flex", gap: 4, marginTop: "auto" }}>
                  {[def.paper, def.ink, def.accent, def.pop, def.correct].map((c, i) => (
                    <span
                      key={i}
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background: c,
                        border: `1px solid ${def.mode === "dark" ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.08)"}`,
                      }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <p
          style={{
            marginTop: 18,
            color: t.inkMute,
            fontSize: 12,
            lineHeight: 1.45,
            textAlign: "center",
          }}
        >
          {footer}
        </p>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: t.accent,
            color: t.dark ? "#0E0805" : "#fff",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "10px 18px",
            borderRadius: 99,
            boxShadow: `0 8px 24px ${t.accent}55`,
            animation: "tr1via-rise .25s cubic-bezier(.2,.7,.3,1) both",
            zIndex: 1,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
