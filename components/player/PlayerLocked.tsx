// Player phone — LOCKED.
// After the player picks. Same category banner + timer (still counting down
// for everyone else) + the four answer cards in mixed states. Self pick is
// scaled & glowing; siblings fade. Bottom shows quiet "waiting on the room"
// status with a pulse dot so it doesn't feel frozen.
//
// This one screen is shown from the instant of the tap. `sendState` says how
// far the answer has got: sending → locked (the server said yes) or, when the
// network is bad, retrying → locked, or unconfirmed if the question closed
// first. Only "locked" claims anything about the answer being counted.

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
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { SeptemberQuestionLampBand } from "@/components/system/SeptemberFront";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { hasPhoneLayer } from "@/lib/experience/packs";
import { YourPumpkin } from "@/components/experience/october/YourPumpkin";
import type { StandingRow } from "@/lib/player/betweenGames";
import { PlayerSendStatus, type PlayerLockedSendState } from "./PlayerSendStatus";

export type { PlayerLockedSendState };

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
  /** Time-to-lock in ms — drives the "Locked at 2.3s" stat. `null` = the
   *  server has said yes but its saved time has not reached this phone yet, so
   *  no time is claimed. Omitted → the gallery's sample value. */
  msToLock?: number | null;
  /** How far the answer has got (see the file header). Default "locked". */
  sendState?: PlayerLockedSendState;
  /** "rejected" only: lets the player send the same answer again. */
  onRetry?: () => void;
  /** "rejected" only: lets the player pick a different answer. Receives the
   *  visible slot (1..4) tapped. Omitted → the other cards stay faded. */
  onPick?: (slot: 1 | 2 | 3 | 4) => void;
  /** Static locked-in count, e.g. "21/32". Optional, and never defaulted: a
   *  made-up count on a real phone tells the room something untrue. */
  lockedSummary?: string;
  /** Question number within its game (1..N). */
  questionNumber?: number;
  /** Live count of players locked in for THIS question (numerator). When this
   *  and totalPlayers are set, a live "X of Y locked in" bar replaces the
   *  static count — it fills as the room answers, so the wait feels alive.
   *  Omitted → bar hidden (gallery/demo keep the original screen). */
  lockedCount?: number;
  /** Players who can answer this question (denominator for the live bar). */
  totalPlayers?: number;
  /** Live standings (as of the last reveal) so the player can see where they
   *  stand while the timer runs. Omitted → the board is hidden (gallery/demo
   *  keep the original locked screen). Mirrors the between-games board shape. */
  standings?: { top: StandingRow[]; you: StandingRow | null };
  /** Room Magic is enabled for this night. Does not mount controls pre-reveal. */
  roomMagicEnabled?: boolean;
}

export interface PlayerLockedStandingsRowProps {
  row: StandingRow;
  pinned?: boolean;
  accent: string;
  surface: string;
  ink: string;
}

export function PlayerLockedStandingsRow({
  row,
  pinned,
  accent,
  surface,
  ink,
}: PlayerLockedStandingsRowProps) {
  return (
    <div
      data-testid={row.isYou ? "standings-you" : "standings-row"}
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 10,
        background: row.isYou ? accent : surface,
        color: row.isYou ? "#0E0805" : ink,
        border: pinned ? `1.5px dashed ${accent}` : "none",
        fontWeight: row.isYou ? 700 : 500,
      }}
    >
      <Numeric size={15} weight={700} color="currentColor">
        {row.rank}
      </Numeric>
      <span
        style={{
          fontSize: 14,
          fontWeight: row.isYou ? 700 : 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.name}
      </span>
      <Numeric size={15} weight={700} color="currentColor">
        {row.score.toLocaleString()}
      </Numeric>
    </div>
  );
}

