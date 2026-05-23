// Player phone — LOCKED.
// After the player picks. Same category banner + timer (still counting down
// for everyone else) + the four answer cards in mixed states. Self pick is
// scaled & glowing; siblings fade. Bottom shows quiet "waiting on the room"
// status with a pulse dot so it doesn't feel frozen.

"use client";

import {
  useTheme,
  Eyebrow,
  PointTag,
  Numeric,
  AnswerCard,
  TimerRing,
} from "@/components/system";
import { PhoneScreen } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerLockedProps {
  themeKey?: ThemeKey;
  category?: string;
  value?: number;
  /** 4 answer strings, already in the player's scramble order. */
  options?: [string, string, string, string];
  /** Visible slot (1..4) the player picked. */
  chosenSlot?: 1 | 2 | 3 | 4;
  /** Seconds remaining (still counting down for the rest of the room). */
  seconds?: number;
  /** Time-to-lock in seconds — drives the "Locked at 2.3s" stat. */
  msToLock?: number;
  /** Locked-in count fraction string, e.g. "21/32". Optional. */
  lockedSummary?: string;
  /** Question number within its game (1..N). */
  questionNumber?: number;
}

export function PlayerLocked({
  themeKey: _themeKey,
  category = "Geography",
  value = 100,
  options = ["Florida", "Alaska", "California", "Maine"],
  chosenSlot = 2,
  seconds = 11,
  msToLock = 2300,
  lockedSummary = "21/32",
  questionNumber: _questionNumber,
}: PlayerLockedProps = {}) {
  const { t } = useTheme();
  const catColor = categoryColor(category, t.accent);
  const secondsToLock = (msToLock / 1000).toFixed(1);
  const speedBonus = msToLock < 5000;
  return (
    <PhoneScreen>
      <div
        style={{
          margin: "-14px -22px 18px",
          padding: "14px 22px",
          background: catColor,
          color: "#0E0805",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <Eyebrow color="rgba(14,8,5,.65)" size={10}>
            QUESTION {_questionNumber ?? 10} · {category.toUpperCase()}
          </Eyebrow>
          <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{category}</div>
        </div>
        <PointTag value={value} color="#0E0805" ink={catColor} size="md" />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 10,
          background: t.surface,
          marginBottom: 16,
        }}
      >
        <TimerRing accent={catColor} seconds={seconds} />
        <div style={{ flex: 1 }}>
          <Eyebrow color={t.inkMid} size={9}>LOCKED AT</Eyebrow>
          <div style={{ marginTop: 2, fontSize: 14, color: t.ink, fontWeight: 600 }}>
            <Numeric size={15} color={catColor}>{secondsToLock}s</Numeric>
            <span style={{ color: t.inkMid, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              {speedBonus ? "· speed bonus locked in" : "· locked in"}
            </span>
          </div>
        </div>
        <Numeric size={12} color={t.inkMid}>{lockedSummary}</Numeric>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {([1, 2, 3, 4] as const).map((slot, i) => (
          <AnswerCard
            key={slot}
            accent={catColor}
            n={slot}
            text={options[i] ?? ""}
            state={slot === chosenSlot ? "locked-self" : "locked-other"}
          />
        ))}
      </div>

      <div style={{ marginTop: "auto", paddingTop: 18, textAlign: "center", color: t.inkMid, fontSize: 13 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 99,
              background: catColor,
              animation: "tr1via-pulse 1.4s ease-in-out infinite",
            }}
          />
          Waiting for the room to lock in&hellip;
        </span>
      </div>
    </PhoneScreen>
  );
}
