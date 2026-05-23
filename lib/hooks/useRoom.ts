// useRoom — the single hook every TR1VIA surface uses to read live game state.
//
// Why one hook: the phone, the TV, and the host laptop all share a single
// state machine. Resolving "what should I show right now" from a flat
// snapshot of (night, games, players, currentGame, currentQuestion,
// currentReveal) keeps every surface aligned: there is exactly one source
// of truth and the per-surface routing layer just maps the snapshot to a
// component.
//
// Two real-time channels:
//   1. Broadcast on `room:{code}` — low-latency reveal/undo/resolve hints
//      that let the UI animate within ~80ms of the host press, *before*
//      Postgres Changes lands.
//   2. Postgres Changes on the 6 affected tables (players, answers,
//      reveals, questions, categories, games). Durable, slower (~300ms)
//      but the source of truth on reload.
//
// Both channels write into the same state shape, so a missed broadcast
// (network blip) self-heals on the next Postgres Change.

"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { parseRoomCode } from "@/lib/game/room-code";
import type {
  AnswerRow,
  CategoryRow,
  GameRow,
  NightRow,
  PlayerRow,
  QuestionRow,
  RevealRow,
} from "@/lib/supabase/types";

export interface RoomSnapshot {
  /** Night row (venue, theme, lock status, room code) or null while loading. */
  night: NightRow | null;
  /** Up to 2 games, ordered by game_no. */
  games: GameRow[];
  /** All categories across both games, ordered by (game, position). */
  categories: CategoryRow[];
  /** Players in the night (soft-removed filtered out, sorted by join time). */
  players: PlayerRow[];
  /** Game currently in 'live' state, or the most recent 'done' if none live. */
  currentGame: GameRow | null;
  /** Question with played_at set but finished_at null. There can be at most one. */
  currentQuestion: QuestionRow | null;
  /** The most recent reveals row for the current question, or null. */
  currentReveal: RevealRow | null;
  /** Most recent broadcast event tag — useful for triggering one-shot animations. */
  lastBroadcast: BroadcastTag | null;
  /** True while the initial snapshot fetch is in flight. */
  isLoading: boolean;
}

export interface BroadcastTag {
  event: "reveal" | "undo" | "resolve" | "end-early";
  questionId: string;
  /** Server's "now" at broadcast time. ISO string. */
  serverNow: string;
  /** Reveal-specific: server timestamp of the reveal. ISO string. */
  revealedAt?: string;
  /** Resolve-specific: canonical correct option index. */
  correctIndex?: number;
  /** Resolve-specific: per-player award rows. */
  awards?: Array<{ playerId: string; awarded: number; isCorrect: boolean }>;
}

const EMPTY: RoomSnapshot = {
  night: null,
  games: [],
  categories: [],
  players: [],
  currentGame: null,
  currentQuestion: null,
  currentReveal: null,
  lastBroadcast: null,
  isLoading: true,
};

export interface UseRoomArgs {
  /** Display-formatted or stored room code. Normalized internally. */
  roomCode: string | null;
}

