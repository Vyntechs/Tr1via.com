// Player phone — JOIN.
// First-touch screen. Saturated category color drives the screen; a warm
// Display headline introduces the night. Name field below the fold (caret
// pulses so the player knows it's editable), CTA pinned to the bottom.
//
// Live mode: when a `nightId` is provided we render the name as an editable
// <input>, surface errors and a submitting state, and call `onSubmit` with
// the typed name. In gallery mode we fall back to a static "Maya" caret for
// the design preview.

"use client";

import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  useTheme,
  Wordmark,
  Display,
  Eyebrow,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerJoinProps {
  themeKey?: ThemeKey;
  /** Pre-filled name (e.g. "Maya"); when in live mode the user can edit. */
  playerName?: string;
  /**
   * Venue name surfaced in the eyebrow ("JOINING · SOUL FIRE"). Falls back
   * to "SOUL FIRE" for the gallery.
   */
  venueName?: string;
  /** Host's first name — appears in the supporting copy. */
  hostName?: string;
  /**
   * When defined, the form becomes interactive: name is editable, the CTA
   * calls `onSubmit(name)`, and `error` is shown inline. When undefined the
   * component renders in static-preview mode for the design gallery.
   */
  onSubmit?: (displayName: string) => void;
  /** True while a join request is in flight. Disables the CTA. */
  submitting?: boolean;
  /** Error message to surface inline below the CTA. */
  error?: string | null;
}

export function PlayerJoin({
  themeKey: _themeKey,
  playerName = "Maya",
  venueName = "Soul Fire",
  hostName = "Linda",
  onSubmit,
  submitting,
  error,
}: PlayerJoinProps = {}) {
  const { t } = useTheme();
  const interactive = !!onSubmit;
  const [name, setName] = useState(playerName);

  // Keep the input synced when the parent updates the seed name (e.g. on
  // remount after a network failure).
  useEffect(() => {
    if (!interactive) setName(playerName);
  }, [playerName, interactive]);

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!interactive) return;
    const cleaned = name.trim();
    if (!cleaned) return;
    onSubmit?.(cleaned);
  }

  const ctaDisabled = interactive && (!name.trim() || submitting);

  return (
    <PhoneScreen data-testid="player-join">
      <PhoneHeader eyebrow={`JOINING · ${venueName.toUpperCase()}`} />

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingTop: 24 }}>
          <Wordmark size={36} />
          <div style={{ marginTop: 28 }}>
            <Display size={56} color={t.ink}>
              <span style={{ color: t.accent }}>Pizza,</span>
              <br />
              <span style={{ color: t.ink }}>beer,</span>
              <br />
              <span style={{ color: t.pop }}>
                bragging
                <br />
                rights.
              </span>
            </Display>
          </div>
          <div style={{ marginTop: 18, color: t.inkMid, fontSize: 14.5, lineHeight: 1.45, maxWidth: 280 }}>
            Wednesday trivia at {venueName} Pizza, hosted by {hostName}. Pick a name and you&apos;re in the room.
          </div>

          <div style={{ marginTop: 36 }}>
            <Eyebrow color={t.inkMid} size={10}>YOUR NAME FOR THE NIGHT</Eyebrow>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                borderBottom: `2px solid ${t.accent}`,
                paddingBottom: 12,
              }}
            >
              {interactive ? (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 40))}
                  placeholder="Your name"
                  maxLength={40}
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  style={INPUT_STYLE(t.ink)}
                  aria-label="Your display name"
                  data-testid="player-name-input"
                />
              ) : (
                <span style={{ fontSize: 34, fontWeight: 600, color: t.ink, letterSpacing: "-0.025em", flex: 1 }}>
                  {playerName}
                </span>
              )}
              {!interactive && (
                <span
                  style={{
                    width: 3,
                    height: 30,
                    background: t.accent,
                    animation: "tr1via-caret 1s steps(2) infinite",
                  }}
                />
              )}
            </div>
            <div style={{ marginTop: 10, color: t.inkMute, fontSize: 12 }}>Everyone sees this. Keep it kind.</div>
          </div>
        </div>

        <button
          type="submit"
          disabled={ctaDisabled}
          data-testid="player-join-submit"
          style={{
            marginTop: "auto",
            background: t.accent,
            color: "#FFF",
            border: "none",
            borderRadius: 14,
            padding: "20px 0",
            fontSize: 17,
            fontWeight: 700,
            fontFamily: "var(--font-sans)",
            letterSpacing: "-0.005em",
            cursor: ctaDisabled ? "default" : "pointer",
            opacity: ctaDisabled ? 0.55 : 1,
            boxShadow: `0 14px 30px -10px ${t.accent}66`,
          }}
        >
          {submitting ? "Joining…" : "Join the room  →"}
        </button>
        {error && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              color: t.wrong,
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}
        {interactive && (
          <div
            style={{
              marginTop: 12,
              textAlign: "center",
              fontSize: 11.5,
              lineHeight: 1.4,
              color: t.inkMute,
            }}
          >
            By joining, you agree to our{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: t.inkMid, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              Privacy Policy
            </a>
            .
          </div>
        )}
      </form>
    </PhoneScreen>
  );
}

function INPUT_STYLE(ink: string): CSSProperties {
  return {
    flex: 1,
    fontSize: 34,
    fontWeight: 600,
    color: ink,
    letterSpacing: "-0.025em",
    border: "none",
    outline: "none",
    background: "transparent",
    padding: 0,
    fontFamily: "var(--font-sans)",
    minWidth: 0,
    caretColor: "currentColor",
  };
}
