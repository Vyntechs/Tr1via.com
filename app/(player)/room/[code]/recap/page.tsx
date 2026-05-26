// Recap route — shown to non-winners at the close of the night.
// Wraps `<PlayerRecap>` with stats computed from the player's answers
// across the final game and the leaderboard view.

"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ThemeProvider, useTheme, Display } from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { PlayerRecap, type PlayerRecapStat } from "@/components/player";
import { useRoom } from "@/lib/hooks/useRoom";
import { useDeviceSession } from "@/lib/hooks/useDeviceSession";
import { isValidRoomCode, parseRoomCode, formatRoomCode } from "@/lib/game/room-code";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { AnswerRow, CategoryRow, GameScoreRow, GameRow, PlayerRow } from "@/lib/supabase/types";
import { categoryColor } from "@/lib/theme/categories";

export default function PlayerRecapPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const raw = params?.code ?? "";
  const code = typeof raw === "string" ? parseRoomCode(raw) : "";
  useEffect(() => {
    if (!isValidRoomCode(code)) router.replace("/join");
  }, [code, router]);
  if (!isValidRoomCode(code)) return null;
  return <PlayerRecapInner roomCode={code} />;
}

function PlayerRecapInner({ roomCode }: { roomCode: string }) {
  const { deviceId, isLoading: deviceLoading } = useDeviceSession();
  const snapshot = useRoom({ roomCode, deviceId });

  const themeKey: ThemeKey = resolveTheme(
    snapshot.night,
    { default_theme_key: snapshot.hostDefaultThemeKey },
  );

  const me = useMemo<PlayerRow | null>(() => {
    if (!deviceId) return null;
    return snapshot.players.find((p) => p.device_id === deviceId) ?? null;
  }, [snapshot.players, deviceId]);

  const finalGame = useMemo<GameRow | null>(() => {
    if (snapshot.games.length === 0) return null;
    return [...snapshot.games].sort((a, b) => b.game_no - a.game_no)[0] ?? null;
  }, [snapshot.games]);

  // Tri-state: `null` means "we haven't completed a fetch yet" — the loading
  // guard below uses this to gate render so we never paint "#0" while the
  // initial REST query is still in flight. Once a fetch returns we move to
  // `[]` (empty) or `[...]` (populated). The realtime subscription below
  // refreshes the view as `answers`/`adjustments`/`game_participations`
  // change, which matters when the close-night broadcast lands microseconds
  // before the resolve-question writes complete.
  const [scores, setScores] = useState<GameScoreRow[] | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);

  useEffect(() => {
    if (!finalGame) return;
    const gameId = finalGame.id;
    let cancelled = false;
    const supa = getSupabaseBrowser();
    async function load() {
      const { data } = await supa
        .from("game_scores")
        .select("*")
        .eq("game_id", gameId)
        .order("score", { ascending: false });
      if (cancelled) return;
      setScores((data as GameScoreRow[] | null) ?? []);
    }
    void load();
    // Same load+subscribe pattern HostLiveConsoleClient uses for its own
    // game_scores read (the view is derived, so we listen to the underlying
    // tables rather than the view itself).
    const channel = supa
      .channel(`recap-scores:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adjustments" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_participations" },
        () => void load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [finalGame?.id]);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const supa = getSupabaseBrowser();
    void supa
      .from("answers")
      .select("*")
      .eq("player_id", me.id)
      .then(({ data }) => {
        if (cancelled) return;
        setAnswers((data as AnswerRow[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [me]);

  const handleSuggestTopic = useCallback(async () => {
    const text = prompt("Suggest a topic for next week (one phrase):");
    if (!text?.trim()) return;
    try {
      await fetch("/api/topic-suggestions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
    } catch (e) {
      console.warn("topic suggestion failed", e);
    }
  }, []);

  // Block render until at least one game_scores fetch has completed.
  // Without this gate, the page paints once with the initial state (which
  // used to be `[]`), `computeRank` returns 0 for "player not found", and
  // the player sees "#0" for the brief moment before the REST query lands.
  if (
    snapshot.isLoading ||
    deviceLoading ||
    !snapshot.night ||
    !me ||
    !finalGame ||
    scores === null
  ) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <Placeholder roomCode={roomCode} />
      </ThemeProvider>
    );
  }

  const myScoreRow = scores.find((s) => s.player_id === me.id) ?? null;
  const computedRank = computeRank(scores, me.id);
  // Pass `null` rather than `0` when the player is missing from the view
  // (e.g. no game_participations row) so PlayerRecap renders "Nice run."
  // instead of the meaningless "#0".
  const finalRank: number | null = computedRank > 0 ? computedRank : null;
  const stats = computeStats(answers, snapshot.categories, myScoreRow);

  const t = themeFallbackTokens(themeKey);
  const rows: PlayerRecapStat[] = [
    { label: "GOT RIGHT", value: `${stats.correct} / ${stats.answered}`, color: t.correct },
    {
      label: "BEST CATEGORY",
      value: stats.bestCategoryLabel,
      color: categoryColor(stats.bestCategoryName, t.accent),
    },
    { label: "FASTEST ANSWER", value: stats.fastestLabel, color: t.pop },
    { label: "LONGEST STREAK", value: `× ${stats.longestStreak}`, color: t.accent },
  ];

  const blurb =
    finalRank !== null
      ? `You finished #${finalRank} of ${scores.length}.`
      : "Thanks for playing — your spot didn't make the standings this time.";

  return (
    <ThemeProvider themeKey={themeKey}>
      <PlayerRecap
        venueName={snapshot.night.venue_name}
        nightDateLabel={formatNightDate(snapshot.night.opened_at ?? snapshot.night.closed_at)}
        finalRank={finalRank}
        finalScore={myScoreRow?.score ?? 0}
        stats={rows}
        blurb={blurb}
        highlight="WRAPPED."
        onSuggestTopic={handleSuggestTopic}
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
          Adding
          <br />
          <span style={{ color: t.accent }}>it up…</span>
        </Display>
      </div>
    </PhoneScreen>
  );
}

// ─── stats ──────────────────────────────────────────────────────────────

function computeStats(
  answers: AnswerRow[],
  _categories: CategoryRow[],
  scoreRow: GameScoreRow | null,
): {
  correct: number;
  answered: number;
  longestStreak: number;
  fastestLabel: string;
  bestCategoryLabel: string;
  bestCategoryName: string;
} {
  const correct = answers.filter((a) => a.is_correct === true);
  const longestStreak = computeLongestStreak(answers);
  const fastestMs = scoreRow?.fastest_correct_ms ?? null;
  const fastestLabel = fastestMs === null ? "—" : `${(fastestMs / 1000).toFixed(1)}s`;
  return {
    correct: correct.length,
    answered: answers.length,
    longestStreak,
    fastestLabel,
    bestCategoryLabel: "—",
    bestCategoryName: "Music",
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

function computeRank(scores: GameScoreRow[], playerId: string): number {
  const idx = scores.findIndex((s) => s.player_id === playerId);
  return idx >= 0 ? idx + 1 : 0;
}

function formatNightDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// We can't useTheme() at the top level (themeKey hasn't been provided to the
// ThemeProvider until below); the stat colors only need primitive accents
// from the theme map. Cheap lookup avoids a context dependency for the
// computation done above the provider.
function themeFallbackTokens(themeKey: ThemeKey): { accent: string; pop: string; correct: string } {
  // Import lazily by mirroring the tokens we need; ThemeProvider will
  // re-render with the right colors once the page lands.
  // Keeping inline keeps this file self-contained.
  const map: Record<ThemeKey, { accent: string; pop: string; correct: string }> = {
    house:     { accent: "#FF6A3D", pop: "#4ECDC4", correct: "#C8E25E" },
    daylight:  { accent: "#D9421F", pop: "#1E7A6E", correct: "#3F6B1F" },
    january:   { accent: "#5AA8E0", pop: "#E8C46A", correct: "#B7D88C" },
    february:  { accent: "#FF4673", pop: "#FFD93D", correct: "#C8E25E" },
    march:     { accent: "#3FAE56", pop: "#F2C94C", correct: "#C8E25E" },
    april:     { accent: "#7A4FCC", pop: "#E64A8C", correct: "#3F8030" },
    may:       { accent: "#E8C46A", pop: "#94A5BC", correct: "#A8D88C" },
    june:      { accent: "#E04A6B", pop: "#F2A02D", correct: "#3F8030" },
    july:      { accent: "#E63946", pop: "#FFD93D", correct: "#C8E25E" },
    august:    { accent: "#F08C2A", pop: "#C84A2C", correct: "#C8E25E" },
    september: { accent: "#C84A2C", pop: "#E8A02A", correct: "#C8E25E" },
    october:   { accent: "#F08C2A", pop: "#A94ACC", correct: "#C8E25E" },
    november:  { accent: "#C25E22", pop: "#7E8C2A", correct: "#C8E25E" },
    december:  { accent: "#E63946", pop: "#F2C94C", correct: "#C8E25E" },
  };
  return map[themeKey];
}
