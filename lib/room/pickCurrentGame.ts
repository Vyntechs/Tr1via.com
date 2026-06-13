// pickCurrentGame — which game a surface should treat as "current" right now.
//
// Shared by useRoom (direct-read path) and the server-route fallback mapper so
// both derive currentGame identically. Order: the live game; else the
// most-recently-ended done game; else the first ready game; else games[0];
// else null. Keeps the TV/host/player from going blank between hands.

import type { GameRow } from "@/lib/supabase/types";

export function pickCurrentGame(games: GameRow[]): GameRow | null {
  const live = games.find((g) => g.state === "live");
  if (live) return live;
  const done = [...games]
    .filter((g) => g.state === "done")
    .sort((a, b) => {
      const aT = a.ended_at ?? "";
      const bT = b.ended_at ?? "";
      return bT.localeCompare(aT);
    });
  if (done[0]) return done[0];
  const ready = games.find((g) => g.state === "ready");
  return ready ?? games[0] ?? null;
}
