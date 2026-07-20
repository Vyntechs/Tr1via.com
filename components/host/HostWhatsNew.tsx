"use client";

import { useEffect, useId, useRef } from "react";
import { useTheme } from "@/components/system/ThemeProvider";
import { useMediaQuery } from "@/components/system/useMediaQuery";

export interface HostWhatsNewProps {
  open: boolean;
  onClose: () => void;
}

const BENEFITS = [
  {
    stamp: "CONTROL",
    title: "Sign in on any device. Control the same live game.",
    body: "Your phone and laptop stay together automatically. TV preview shows what players see, and players scan the only QR.",
  },
  {
    stamp: "CHECKED",
    title: "AI-generated questions are checked before you can use them.",
    body: "TR1VIA now checks the answer, the other choices, and the fact before an AI-generated question reaches your game.",
  },
  {
    stamp: "SAFE",
    title: "You can leave generation without losing the work.",
    body: "Come back whenever you need to. The screen shows what is actually finished and retries only what is missing.",
  },
  {
    stamp: "CLEAR",
    title: "Players get a steadier, easier-to-read night.",
    body: "Phones recover to the right moment between rounds, and the venue screen keeps the important words large and still.",
  },
] as const;

export function HostWhatsNew({ open, onClose }: HostWhatsNewProps) {
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
          width: "min(860px, 100%)",
          maxHeight: "min(760px, calc(100dvh - 28px))",
          overflowY: "auto",
          overscrollBehavior: "contain",
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "156px 1fr",
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
          aria-label="Close What's new"
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

        <aside
          aria-hidden="true"
          style={{
            display: "flex",
            flexDirection: compact ? "row" : "column",
            alignItems: "center",
            justifyContent: compact ? "flex-start" : "center",
            gap: compact ? 8 : 18,
            padding: compact ? "18px 64px 18px 18px" : "28px 20px",
            background: t.accent,
            color: t.dark ? "#0E0E0C" : "#FFF",
          }}
        >
          {BENEFITS.map((benefit, index) => (
            <div
              key={benefit.stamp}
              style={{
                width: compact ? 54 : 88,
                height: compact ? 54 : 88,
                borderRadius: 999,
                border: "1px solid currentColor",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: compact ? 8 : 10,
                fontWeight: 800,
                letterSpacing: ".12em",
                transform: index === 1 ? "rotate(2deg)" : index === 2 ? "rotate(-2deg)" : undefined,
                opacity: 0.9,
              }}
            >
              {benefit.stamp}
            </div>
          ))}
        </aside>

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
            What&apos;s new · Original game
          </div>
          <h2
            id={titleId}
            style={{
              margin: "10px 48px 0 0",
              maxWidth: 560,
              fontSize: compact ? 34 : 48,
              lineHeight: 1.02,
              letterSpacing: "-.035em",
              fontWeight: 560,
            }}
          >
            Your games now protect themselves.
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
            You still build and host the same way. Now your controls follow your account,
            while TR1VIA does more checking, saving, and recovery behind the scenes.
          </p>

          <div style={{ marginTop: 30, display: "grid", gap: 0 }}>
            {BENEFITS.map((benefit, index) => (
              <div
                key={benefit.stamp}
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
                    background: `${t.correct}22`,
                    color: t.correct,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  ✓
                </span>
                <div>
                  <div style={{ fontSize: 16, lineHeight: 1.35, fontWeight: 700 }}>
                    {benefit.title}
                  </div>
                  <div style={{ marginTop: 4, color: t.inkMid, fontSize: 14, lineHeight: 1.45 }}>
                    {benefit.body}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 12,
              padding: "16px 18px",
              borderRadius: 12,
              background: t.surface,
              borderLeft: `3px solid ${t.accent}`,
              color: t.inkMid,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: t.ink }}>One honest note:</strong> TR1VIA still uses AI,
            and no fact-check is perfect. If a question or screen still looks wrong after
            Retry, stop before opening the game and contact Brandon.
          </div>

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
              Got it
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
