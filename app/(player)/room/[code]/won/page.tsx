// Winner card route — only shown if this player won the final game.
// Wraps `<PlayerWinnerCard>` with the night's theme and computed stats.

"use client";

import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ThemeProvider, useTheme, Display } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { PlayerWinnerCard } from "@/components/player";
import { useRoom } from "@/lib/hooks/useRoom";
import { useDeviceSession } from "@/lib/hooks/useDeviceSession";
import { isValidRoomCode, parseRoomCode, formatRoomCode } from "@/lib/game/room-code";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import type { AnswerRow, CategoryRow, GameScoreRow, GameRow } from "@/lib/supabase/types";

export default function PlayerWonPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const raw = params?.code ?? "";
  const code = typeof raw === "string" ? parseRoomCode(raw) : "";
  useEffect(() => {
    if (!isValidRoomCode(code)) router.replace("/join");
  }, [code, router]);
  if (!isValidRoomCode(code)) return null;
  return <PlayerWonInner roomCode={code} />;
}

function PlayerWonInner({ roomCode }: { roomCode: string }) {
  const { deviceId, isLoading: deviceLoading } = useDeviceSession();
  const snapshot = useRoom({
    roomCode,
    audience: "player",
    sessionReady: !deviceLoading && !!deviceId,
  });

  const themeKey: ThemeKey = resolveTheme(
    snapshot.night,
    { default_theme_key: snapshot.hostDefaultThemeKey },
  );

  const me = snapshot.self ?? null;

  // Final game = game with highest game_no.
  const finalGame = useMemo<GameRow | null>(() => {
    if (snapshot.games.length === 0) return null;
    return [...snapshot.games].sort((a, b) => b.game_no - a.game_no)[0] ?? null;
  }, [snapshot.games]);

  const scores = snapshot.scores ?? [];
  const answers = snapshot.myAnswers ?? [];

  if (snapshot.isLoading || deviceLoading || !snapshot.night || !me || !finalGame) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <Placeholder roomCode={roomCode} />
      </ThemeProvider>
    );
  }

  const myScoreRow = scores.find((s) => s.player_id === me.id) ?? null;
  const stats = computeStats(answers, snapshot.categories, myScoreRow);

  return (
    <ThemeProvider themeKey={themeKey}>
      <PlayerWinnerCard
        venueName={snapshot.night.venue_name}
        nightDateLabel={formatNightDate(snapshot.night.opened_at ?? snapshot.night.closed_at)}
        finalScore={myScoreRow?.score ?? 0}
        stats={[
          { label: "GOT RIGHT", value: `${stats.correct} / ${stats.answered}` },
          { label: "LONGEST STREAK", value: `× ${stats.longestStreak}` },
          { label: "FASTEST ANSWER", value: stats.fastestLabel },
          { label: "BEST CATEGORY", value: stats.bestCategoryLabel },
        ]}
      />
    </ThemeProvider>
  );
}

function Placeholder({ roomCode }: { roomCode: string }) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`ROOM · ${formatRoomCode(roomCode)}`} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Display size={48} color={t.ink}>
          Wrapping
          <br />
          <span style={{ color: t.accent }}>the night…</span>
        </Display>
      </div>
    </PhoneScreen>
  );
}

// ─── stat derivation ────────────────────────────────────────────────────

function computeStats(
  answers: AnswerRow[],
  categories: CategoryRow[],
  scoreRow: GameScoreRow | null,
): {
  correct: number;
  answered: number;
  longestStreak: number;
  fastestLabel: string;
  bestCategoryLabel: string;
} {
  const correct = answers.filter((a) => a.is_correct === true);
  const longestStreak = computeLongestStreak(answers);
  const fastestMs = scoreRow?.fastest_correct_ms ?? null;
  const fastestLabel =
    fastestMs === null
      ? "—"
      : `${(fastestMs / 1000).toFixed(1)}s`;
  return {
    correct: correct.length,
    answered: answers.length,
    longestStreak,
    fastestLabel,
    bestCategoryLabel: pickBestCategoryLabel(answers, categories),
  };
}

function computeLongestStreak(answers: AnswerRow[]): number {
  const sorted = [...answers].sort((a, b) => a.locked_at.localeCompare(b.locked_at));
  let longest = 0;
  let current = 0;
  for (const a of sorted) {
    if (a.is_correct === true) {
      current += 1;
      if (current > longest) longest = current;
    } else if (a.is_correct === false) {
      current = 0;
    }
  }
  return longest;
}

function pickBestCategoryLabel(_answers: AnswerRow[], _categories: CategoryRow[]): string {
  // We don't have question → category → name joined here without an extra
  // fetch; future iteration will compute the strongest category. For now
  // surface a generic "—" so we don't ship a wrong claim.
  return "—";
}

function formatNightDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
