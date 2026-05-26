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
  /** The host's default_theme_key, used by `resolveTheme(night, host)` when
   *  the night has no per-night theme override (`night.theme_key === null`).
   *  Null when the snapshot hasn't loaded yet OR when the migration adding
   *  the column hasn't been applied. */
  hostDefaultThemeKey: string | null;
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
  /** The most recently finished question (finished_at set). Holds until the
   *  next live question starts. Player surfaces use this to render the
   *  reveal-correct/reveal-wrong frame after a resolve fires — the live row
   *  is gone from currentQuestion but players still need to see what they
   *  picked vs. the right answer before the host moves on. */
  lastResolvedQuestion: QuestionRow | null;
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
  hostDefaultThemeKey: null,
  games: [],
  categories: [],
  players: [],
  currentGame: null,
  currentQuestion: null,
  lastResolvedQuestion: null,
  currentReveal: null,
  lastBroadcast: null,
  isLoading: true,
};

export interface UseRoomArgs {
  /** Display-formatted or stored room code. Normalized internally. */
  roomCode: string | null;
  /** Player's device id. When the caller passes this prop, bootstrap waits
   *  until it resolves to a non-empty value so the very first anon Supabase
   *  fetch carries the `x-tr1via-device` header that RLS uses to find the
   *  player. Omit on host surfaces — hosts authenticate via session JWT,
   *  not the device cookie, so they don't need to wait. */
  deviceId?: string | null;
}

