// Client wrapper for /host/setup/[nightId]. Renders HostGenOverview with
// live category data, owns the "Open the room" POST, and routes the host
// into the topic / pick screens when she taps a slot.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HostGenOverview, type GameOverviewData, type CategorySlotData } from "@/components/host/gen";
import type { CategoryRow, GameRow } from "@/lib/supabase/types";

export interface HostSetupOverviewClientProps {
  nightId: string;
  venueName: string;
  games: GameRow[];
  categories: CategoryRow[];
  isOpen: boolean;
}

const SLOTS_PER_GAME = 6;

export function HostSetupOverviewClient({
  nightId,
  venueName,
  games,
  categories,
  isOpen,
}: HostSetupOverviewClientProps) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overview = useMemo<[GameOverviewData, GameOverviewData] | null>(() => {
    const g1 = games.find((g) => g.game_no === 1);
    const g2 = games.find((g) => g.game_no === 2);
    if (!g1 || !g2) return null;
    return [buildGameData(g1, categories, "GAME 1"), buildGameData(g2, categories, "GAME 2")];
  }, [games, categories]);

  const lockedCount = categories.filter((c) => c.state === "ready").length;
  // Host can open the room as soon as a single topic is locked anywhere.
  // The full 12-slot setup is still the canonical UX (visible in HostGenOverview),
  // but enforcing it as a hard gate blocked dev/demo flows where you want
  // a one-category dry run with real players before committing the night.
  const isReadyToOpen = overview !== null && lockedCount >= 1;
  const pct = Math.round((lockedCount / 12) * 100);

  async function handleOpenRoom() {
    if (isOpen) {
      router.push(`/host/live/${nightId}`);
      return;
    }
    setOpening(true);
    setError(null);
    try {
      const res = await fetch(`/api/nights/${nightId}/open`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not open the room");
      }
      router.push(`/host/live/${nightId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the room.");
      setOpening(false);
    }
  }

  function handleAddTopic(gameId: string, position: number) {
    const url = `/host/setup/${nightId}/topic?game=${encodeURIComponent(gameId)}&position=${position}`;
    router.push(url);
  }

  function handleOpenSlot(categoryId: string) {
    router.push(`/host/setup/${nightId}/pick/${categoryId}`);
  }

  if (!overview) {
    return (
      <div style={{ padding: 60, color: "#666", fontFamily: "var(--font-sans)" }}>
        This night doesn&apos;t have both games yet — check the database.
      </div>
    );
  }

  return (
    <>
      <HostGenOverview
        shellTitle={`set up tonight · ${venueName.toLowerCase()}`}
        eyebrow={`TONIGHT · ${venueName.toUpperCase()}`}
        games={overview}
        readyIn="—"
        readyPct={pct}
        readyLabel={`${lockedCount} of 12 categories locked.`}
        onAddTopic={handleAddTopic}
        onOpenSlot={handleOpenSlot}
        onOpenRoom={handleOpenRoom}
        isReadyToOpen={isReadyToOpen}
        isOpening={opening}
      />
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 50,
            padding: "12px 16px",
            borderRadius: 10,
            background: "rgba(156,47,47,.95)",
            color: "#FFF",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

function buildGameData(
  game: GameRow,
  categories: CategoryRow[],
  label: string,
): GameOverviewData {
  const cats = categories
    .filter((c) => c.game_id === game.id)
    .sort((a, b) => a.position - b.position);

  const rows: CategorySlotData[] = Array.from({ length: SLOTS_PER_GAME }, (_, i) => {
    const cat = cats.find((c) => c.position === i + 1);
    if (!cat) return { name: "", status: "empty" };
    const pickedCount = 0; // Filled in dynamically below if we had access.
    if (cat.state === "ready") {
      return { categoryId: cat.id, name: cat.name, status: "locked", picked: 7 };
    }
    if (cat.state === "review") {
      return {
        categoryId: cat.id,
        name: cat.name,
        status: "review",
        picked: pickedCount,
        generated: 20,
      };
    }
    if (cat.state === "generating") {
      return { categoryId: cat.id, name: cat.name, status: "generating" };
    }
    return { categoryId: cat.id, name: cat.name, status: "idle" };
  });

  return { gameId: game.id, label, rows };
}
