"use client";

import { useEffect, useId, useRef } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import type { WhatsNewContent } from "@/lib/host/whats-new";

export interface HostWhatsNewProps {
  open: boolean;
  onClose: () => void;
  news: WhatsNewContent;
}

export function HostWhatsNew({ open, onClose, news }: HostWhatsNewProps) {
  const { t } = useTheme();
  const compact = useMediaQuery("(max-width: 720px)");
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "grid",
        placeItems: "center",
        padding: compact ? 14 : 28,
        background: "rgba(7, 6, 5, .76)",
        backdropFilter: "blur(10px)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="host-whats-new"
        style={{
          position: "relative",
          width: "min(620px, 100%)",
          maxHeight: "min(760px, calc(100dvh - 28px))",
          overflowY: "auto",
          overscrollBehavior: "contain",
          background: t.paper,
          color: t.ink,
          border: `1px solid ${t.line}`,
          borderRadius: 20,
          boxShadow: "0 34px 90px rgba(0, 0, 0, .46)",
        }}
      >
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            borderRadius: 999,
            border: `1px solid ${t.line}`,
            background: t.surface,
            color: t.ink,
            fontSize: 20,
            cursor: "pointer",
            zIndex: 2,
          }}
        >
          ×
        </button>

        <div style={{ padding: compact ? "28px 22px 22px" : "48px 52px 40px" }}>
          <div
            style={{
              color: t.accent,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".16em",
              textTransform: "uppercase",
            }}
          >
            {news.eyebrow}
          </div>
          <h2
            id={titleId}
            style={{
              margin: "10px 48px 0 0",
              maxWidth: 560,
              fontSize: compact ? 32 : 40,
              lineHeight: 1.02,
              letterSpacing: "-.035em",
              fontWeight: 560,
            }}
          >
            {news.title}
          </h2>
          <p
            style={{
              margin: "14px 0 0",
              maxWidth: 580,
              color: t.inkMid,
              fontSize: 17,
              lineHeight: 1.5,
            }}
          >
            {news.lead}
          </p>

          <div style={{ marginTop: 30, display: "grid", gap: 0 }}>
            {news.steps.map((step, index) => (
              <div
                key={step.title}
                style={{
                  display: "grid",
                  gridTemplateColumns: "30px 1fr",
                  gap: 14,
                  padding: "17px 0",
                  borderTop: `1px solid ${t.line}`,
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    background: `${t.accent}22`,
                    color: t.accent,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {index + 1}
                </span>
                <div>
                  <div style={{ fontSize: 16, lineHeight: 1.35, fontWeight: 700 }}>
                    {step.title}
                  </div>
                  <div style={{ marginTop: 4, color: t.inkMid, fontSize: 14, lineHeight: 1.45 }}>
                    {step.body}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {news.footer && (
            <p
              style={{
                margin: "12px 0 0",
                padding: "14px 18px",
                borderRadius: 12,
                background: t.surface,
                borderLeft: `3px solid ${t.accent}`,
                color: t.ink,
                fontSize: 15,
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              {news.footer}
            </p>
          )}

          <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                minHeight: 48,
                padding: "0 24px",
                borderRadius: 12,
                border: "none",
                background: t.accent,
                color: t.dark ? "#0E0E0C" : "#FFF",
                fontFamily: "var(--font-sans)",
                fontSize: 15,
                fontWeight: 750,
                cursor: "pointer",
                boxShadow: `0 12px 28px -14px ${t.accent}`,
              }}
            >
              {news.button}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