export function PlayerLocked({
  category = "Geography",
  value = 100,
  options = ["Florida", "Alaska", "California", "Maine"],
  chosenSlot = 2,
  seconds = 11,
  msToLock = 2300,
  sendState = "locked",
  onRetry,
  onPick,
  lockedSummary,
  questionNumber: _questionNumber,
  lockedCount,
  totalPlayers,
  standings,
  roomMagicEnabled = false,
}: PlayerLockedProps = {}) {
  const { t, themeKey } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const pulseAnimation = reducedMotion
    ? "none"
    : "tr1via-pulse 1.4s ease-in-out infinite";
  const catColor = categoryColor(category, t.accent);
  const septemberQuestion = themeKey === "september";
  const bannerBottomGap = septemberQuestion ? 0 : 18;
  const isLocked = sendState === "locked";
  const hasStandings = !!standings && standings.top.length > 0;

  // Live "X of Y locked in" — the one thing on this screen that actually moves
  // while the timer runs. Only when real numbers are supplied (the room feed);
  // gallery/demo omit them and keep the original static count.
  const hasLiveCount =
    typeof lockedCount === "number" && typeof totalPlayers === "number" && totalPlayers > 0;
  const lockPct = hasLiveCount
    ? Math.round(Math.min(1, Math.max(0, lockedCount! / totalPlayers!)) * 100)
    : 0;

  return (
    <PhoneScreen data-testid="player-locked" weatherPage="question">
      <div
        style={{
          margin: `-14px -22px ${bannerBottomGap}px`,
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

      {septemberQuestion && <SeptemberQuestionLampBand />}

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
        <PlayerSendStatus sendState={sendState} msToLock={msToLock} accent={catColor} onRetry={onRetry} />
        {hasPhoneLayer(themeKey) && sendState !== "rejected" ? (
          // (Hidden once the answer is refused: it can no longer light, and
          // its width is what the Try again button needs on a small phone.)
          // October: your pumpkin lights the moment the server says yes.
          <YourPumpkin
            mood={isLocked ? "lit" : sendState === "unconfirmed" ? "toppled" : "waiting"}
            size={56}
            style={{ margin: "-18px 0 -8px" }}
          />
        ) : null}
        {!hasLiveCount && lockedSummary && <Numeric size={12} color={t.inkMid}>{lockedSummary}</Numeric>}
      </div>

      {hasLiveCount && (
        <div data-testid="lockin-progress" style={{ marginBottom: 16 }} role="status" aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              data-testid="player-lockin-pulse-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: catColor,
                animation: pulseAnimation,
              }}
            />
            <Eyebrow color={t.inkMid} size={10}>
              {lockedCount} of {totalPlayers} locked in
            </Eyebrow>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: t.line, overflow: "hidden" }}>
            <div
              data-testid="lockin-fill"
              style={{
                width: `${lockPct}%`,
                height: "100%",
                borderRadius: 99,
                background: catColor,
                transition: "width .4s cubic-bezier(.2,.7,.3,1)",
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {([1, 2, 3, 4] as const).map((slot, i) => (
          <AnswerCard
            key={slot}
            accent={catColor}
            n={slot}
            text={options[i] ?? ""}
            // After a refusal the other answers wake up again so the player
            // can change their mind; the refused one stays marked.
            state={
              slot === chosenSlot
                ? "locked-self"
                : sendState === "rejected" && onPick
                  ? "idle"
                  : "locked-other"
            }
            onTap={sendState === "rejected" && onPick && slot !== chosenSlot ? () => onPick(slot) : undefined}
            focusOnMount={slot === chosenSlot}
            data-testid={`player-locked-answer-${slot}`}
            // Continuation of the tap: the cards are already there, so they
            // never fade or slide in again.
            entrance={false}
          />
        ))}
      </div>

      {hasStandings && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow color={t.inkMute} size={10}>WHERE YOU STAND</Eyebrow>
          {standings!.top.map((row) => (
            <PlayerLockedStandingsRow
              key={`${row.rank}-${row.name}`}
              row={row}
              accent={catColor}
              surface={t.surface}
              ink={t.ink}
            />
          ))}
          {standings!.you && (
            <PlayerLockedStandingsRow
              row={standings!.you}
              pinned
              accent={catColor}
              surface={t.surface}
              ink={t.ink}
            />
          )}
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 18, textAlign: "center", color: t.inkMid, fontSize: 13 }}>
        {roomMagicEnabled && (
          <div
            aria-live="polite"
            data-testid="player-house-lights-confirmation"
            style={{
              marginBottom: 8,
              minHeight: 18,
              color: t.ink,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {isLocked ? "Answer saved." : "\u00A0"}
          </div>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 18 }}>
          {(isLocked || sendState === "sending") && (
            <span
              data-testid="player-waiting-pulse-dot"
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                background: catColor,
                animation: pulseAnimation,
              }}
            />
          )}
          {isLocked || sendState === "sending"
            ? "Waiting for the room to lock in\u2026"
            : sendState === "retrying"
              ? "Keep this screen open while we retry."
              : sendState === "unconfirmed"
                ? "Waiting for the reveal\u2026"
                : ""}
        </span>
      </div>
    </PhoneScreen>
  );
}
