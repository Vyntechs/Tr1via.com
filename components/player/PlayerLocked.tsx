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
import type { StandingRow } from "@/lib/player/betweenGames";

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
  lockedCount,
  totalPlayers,
  standings,
  roomMagicEnabled = false,
}: PlayerLockedProps = {}) {
  const { t } = useTheme();
  const catColor = categoryColor(category, t.accent);
  const secondsToLock = (msToLock / 1000).toFixed(1);
  const speedBonus = msToLock < 5000;
  const hasStandings = !!standings && standings.top.length > 0;

  // Live "X of Y locked in" — the one thing on this screen that actually moves
  // while the timer runs. Only when real numbers are supplied (the room feed);
  // gallery/demo omit them and keep the original static count.
  const hasLiveCount =
    typeof lockedCount === "number" && typeof totalPlayers === "number" && totalPlayers > 0;
  const lockPct = hasLiveCount
    ? Math.round(Math.min(1, Math.max(0, lockedCount! / totalPlayers!)) * 100)
    : 0;

  function StandingsRow({ row, pinned }: { row: StandingRow; pinned?: boolean }) {
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
          background: row.isYou ? catColor : t.surface,
          color: row.isYou ? "#0E0805" : t.ink,
          border: pinned ? `1.5px dashed ${catColor}` : "none",
          fontWeight: row.isYou ? 700 : 500,
        }}
      >
        <Numeric size={15} weight={700} color="currentColor">{row.rank}</Numeric>
        <span style={{ fontSize: 14, fontWeight: row.isYou ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
        <Numeric size={15} weight={700} color="currentColor">{row.score.toLocaleString()}</Numeric>
      </div>
    );
  }
  return (
    <PhoneScreen data-testid="player-locked">
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
        <div style={{ flex: 1 }} role="status" aria-live="polite">
          <Eyebrow color={t.inkMid} size={9}>LOCKED AT</Eyebrow>
          <div style={{ marginTop: 2, fontSize: 14, color: t.ink, fontWeight: 600 }}>
            <Numeric size={15} color={catColor}>{secondsToLock}s</Numeric>
            <span style={{ color: t.inkMid, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              {speedBonus ? "· speed bonus locked in" : "· locked in"}
            </span>
          </div>
        </div>
        {!hasLiveCount && <Numeric size={12} color={t.inkMid}>{lockedSummary}</Numeric>}
      </div>

      {hasLiveCount && (
        <div data-testid="lockin-progress" style={{ marginBottom: 16 }} role="status" aria-live="polite">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: catColor,
                animation: "tr1via-pulse 1.4s ease-in-out infinite",
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
            state={slot === chosenSlot ? "locked-self" : "locked-other"}
          />
        ))}
      </div>

      {hasStandings && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <Eyebrow color={t.inkMute} size={10}>WHERE YOU STAND</Eyebrow>
          {standings!.top.map((row) => (
            <StandingsRow key={`${row.rank}-${row.name}`} row={row} />
          ))}
          {standings!.you && <StandingsRow row={standings!.you} pinned />}
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 18, textAlign: "center", color: t.inkMid, fontSize: 13 }}>
        {roomMagicEnabled && (
          <div
            style={{
              marginBottom: 8,
              color: t.ink,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Sent to the room.
          </div>
        )}
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
