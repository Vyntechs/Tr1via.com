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

import { useEffect, useId, useState, type CSSProperties, type FormEvent } from "react";
import {
  useTheme,
  Wordmark,
  Display,
  Eyebrow,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";
import {
  MAX_PLAYER_NAME,
  MAX_PLAYER_NAME_RAW,
  clampPlayerName,
  countNameChars,
  handleNameInputChange,
} from "@/lib/player/nameLimit";

// Read by screen readers, invisible on screen.
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

export interface PlayerJoinProps {
  themeKey?: ThemeKey;
  /** Pre-filled name (e.g. "Maya"); when in live mode the user can edit. */
  playerName?: string;
  /**
   * Venue name exactly as the host typed it ("Soul Fire Pizza"), used in the
   * eyebrow and the supporting copy. The gallery default is demo-only.
   */
  venueName?: string;
  /** Host's display name for the supporting copy. Live callers always pass it;
   *  an empty string drops the "hosted by" clause instead of naming a demo
   *  host. The gallery default is demo-only. */
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
  venueName = "Soul Fire Pizza",
  hostName = "Linda",
  onSubmit,
  submitting,
  error,
}: PlayerJoinProps = {}) {
  const { t } = useTheme();
  const interactive = !!onSubmit;
  // Names cap at 16 visible characters (an emoji counts as 1). A seed name
  // longer than that (an old 40-character name typed before the cap) is
  // shortened here so a returning player can still tap Join.
  const [name, setName] = useState(() => clampPlayerName(playerName));

  // Keep the input synced when the parent updates the seed name (e.g. on
  // remount after a network failure).
  useEffect(() => {
    if (!interactive) setName(clampPlayerName(playerName));
  }, [playerName, interactive]);

  const nameCount = countNameChars(name);
  const hintId = useId();
  const counterId = useId();

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
            Wednesday trivia at {venueName}{hostName ? `, hosted by ${hostName}` : ""}. Pick a name and you&apos;re in the room.
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
                  onChange={(e) => handleNameInputChange(e.target, name, setName)}
                  placeholder="Your name"
                  // Raw ceiling only: the real 16-character cap is the clamp
                  // above, because maxLength counts an emoji as 2+.
                  maxLength={MAX_PLAYER_NAME_RAW}
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  style={INPUT_STYLE(t.ink)}
                  aria-label="Your display name"
                  aria-describedby={`${hintId} ${counterId}`}
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
            <div
              style={{
                marginTop: 10,
                color: t.inkMute,
                fontSize: 12,
                display: "flex",
                alignItems: "baseline",
                // Counter sits right after the hint, not at the far edge:
                // month art (September's confetti) lives at the right edge.
                gap: 10,
              }}
            >
              <span id={hintId}>Everyone sees this. Keep it kind.</span>
              {interactive && (
                <span
                  id={counterId}
                  data-testid="player-name-counter"
                  style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                >
                  {/* Screen readers get words ("12 of 16 characters") when
                      they read the box's description, never "12/16". */}
                  <span aria-hidden="true">
                    {nameCount}/{MAX_PLAYER_NAME}
                  </span>
                  <span style={VISUALLY_HIDDEN}>
                    {nameCount} of {MAX_PLAYER_NAME} characters
                  </span>
                </span>
              )}
              {interactive && (
                // Always in the page (late-added live regions are often
                // missed). Silent while typing; one polite note at the cap.
                <span aria-live="polite" data-testid="player-name-limit-note" style={VISUALLY_HIDDEN}>
                  {nameCount >= MAX_PLAYER_NAME ? `Name is full, ${MAX_PLAYER_NAME} characters.` : ""}
                </span>
              )}
            </div>
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
          {submitting ? "Joining…" : "Join the game  →"}
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
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: t.inkMid, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              Terms
            </a>{" "}
            and{" "}
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