export function useRoom({ roomCode }: UseRoomArgs): RoomSnapshot {
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(EMPTY);

  useEffect(() => {
    if (!roomCode) {
      setSnapshot(EMPTY);
      return;
    }
    const code = parseRoomCode(roomCode);
    let cancelled = false;
    let channelHandles: Array<() => void> = [];

    const supa = getSupabaseBrowser();

    async function bootstrap() {
      // Look up the night by room code first (server route bypasses RLS
      // since we don't yet have a player session here).
      const nightRes = await fetch(`/api/nights/by-code/${code}`);
      if (!nightRes.ok) {
        if (!cancelled) setSnapshot({ ...EMPTY, isLoading: false });
        return;
      }
      const lookup = (await nightRes.json()) as { nightId: string };
      const nightId = lookup.nightId;
      if (cancelled) return;

      // Fetch full row + games + categories + players + open questions +
      // reveals concurrently.
      const [
        nightRow,
        gameRows,
        categoryRows,
        playerRows,
        liveQuestion,
        recentReveals,
      ] = await Promise.all([
        supa.from("nights").select("*").eq("id", nightId).single(),
        supa
          .from("games")
          .select("*")
          .eq("night_id", nightId)
          .order("game_no", { ascending: true }),
        supa
          .from("categories")
          .select("*, games!inner(night_id)")
          .eq("games.night_id", nightId)
          .order("position", { ascending: true }),
        supa
          .from("players")
          .select("*")
          .eq("night_id", nightId)
          .is("removed_at", null)
          .order("joined_at", { ascending: true }),
        supa
          .from("questions")
          .select("*, categories!inner(games!inner(night_id))")
          .eq("categories.games.night_id", nightId)
          .not("played_at", "is", null)
          .is("finished_at", null)
          .maybeSingle(),
        supa
          .from("reveals")
          .select("*, games!inner(night_id)")
          .eq("games.night_id", nightId)
          .order("occurred_at", { ascending: false })
          .limit(1),
      ]);

      if (cancelled) return;

      const games = (gameRows.data ?? []) as GameRow[];
      const categories = sanitizeCategoryRows(
        (categoryRows.data ?? []) as Array<CategoryRow & { games?: unknown }>,
      );
      const players = (playerRows.data ?? []) as PlayerRow[];
      const currentQuestion = sanitizeQuestionRow(
        liveQuestion.data as (QuestionRow & { categories?: unknown }) | null,
      );
      const reveals = (recentReveals.data ?? []) as Array<
        RevealRow & { games?: unknown }
      >;
      const currentReveal = reveals[0]
        ? (stripJoin(reveals[0], "games") as RevealRow)
        : null;
      setSnapshot({
        night: nightRow.data as NightRow | null,
        games,
        categories,
        players,
        currentGame: pickCurrentGame(games),
        currentQuestion,
        currentReveal,
        lastBroadcast: null,
        isLoading: false,
      });

      // Subscribe to broadcast + 6 tables of postgres changes.
      const filterBy = `night_id=eq.${nightId}`;

      const broadcastChannel = supa
        .channel(`room:${code}`)
        .on("broadcast", { event: "reveal" }, (msg) => {
          const p = msg.payload as Record<string, unknown>;
          mergeBroadcast({
            event: "reveal",
            questionId: String(p.questionId),
            serverNow: String(p.serverNow),
            revealedAt: typeof p.revealedAt === "string" ? p.revealedAt : undefined,
          });
        })
        .on("broadcast", { event: "undo" }, (msg) => {
          const p = msg.payload as Record<string, unknown>;
          mergeBroadcast({
            event: "undo",
            questionId: String(p.questionId),
            serverNow: String(p.serverNow),
          });
        })
        .on("broadcast", { event: "resolve" }, (msg) => {
          const p = msg.payload as Record<string, unknown>;
          mergeBroadcast({
            event: "resolve",
            questionId: String(p.questionId),
            serverNow: String(p.serverNow),
            correctIndex:
              typeof p.correctIndex === "number" ? p.correctIndex : undefined,
            awards: Array.isArray(p.awards)
              ? (p.awards as BroadcastTag["awards"])
              : undefined,
          });
        })
        .on("broadcast", { event: "end-early" }, (msg) => {
          const p = msg.payload as Record<string, unknown>;
          mergeBroadcast({
            event: "end-early",
            questionId: String(p.questionId),
            serverNow: String(p.serverNow),
          });
        })
        .subscribe();
      channelHandles.push(() => {
        void supa.removeChannel(broadcastChannel);
      });

      // Realtime payloads come typed as { [k: string]: any }. Each
      // `on()` callback below narrows through unknown to the table's
      // ChangePayload<T> for type-safe row handling.
      const dbChannel = supa
        .channel(`room-db:${code}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "players", filter: filterBy },
          (payload) =>
            mergePlayerChange(payload as unknown as ChangePayload<PlayerRow>),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "nights", filter: `id=eq.${nightId}` },
          (payload) =>
            mergeNightChange(payload as unknown as ChangePayload<NightRow>),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "games", filter: filterBy },
          (payload) =>
            mergeGameChange(payload as unknown as ChangePayload<GameRow>),
        )
        .on(
          "postgres_changes",
          // Categories/questions/answers/reveals don't have a direct night_id
          // column; we filter client-side on subscription. We accept all
          // rows and discard ones outside this night.
          { event: "*", schema: "public", table: "categories" },
          (payload) =>
            mergeCategoryChange(payload as unknown as ChangePayload<CategoryRow>),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "questions" },
          (payload) =>
            mergeQuestionChange(payload as unknown as ChangePayload<QuestionRow>),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "reveals" },
          (payload) =>
            mergeRevealChange(payload as unknown as ChangePayload<RevealRow>),
        )
        .subscribe();
      channelHandles.push(() => {
        void supa.removeChannel(dbChannel);
      });

      // ── change handlers (closures share `setSnapshot`) ──
      function mergeBroadcast(tag: BroadcastTag) {
        if (cancelled) return;
        setSnapshot((prev) => ({ ...prev, lastBroadcast: tag }));
      }

      function mergePlayerChange(payload: ChangePayload<PlayerRow>) {
        if (cancelled) return;
        setSnapshot((prev) => ({
          ...prev,
          players: applyRow(prev.players, payload, (a, b) =>
            a.joined_at.localeCompare(b.joined_at),
          ),
        }));
      }
      function mergeNightChange(payload: ChangePayload<NightRow>) {
        if (cancelled) return;
        if (payload.eventType === "DELETE") return;
        setSnapshot((prev) => ({ ...prev, night: payload.new as NightRow }));
      }
      function mergeGameChange(payload: ChangePayload<GameRow>) {
        if (cancelled) return;
        setSnapshot((prev) => {
          const games = applyRow(prev.games, payload, (a, b) => a.game_no - b.game_no);
          return { ...prev, games, currentGame: pickCurrentGame(games) };
        });
      }
      function mergeCategoryChange(payload: ChangePayload<CategoryRow>) {
        if (cancelled) return;
        const row = (payload.new ?? payload.old) as CategoryRow;
        if (!games.some((g) => g.id === row.game_id)) return;
        setSnapshot((prev) => ({
          ...prev,
          categories: applyRow(prev.categories, payload, (a, b) =>
            a.position - b.position,
          ),
        }));
      }
      function mergeQuestionChange(payload: ChangePayload<QuestionRow>) {
        if (cancelled) return;
        const row = (payload.new ?? payload.old) as QuestionRow;
        // Filter to questions whose category belongs to a game in this night.
        if (!categories.some((c) => c.id === row.category_id)) {
          // Could be a category just added; fall through anyway since
          // currentQuestion lookup will safely no-op if mismatched.
        }
        setSnapshot((prev) => {
          let nextQ = prev.currentQuestion;
          if (payload.eventType === "DELETE") {
            if (nextQ?.id === row.id) nextQ = null;
          } else {
            const updated = payload.new as QuestionRow;
            const isLive = updated.played_at !== null && updated.finished_at === null;
            if (isLive) {
              nextQ = updated;
            } else if (nextQ?.id === updated.id) {
              // It's the live question that just resolved or got cleared.
              nextQ = updated.finished_at ? null : updated;
            }
          }
          return { ...prev, currentQuestion: nextQ };
        });
      }
      function mergeRevealChange(payload: ChangePayload<RevealRow>) {
        if (cancelled) return;
        if (payload.eventType === "DELETE") return;
        const row = payload.new as RevealRow;
        // Filter to reveals whose game belongs to this night.
        if (!games.some((g) => g.id === row.game_id)) return;
        setSnapshot((prev) => ({ ...prev, currentReveal: row }));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
      for (const teardown of channelHandles) teardown();
      channelHandles = [];
    };
  }, [roomCode]);

  return snapshot;
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface ChangePayload<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T | Record<string, never>;
  old: T | Record<string, never>;
}

/** Strip an embedded join field from a row (e.g. `categories.games`). */
function stripJoin<T extends Record<string, unknown>>(
  row: T,
  field: keyof T,
): Omit<T, typeof field> {
  const copy = { ...row } as Record<string, unknown>;
  delete copy[field as string];
  return copy as Omit<T, typeof field>;
}

function sanitizeCategoryRows(
  rows: Array<CategoryRow & { games?: unknown }>,
): CategoryRow[] {
  return rows.map((r) => stripJoin(r, "games") as CategoryRow);
}

function sanitizeQuestionRow(
  row: (QuestionRow & { categories?: unknown }) | null,
): QuestionRow | null {
  if (!row) return null;
  return stripJoin(row, "categories") as QuestionRow;
}

function applyRow<T extends { id: string }>(
  prev: T[],
  payload: ChangePayload<T>,
  cmp: (a: T, b: T) => number,
): T[] {
  if (payload.eventType === "DELETE") {
    const oldRow = payload.old as T;
    return prev.filter((r) => r.id !== oldRow.id);
  }
  const next = payload.new as T;
  // Soft-removed players land here too; the caller's filter pass (below)
  // will reflect them in `players`. For other tables, no soft-remove.
  if ("removed_at" in next && (next as { removed_at?: string | null }).removed_at) {
    return prev.filter((r) => r.id !== next.id);
  }
  const exists = prev.some((r) => r.id === next.id);
  const merged = exists ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next];
  return [...merged].sort(cmp);
}

function pickCurrentGame(games: GameRow[]): GameRow | null {
  const live = games.find((g) => g.state === "live");
  if (live) return live;
  // Fall back to the most recently ended game, then the lowest-game-no
  // ready game. Keeps the TV from going blank between hands.
  const done = [...games].filter((g) => g.state === "done").sort((a, b) => {
    const aT = a.ended_at ?? "";
    const bT = b.ended_at ?? "";
    return bT.localeCompare(aT);
  });
  if (done[0]) return done[0];
  const ready = games.find((g) => g.state === "ready");
  return ready ?? games[0] ?? null;
}
