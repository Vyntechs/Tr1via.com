// Player phone — WINNER CARD.
// The winner's phone at the close of the night. A trading-card moment
// the winner screenshots and posts. Accent-painted panel with the wordmark,
// "You won." Display headline, big score, and a clean stats list. CTA at the
// bottom saves the card to Photos.

"use client";

import { useCallback, useRef, useState } from "react";
import {
  useTheme,
  Wordmark,
  Display,
  Eyebrow,
  Numeric,
  Weather,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerWinnerCardStat {
  label: string;
  value: string;
}

export interface PlayerWinnerCardProps {
  themeKey?: ThemeKey;
  venueName?: string;
  /** Date string for the eyebrow ("MAY 27"). */
  nightDateLabel?: string;
  /** Final score. */
  finalScore?: number;
  /** 1-4 stat rows shown below the score. */
  stats?: PlayerWinnerCardStat[];
  /** Caption beneath the trading card. */
  blurb?: string;
  /**
   * Optional override for the "Save your card" handler. If omitted, the card
   * renders itself to PNG via html-to-image and triggers a browser download.
   */
  onSave?: () => void;
}

function slugifyForFilename(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "card"
  );
}

const DEFAULT_STATS: PlayerWinnerCardStat[] = [
  { label: "GOT RIGHT", value: "38 / 42" },
  { label: "LONGEST STREAK", value: "× 7" },
  { label: "FASTEST ANSWER", value: "0.9s · Music" },
  { label: "BEST CATEGORY", value: "History · 7/7" },
];

export function PlayerWinnerCard({
  themeKey: _themeKey,
  venueName = "Soul Fire",
  nightDateLabel = "May 27",
  finalScore = 8420,
  stats = DEFAULT_STATS,
  blurb = "Untouchable from the third question on. Two streaks of five and a near-perfect history round.",
  onSave,
}: PlayerWinnerCardProps = {}) {
  const { t, themeKey } = useTheme();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Default save handler: render the trading-card panel to a PNG via
  // html-to-image and trigger a browser download. We dynamic-import the
  // library so its ~30KB stays out of the initial bundle.
  const handleSave = useCallback(async () => {
    if (onSave) {
      onSave();
      return;
    }
    const node = cardRef.current;
    if (!node) return;
    setSaveState("saving");
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        // Bump pixel ratio so the saved card is crisp on retina screens.
        pixelRatio: Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 2, 3),
        cacheBust: true,
        backgroundColor: t.paper,
      });
      const filename = `tr1via-${slugifyForFilename(venueName)}-${slugifyForFilename(nightDateLabel)}.png`;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 2200);
    } catch (err) {
      console.error("[PlayerWinnerCard] toPng failed", err);
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), 2200);
    }
  }, [onSave, t.paper, venueName, nightDateLabel]);

  return (
    <PhoneScreen data-testid="player-winner-card">
      {/* Heightened weather behind the card for finale energy. PhoneScreen
          already renders weather at intensity 0.5; we add an extra layer at
          1.4 to dial up the moment without rebuilding the shell. */}
      <Weather themeKey={themeKey} intensity={1.4} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6 }}>
          <Eyebrow color={t.accent} size={10}>YOU WON</Eyebrow>
          <Eyebrow color={t.inkMid} size={10}>{venueName.toUpperCase()} · {nightDateLabel.toUpperCase()}</Eyebrow>
        </div>

        {/* Trading-card panel — designed to screenshot well */}
        <div
          ref={cardRef}
          style={{
            marginTop: 18,
            background: t.accent,
            color: "#0E0805",
            borderRadius: 18,
            padding: "24px 22px",
            position: "relative",
            overflow: "hidden",
            boxShadow: `0 22px 40px -12px ${t.accent}77`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark size={18} accent="#0E0805" ink="#0E0805" />
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 99,
                background: "#0E0805",
                color: t.accent,
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.1em",
              }}
            >
              WON THE NIGHT
            </span>
          </div>

          <Display
            size={68}
            color="#0E0805"
            weight={700}
            tracking={-0.045}
            style={{ marginTop: 22, display: "block" }}
          >
            You won.
          </Display>

          <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 10 }}>
            <Numeric size={56} weight={700} color="#0E0805" tracking={-0.04} style={{ lineHeight: 1 }}>
              {finalScore.toLocaleString()}
            </Numeric>
            <span style={{ fontSize: 14, color: "rgba(14,8,5,.65)", fontWeight: 500 }}>points</span>
          </div>

          <div
            style={{
              marginTop: 22,
              paddingTop: 16,
              borderTop: "1px solid rgba(14,8,5,.18)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {stats.map((s) => (
              <div
                key={s.label}
                style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}
              >
                <Eyebrow color="rgba(14,8,5,.55)" size={9}>{s.label}</Eyebrow>
                <Numeric size={14} weight={700} color="#0E0805">{s.value}</Numeric>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 18, fontSize: 13, color: t.inkMid, lineHeight: 1.5 }}>
          {blurb}
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, paddingTop: 14 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            data-testid="player-winner-download"
            aria-label={
              saveState === "saving"
                ? "Saving your winner card to a PNG"
                : "Save your winner card as a PNG image"
            }
            style={{
              background: t.ink,
              color: t.paper,
              border: "none",
              borderRadius: 14,
              padding: "16px 0",
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "var(--font-sans)",
              cursor: saveState === "saving" ? "progress" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: saveState === "saving" ? 0.7 : 1,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M8 1V11M8 1L4 5M8 1L12 5M2 11V13C2 13.55 2.45 14 3 14H13C13.55 14 14 13.55 14 13V11"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="rotate(180 8 7.5)"
              />
            </svg>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved!"
                : saveState === "error"
                  ? "Couldn’t save — try again"
                  : "Save your card"}
          </button>
          <div
            style={{
              fontSize: 11,
              color: t.inkMute,
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
            }}
          >
            SAVES A PNG TO YOUR DOWNLOADS
          </div>
        </div>
      </div>
    </PhoneScreen>
  );
}
