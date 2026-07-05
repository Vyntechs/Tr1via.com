// Player phone — RECAP (everyone else).
// Warm personal recap for the non-winners. No leaderboard pressure — stats
// are private to this player. Closes with a "next Wednesday" reminder and a
// soft "suggest a topic" CTA to keep players engaged between nights.

"use client";

import { useState } from "react";
import {
  useTheme,
  Display,
  Eyebrow,
  Numeric,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerRecapStat {
  label: string;
  value: string;
  /** Optional color override; defaults derive from semantic position. */
  color?: string;
}

export interface PlayerRecapProps {
  themeKey?: ThemeKey;
  venueName?: string;
  nightDateLabel?: string;
  /** Final 1-based rank, or `null` when the rank can't be determined (the
   *  player is missing from `game_scores` — e.g. no participation row).
   *  Rendering falls back to a non-numbered "Nice run." headline rather than
   *  showing the literal "#0" the old code path would produce. */
  finalRank?: number | null;
  finalScore?: number;
  stats?: PlayerRecapStat[];
  /** Caption above the stats. */
  blurb?: string;
  /** "Stayed in the top ten all night" headline blurb (optional). */
  highlight?: string;
  /** Action to take when the player saves a topic idea. */
  onSuggestTopic?: (text: string) => void | Promise<void>;
}

export function PlayerRecap({
  themeKey: _themeKey,
  venueName = "Soul Fire",
  nightDateLabel = "May 27",
  finalRank = 7,
  finalScore = 5360,
  stats,
  blurb = "You climbed from #11 to #7 over the second game. The biggest jump was after Music.",
  highlight = "STAYED IN THE TOP TEN ALL NIGHT",
  onSuggestTopic,
}: PlayerRecapProps = {}) {
  const { t } = useTheme();
  const [suggestionText, setSuggestionText] = useState("");
  const [suggestionState, setSuggestionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const canSubmitSuggestion = Boolean(onSuggestTopic) && suggestionText.trim().length > 0 && suggestionState !== "saving";
  const defaultStats: PlayerRecapStat[] = [
    { label: "GOT RIGHT",      value: "28 / 42",      color: t.correct },
    { label: "BEST CATEGORY",  value: "Music · 7/7",  color: categoryColor("Music", t.accent) },
    { label: "FASTEST ANSWER", value: "1.4s · Pixar", color: t.pop },
    { label: "LONGEST STREAK", value: "× 4",          color: t.accent },
  ];
  const rows = stats ?? defaultStats;

  async function handleSubmitSuggestion() {
    const trimmed = suggestionText.trim();
    if (!trimmed || !onSuggestTopic) return;
    setSuggestionState("saving");
    try {
      await onSuggestTopic(trimmed);
      setSuggestionText(trimmed);
      setSuggestionState("saved");
    } catch {
      setSuggestionState("error");
    }
  }

  return (
    <PhoneScreen data-testid="player-recap">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6 }}>
        <Eyebrow color={t.inkMid} size={10}>YOUR NIGHT · {venueName.toUpperCase()}</Eyebrow>
        <Eyebrow color={t.inkMute} size={10}>{nightDateLabel.toUpperCase()}</Eyebrow>
      </div>

      <Display
        size={56}
        color={t.ink}
        style={{ marginTop: 16, display: "block" }}
        tracking={-0.03}
      >
        Wrapped.
        <br />
        {finalRank && finalRank > 0 ? (
          <>You finished <span style={{ color: t.accent }}>#{finalRank}</span>.</>
        ) : (
          <span style={{ color: t.accent }}>Nice run.</span>
        )}
      </Display>

      <div style={{ marginTop: 22, padding: "18px 22px", borderRadius: 16, background: t.surface }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <Eyebrow color={t.inkMid} size={10}>YOUR SCORE</Eyebrow>
          <Numeric size={42} weight={700} color={t.ink} tracking={-0.03}>{finalScore.toLocaleString()}</Numeric>
        </div>

        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: `1px solid ${t.line}`,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {rows.map((s) => (
            <div
              key={s.label}
              style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}
            >
              <Eyebrow color={t.inkMid} size={9}>{s.label}</Eyebrow>
              <Numeric size={15} weight={700} color={s.color ?? t.ink}>{s.value}</Numeric>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 12, border: `1px dashed ${t.line}` }}>
        <Eyebrow color={t.inkMute} size={10}>{highlight}</Eyebrow>
        <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid, lineHeight: 1.45 }}>
          {blurb}
        </div>
      </div>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, paddingTop: 12 }}>
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 12,
            background: t.accent,
            color: "#0E0805",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 6L8 2L14 6V13C14 13.55 13.55 14 13 14H3C2.45 14 2 13.55 2 13V6Z"
              stroke="#0E0805"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Next Wednesday · 7:00</div>
            <div style={{ fontSize: 11, color: "rgba(14,8,5,.65)", fontWeight: 500 }}>
              Same place, fresh board.
            </div>
          </div>
        </div>
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            border: `1px solid ${suggestionState === "saved" ? t.correct : t.line}`,
            background: "transparent",
          }}
        >
          <label
            htmlFor="next-week-topic"
            style={{ display: "block", fontSize: 11, color: t.inkMid, fontWeight: 700 }}
          >
            Suggest one topic for next week
          </label>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <input
              id="next-week-topic"
              type="text"
              value={suggestionText}
              maxLength={100}
              onChange={(e) => {
                setSuggestionText(e.target.value);
                if (suggestionState !== "saving") setSuggestionState("idle");
              }}
              placeholder="Movies from the 2000s"
              disabled={!onSuggestTopic || suggestionState === "saving"}
              style={{
                minWidth: 0,
                flex: 1,
                background: t.surface,
                border: `1px solid ${t.line}`,
                borderRadius: 10,
                color: t.ink,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                padding: "10px 11px",
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={handleSubmitSuggestion}
              disabled={!canSubmitSuggestion}
              style={{
                border: "none",
                borderRadius: 10,
                background: canSubmitSuggestion ? t.ink : t.surface,
                color: canSubmitSuggestion ? t.paper : t.inkMute,
                fontSize: 12,
                fontWeight: 800,
                fontFamily: "var(--font-sans)",
                padding: "0 12px",
                cursor: canSubmitSuggestion ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              {suggestionState === "saving"
                ? "Saving..."
                : suggestionState === "error"
                  ? "Try again"
                  : "Save idea"}
            </button>
          </div>
          {suggestionState === "saved" && (
            <div style={{ marginTop: 7, fontSize: 11, color: t.correct, fontWeight: 700 }}>
              Saved for next week.
            </div>
          )}
          {suggestionState === "error" && (
            <div style={{ marginTop: 7, fontSize: 11, color: t.wrong, fontWeight: 700 }}>
              Could not save. Try again.
            </div>
          )}
        </div>
      </div>
    </PhoneScreen>
  );
}