export function useRoom({ roomCode, deviceId }: UseRoomArgs): RoomSnapshot {
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(EMPTY);
  // Player call sites pass `deviceId`. Until it's a real value we hold off so
  // the bootstrap fetch can attach `x-tr1via-device` and pass `nights_player_read`.
  // `undefined` means "caller didn't opt in" (host surface) — fire immediately.
  const waitingForDevice = deviceId === null || deviceId === "";

  useEffect(() => {
    if (!roomCode || waitingForDevice) {
      if (!roomCode) setSnapshot(EMPTY);
      return;
    }
    const code = parseRoomCode(roomCode);
    let cancelled = false;
    let channelHandles: Array<() => void> = [];

    const supa = getSupabaseBrowser();

    /**
     * Re-fetch the moving parts of the snapshot — games (state may have
     * flipped ready→live), the live question (played_at / finished_at), and
     * answers for the live question. We hit these via HTTP through the
     * browser client, which attaches x-tr1via-device, so RLS gives the player
     * read access. Called as a fallback whenever a broadcast event arrives,
     * since postgres_changes can drop events for device-authed players.
     */
    async function refreshLiveState(nightId: string, questionId?: string): Promise<void> {
      if (cancelled) return;
      const [gamesRes, qRes] = await Promise.all([
        supa
          .from("games")
          .select("*")
          .eq("night_id", nightId)
          .order("game_no", { ascending: true }),
        questionId
          ? supa.from("questions").select("*").eq("id", questionId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      const nextGames = (gamesRes.data ?? null) as GameRow[] | null;
      const nextQ = (qRes.data ?? null) as QuestionRow | null;
      setSnapshot((prev) => {
        const games = nextGames ?? prev.games;
        // When the refetch returns a row whose finished_at is set AND it
        // matches the live question we were tracking, treat it as a resolve
        // event coming in via the HTTP fallback (postgres_changes can drop
        // for device-cookie sessions).
        let currentQuestion: QuestionRow | null = prev.currentQuestion;
        let lastResolvedQuestion: QuestionRow | null = prev.lastResolvedQuestion;
        if (nextQ) {
          if (nextQ.finished_at) {
            if (prev.currentQuestion?.id === nextQ.id) currentQuestion = null;
            lastResolvedQuestion = nextQ;
          } else {
            currentQuestion = nextQ;
            if (lastResolvedQuestion?.id !== nextQ.id) lastResolvedQuestion = null;
          }
        }
        return {
          ...prev,
          games,
          currentGame: pickCurrentGame(games),
          currentQuestion,
          lastResolvedQuestion,
        };
      });
    }

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
        lastResolved,
        recentReveals,
      ] = await Promise.all([
        supa
          .from("nights")
          .select("*, hosts!inner(default_theme_key)")
          .eq("id", nightId)
          .single(),
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
          .from("questions")
          .select("*, categories!inner(games!inner(night_id))")
          .eq("categories.games.night_id", nightId)
          .not("finished_at", "is", null)
          .order("finished_at", { ascending: false })
          .limit(1)
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
      const lastResolvedQuestion = sanitizeQuestionRow(
        lastResolved.data as (QuestionRow & { categories?: unknown }) | null,
      );
      const reveals = (recentReveals.data ?? []) as Array<
        RevealRow & { games?: unknown }
      >;
      const currentReveal = reveals[0]
        ? (stripJoin(reveals[0], "games") as RevealRow)
        : null;
      // The join on hosts returns `{ ..., hosts: { default_theme_key } }`
      // (object) or `{ ..., hosts: [{...}] }` (array) depending on relation
      // inference. Normalize then strip so RoomSnapshot.night stays a plain
      // NightRow.
      const nightWithHost = nightRow.data as
        | (NightRow & { hosts?: { default_theme_key?: string } | Array<{ default_theme_key?: string }> })
        | null;
      const hostJoin = nightWithHost
        ? Array.isArray(nightWithHost.hosts)
          ? nightWithHost.hosts[0]
          : nightWithHost.hosts
        : null;
      const hostDefaultThemeKey: string | null =
        hostJoin?.default_theme_key ?? null;
      const cleanNight: NightRow | null = nightWithHost
        ? (({ hosts: _hosts, ...rest }) => rest as NightRow)(nightWithHost)
        : null;
      setSnapshot({
        night: cleanNight,
        hostDefaultThemeKey,
        games,
        categories,
        players,
        currentGame: pickCurrentGame(games),
        currentQuestion,
        lastResolvedQuestion,
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
          // Realtime postgres_changes don't reliably reach phones (Realtime's
          // RLS evaluation differs from REST's — the x-tr1via-device header
          // isn't forwarded over WebSocket). Refresh the live state over
          // HTTP, where the browser client DOES attach the device header
          // and RLS sees the player. Updates the games table (state may
          // have flipped to "live") AND the live question (played_at stamp).
          void refreshLiveState(nightId, String(p.questionId));
        })
        .on("broadcast", { event: "undo" }, (msg) => {
          const p = msg.payload as Record<string, unknown>;
          mergeBroadcast({
            event: "undo",
            questionId: String(p.questionId),
            serverNow: String(p.serverNow),
          });
          // Re-sync after undo so the question state (played_at cleared)
          // propagates immediately to the player.
          void refreshLiveState(nightId, String(p.questionId));
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
          // Same fallback as reveal: pull current state over HTTP so the
          // finished_at stamp + any answer rows propagate even when
          // postgres_changes doesn't land. Flips the room state machine
          // into RevealView.
          void refreshLiveState(nightId, String(p.questionId));
        })
        .on("broadcast", { event: "end-early" }, (msg) => {
          const p = msg.payload as Record<string, unknown>;
          mergeBroadcast({
            event: "end-early",
            questionId: String(p.questionId),
            serverNow: String(p.serverNow),
          });
          // End-early = manual reveal of the answer. Pull the latest
          // question state so the reveal screen renders without delay.
          void refreshLiveState(nightId, String(p.questionId));
        })
        .on("broadcast", { event: "game-ended" }, () => {
          // Game state flipped to 'done' on the server. Refresh games rows
          // so the player state machine moves out of the live screen (and
          // into PlayerJoinGame2 for game 1, or the post-night flow for
          // game 2). Doesn't need a questionId — game-level wake-up.
          void refreshLiveState(nightId);
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
          let nextResolved = prev.lastResolvedQuestion;
          if (payload.eventType === "DELETE") {
            if (nextQ?.id === row.id) nextQ = null;
            if (nextResolved?.id === row.id) nextResolved = null;
          } else {
            const updated = payload.new as QuestionRow;
            const isLive = updated.played_at !== null && updated.finished_at === null;
            if (isLive) {
              nextQ = updated;
              // A new question going live supersedes any older reveal — clear
              // the reveal frame so the phone moves on to the new question.
              if (nextResolved?.id !== updated.id) nextResolved = null;
            } else if (nextQ?.id === updated.id) {
              // It's the live question that just resolved or got cleared.
              if (updated.finished_at) {
                nextResolved = updated;
                nextQ = null;
              } else {
                nextQ = updated;
              }
            } else if (updated.finished_at && nextResolved?.id === updated.id) {
              // Updates (e.g. fact_blurb backfill) on the already-resolved row.
              nextResolved = updated;
            }
          }
          return { ...prev, currentQuestion: nextQ, lastResolvedQuestion: nextResolved };
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
  }, [roomCode, waitingForDevice]);

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
