// Player phone — the in-room FINALE (the last screen of the night inside
// /room, before the host closes the room and phones move to /won or /recap).
// Moved out of the room page so the dev preview can render the real thing.
//
// November, for everyone who didn't win: Figma P8. The wishbone, "Tonight's
// winner" with the winner's name and points, then a "Your night" card with
// your rank, your turkey and your stats. Shown only when the room knows the
// winner's name; otherwise the plain layout.

"use client";

import { useTheme, Display, Eyebrow, Numeric } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { hasPhoneLayer } from "@/lib/experience/packs";
import { FlamingHead } from "@/components/experience/october/FlamingHead";
import { YourTurkey } from "@/components/experience/november/YourTurkey";
import {
  NOVEMBER_PHONE_ACCENT,
  NOVEMBER_PHONE_CREAM,
  NOVEMBER_PHONE_PANEL,
  PHONE_WISHBONE_URL,
  isNovemberPhone,
} from "@/lib/experience/november/phone";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";

export function PlayerFinaleView({
  won,
  rank,
  score,
  correct,
  answered,
  fastestMs,
  longestStreak,
  satOut = false,
  finalGameNo = 2,
  playerName,
  playerCount,
  winner = null,
}: {
  /** November finale card for players who didn't win (Figma P8). */
  playerName?: string;
  playerCount?: number;
  /** Tonight's winner, from the room's own scores + roster; null = unknown,
   *  and the screen keeps the plain layout rather than invent a name. */
  winner?: { name: string; score: number } | null;
  won: boolean;
  rank: number | null;
  score: number | null;
  /** Never joined the final game (Game 2 is opt-in, or they arrived after a
   *  one-game night ended), so no score is coming. */
  satOut?: boolean;
  finalGameNo?: number;
  correct: number | null;
  answered: number | null;
  fastestMs: number | null;
  longestStreak: number;
}) {
  const { t, themeKey } = useTheme();
  const stats = [
    correct !== null && answered !== null
      ? { label: "GOT RIGHT", value: `${correct} / ${answered}` }
      : null,
    fastestMs !== null
      ? { label: "FASTEST ANSWER", value: `${(fastestMs / 1000).toFixed(1)}s` }
      : null,
    longestStreak > 0
      ? { label: "LONGEST STREAK", value: `× ${longestStreak}` }
      : null,
  ].filter((row): row is { label: string; value: string } => row !== null);

  if (!won && winner && isNovemberPhone(themeKey)) {
    return (
      <NovemberFinaleCard
        winner={winner}
        playerName={playerName}
        rank={rank}
        playerCount={playerCount}
        score={score}
        satOut={satOut}
        finalGameNo={finalGameNo}
        stats={stats}
      />
    );
  }

  return (
    <PhoneScreen data-testid="player-finale" harvestSky="night">
      <PhoneHeader eyebrow="FINAL RESULTS" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 18 }}>
        <Display size="clamp(44px, 15vw, 64px)" color={t.ink} weight={700}>
          {won ? "You won." : rank !== null ? `You finished #${rank}.` : "Game complete."}
        </Display>
        {won && hasPhoneLayer(themeKey) ? (
          // October: the champion holds the flaming head. If it ever breaks,
          // the line switches off and the finale reads as on any other night.
          <ThemeLayerBoundary name="october:finale-flaming-head">
            <div data-testid="player-finale-flaming-head" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <FlamingHead height={56} style={{ margin: "-12px 0 -4px" }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: t.pop }}>You hold the flaming head.</span>
            </div>
          </ThemeLayerBoundary>
        ) : won && isNovemberPhone(themeKey) ? (
          // November: the champion gets the wishbone. If it ever breaks, the
          // line switches off and the finale reads as on any other night.
          <ThemeLayerBoundary name="november:finale-wishbone">
            <div data-testid="player-finale-wishbone" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={PHONE_WISHBONE_URL} alt="" width={56} height={56} style={{ width: 56, height: 56, margin: "-10px 0 -6px" }} />
              <YourTurkey mood="blaze" size={64} style={{ margin: "-18px 0 -8px -6px" }} />
              <span style={{ fontSize: 16, fontWeight: 700, color: t.pop }}>You got the wishbone.</span>
            </div>
          </ThemeLayerBoundary>
        ) : null}

        <section
          aria-label="Your final result"
          style={{ marginTop: 24, padding: "20px 18px", borderRadius: 16, background: t.surface, border: `1px solid ${t.line}` }}
        >
          {score !== null ? (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
              <Eyebrow color={t.inkMid} size={10}>YOUR SCORE</Eyebrow>
              <Numeric size={40} weight={800} color={t.ink}>{score.toLocaleString()}</Numeric>
            </div>
          ) : (
            <p style={{ margin: 0, color: t.inkMid, lineHeight: 1.5 }}>
              {satOut ? `You sat out Game ${finalGameNo}.` : "Your final score is still catching up."}
            </p>
          )}
          {stats.length > 0 && (
            <dl style={{ margin: "16px 0 0", paddingTop: 14, borderTop: `1px solid ${t.line}`, display: "grid", gap: 12 }}>
              {stats.map((stat) => (
                <div key={stat.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <dt><Eyebrow color={t.inkMid} size={9}>{stat.label}</Eyebrow></dt>
                  <dd style={{ margin: 0 }}><Numeric size={16} weight={800} color={t.ink}>{stat.value}</Numeric></dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <p style={{ margin: "auto 0 0", paddingTop: 22, color: t.inkMid, fontSize: 14, lineHeight: 1.5 }}>
          Final results are ready. Your host will end the game after the celebration.
        </p>
      </div>
    </PhoneScreen>
  );
}

const SHADOW = "0 1px 8px rgba(20,10,5,.9)";
const LABEL = "rgba(242,222,174,.6)";

function NovemberFinaleCard({
  winner,
  playerName,
  rank,
  playerCount,
  score,
  satOut,
  finalGameNo,
  stats,
}: {
  winner: { name: string; score: number };
  playerName?: string;
  rank: number | null;
  playerCount?: number;
  score: number | null;
  satOut: boolean;
  finalGameNo: number;
  stats: { label: string; value: string }[];
}) {
  return (
    <PhoneScreen data-testid="player-finale" harvestSky="night" scroll="auto">
      <PhoneHeader eyebrow="FINAL RESULTS" />
      <div data-testid="player-finale-november" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ position: "relative", display: "flex", justifyContent: "center", marginTop: 2 }}>
          <span
            aria-hidden
            style={{ position: "absolute", top: "6%", width: 180, height: 120, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,214,140,.38), rgba(255,190,110,0))" }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PHONE_WISHBONE_URL} alt="" width={96} height={96} style={{ position: "relative", width: "clamp(72px, 24vw, 112px)", height: "auto" }} />
        </div>
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <Eyebrow color={NOVEMBER_PHONE_ACCENT} size={10}>TONIGHT&apos;S WINNER</Eyebrow>
          <div data-testid="player-finale-winner-name">
          <Display
            size="clamp(40px, 15cqw, 60px)"
            color={NOVEMBER_PHONE_CREAM}
            weight={800}
            style={{ display: "block", marginTop: 2, textShadow: SHADOW, overflowWrap: "anywhere" }}
          >
            {winner.name}
          </Display>
          </div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 17, color: "rgba(242,222,174,.8)", textShadow: SHADOW }}>
            {winner.score.toLocaleString()} points
          </div>
        </div>

        <section
          aria-label="Your night"
          data-testid="player-finale-your-night"
          style={{
            marginTop: 16,
            padding: "18px 18px 18px 20px",
            borderRadius: 24,
            background: NOVEMBER_PHONE_PANEL,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(242,222,174,.08)",
          }}
        >
          <Eyebrow color={LABEL} size={10}>YOUR NIGHT{playerName ? ` · ${playerName.toUpperCase()}` : ""}</Eyebrow>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              {rank !== null ? (
                <>
                  <Numeric size={60} weight={600} color={NOVEMBER_PHONE_CREAM} style={{ lineHeight: 1.1 }}>#{rank}</Numeric>
                  <div style={{ fontSize: 16, fontWeight: 500, color: "rgba(242,222,174,.75)" }}>
                    {typeof playerCount === "number" && playerCount > 0 ? `of ${playerCount} players` : "tonight"}
                  </div>
                </>
              ) : (
                <p style={{ margin: "10px 0 0", color: "rgba(242,222,174,.75)", lineHeight: 1.45 }}>
                  {satOut ? `You sat out Game ${finalGameNo}.` : "Your final score is still catching up."}
                </p>
              )}
            </div>
            <YourTurkey mood="lit" size={104} style={{ margin: "-6px -6px -10px 0" }} />
          </div>
          {score !== null || stats.length > 0 ? (
            <dl style={{ margin: "14px 0 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {score !== null ? <FinaleStat label="YOUR SCORE" value={score.toLocaleString()} /> : null}
              {stats.map((s) => <FinaleStat key={s.label} label={s.label} value={s.value} />)}
            </dl>
          ) : null}
        </section>

        <p style={{ margin: "auto 0 0", paddingTop: 18, color: "rgba(242,222,174,.75)", fontSize: 14, lineHeight: 1.5 }}>
          Final results are ready. Your host will end the game after the celebration.
        </p>
      </div>
    </PhoneScreen>
  );
}

function FinaleStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 14, background: "rgba(242,222,174,.06)", minWidth: 0 }}>
      <dt><Eyebrow color={LABEL} size={9}>{label}</Eyebrow></dt>
      <dd style={{ margin: "6px 0 0" }}>
        <Numeric size={20} weight={700} color={NOVEMBER_PHONE_CREAM}>{value}</Numeric>
      </dd>
    </div>
  );
}
