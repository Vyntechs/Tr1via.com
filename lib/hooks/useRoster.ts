// Live roster of players in a night — subscribes to Postgres Changes on
// the `players` table filtered by night_id.
//
// Used by the lobby (player count + scrolling tile list), the TV
// (welcome strip), and the host's roster panel (with idle indicators).
//
// The hook seeds its state with an initial fetch on mount, then keeps it
// in sync via insert/update/delete events. Soft-removed players (where
// `removed_at` is set) are filtered out so the UI never has to do that
// itself. Sort is stable: ascending by joined_at, matching the in-DB
// insertion order.

"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { PlayerRow } from "@/lib/supabase/types";

export interface UseRosterResult {
  players: PlayerRow[];
  isLoading: boolean;
}

export function useRoster(nightId: string | null): UseRosterResult {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(nightId !== null);

  useEffect(() => {
    if (!nightId) {
      setPlayers([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    const supa = getSupabaseBrowser();
    // Initial fetch.
    void supa
      .from("players")
      .select("*")
      .eq("night_id", nightId)
      .is("removed_at", null)
      .order("joined_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setPlayers((data as PlayerRow[] | null) ?? []);
        setIsLoading(false);
      });

    // Live subscription. One channel per nightId; tear down on cleanup.
    const channel = supa
      .channel(`roster:${nightId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `night_id=eq.${nightId}`,
        },
        (payload) => {
          if (cancelled) return;
          // Realtime payload comes typed as { [k: string]: any } — narrow
          // through unknown to our ChangePayload shape.
          setPlayers((prev) =>
            applyPlayerChange(prev, payload as unknown as ChangePayload),
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
  }, [nightId]);

  return { players, isLoading };
}

interface ChangePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: PlayerRow | Record<string, never>;
  old: PlayerRow | Record<string, never>;
}

function applyPlayerChange(prev: PlayerRow[], payload: ChangePayload): PlayerRow[] {
  const type = payload.eventType;
  if (type === "INSERT") {
    const next = payload.new as PlayerRow;
    if (next.removed_at) return prev;
    if (prev.some((p) => p.id === next.id)) return prev;
    return sortByJoinedAt([...prev, next]);
  }
  if (type === "UPDATE") {
    const next = payload.new as PlayerRow;
    // Soft remove: drop from the list.
    if (next.removed_at) return prev.filter((p) => p.id !== next.id);
    const found = prev.some((p) => p.id === next.id);
    if (!found) return sortByJoinedAt([...prev, next]);
    return sortByJoinedAt(prev.map((p) => (p.id === next.id ? next : p)));
  }
  // DELETE
  const old = payload.old as PlayerRow;
  return prev.filter((p) => p.id !== old.id);
}

function sortByJoinedAt(list: PlayerRow[]): PlayerRow[] {
  return [...list].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
}
