// Client wrapper for /host/setup/[nightId]. Renders HostGenOverview with
// live category data, owns the "Open the room" POST, and routes the host
// into the topic / pick screens when she taps a slot.

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HostGenOverview, type GameOverviewData, type CategorySlotData } from "@/components/host/gen";
import { PalettePeek } from "@/components/shared/PalettePeek";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import type { HostTopicSuggestion } from "@/lib/host/topicSuggestions";
import type { CategoryRow, GameRow } from "@/lib/supabase/types";

export interface HostSetupOverviewClientProps {
  nightId: string;
  venueName: string;
  games: GameRow[];
  categories: CategoryRow[];
  isOpen: boolean;
  /** Current theme_key on the night row. `null` means "no per-night
   *  override" — falls through to the host's default. */
  initialThemeKey: string | null;
  /** Host's preferred theme. Used when the night has no override. */
  hostDefaultThemeKey: string;
  /** Night-level cosmetic player reaction toggle. Default false for Classic. */
  initialRoomMagicEnabled: boolean;
  topSuggestions?: HostTopicSuggestion[];
}

const SLOTS_PER_GAME = 6;

export function HostSetupOverviewClient({
  nightId,
  venueName,
  games,
  categories: initialCategories,
  isOpen,
  initialThemeKey,
  hostDefaultThemeKey,
  initialRoomMagicEnabled,
  topSuggestions = [],
}: HostSetupOverviewClientProps) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local mirror of the categories so inline rename + delete can render
  // without a hard reload. Server-rendered initialCategories is the
  // first paint; every subsequent refresh re-fetches in the page server
  // component anyway.
  const [categories, setCategories] = useState(initialCategories);
  // Theme state starts at the resolved theme so first paint already matches
  // what the host expects. The picker pill writes to night.theme_key (the
  // per-night override) which then takes priority over host preference.
  const [themeKey, setThemeKey] = useState<ThemeKey>(
    resolveTheme(
      { theme_key: initialThemeKey },
      { default_theme_key: hostDefaultThemeKey },
    ),
  );
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [roomMagicEnabled, setRoomMagicEnabled] = useState(
    initialRoomMagicEnabled,
  );
  const [savingRoomMagic, setSavingRoomMagic] = useState(false);

  async function handlePickTheme(key: ThemeKey) {
    if (savingTheme || key === themeKey) {
      setThemeKey(key);
      setThemePickerOpen(false);
      return;
    }
    setSavingTheme(true);
    const previous = themeKey;
    setThemeKey(key);
    try {
      const res = await fetch(`/api/nights/${nightId}/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeKey: key }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setThemeKey(previous);
        setError(body.error ?? "Could not save theme.");
      } else {
        setThemePickerOpen(false);
      }
    } catch {
      setThemeKey(previous);
      setError("Could not save theme.");
    } finally {
      setSavingTheme(false);
    }
  }

  async function handleToggleRoomMagic(next: boolean) {
    if (savingRoomMagic || liveGameExists || next === roomMagicEnabled) return;
    const previous = roomMagicEnabled;
    setError(null);
    setSavingRoomMagic(true);
    setRoomMagicEnabled(next);
    try {
      const res = await fetch(`/api/nights/${nightId}/room-magic`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRoomMagicEnabled(previous);
        setError(body.error ?? "Could not save Room Magic.");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        roomMagicEnabled?: boolean;
      };
      if (typeof body.roomMagicEnabled === "boolean") {
        setRoomMagicEnabled(body.roomMagicEnabled);
      }
    } catch {
      setRoomMagicEnabled(previous);
      setError("Could not save Room Magic.");
    } finally {
      setSavingRoomMagic(false);
    }
  }

  const overview = useMemo<[GameOverviewData, GameOverviewData] | null>(() => {
    const g1 = games.find((g) => g.game_no === 1);
    const g2 = games.find((g) => g.game_no === 2);
    if (!g1 || !g2) return null;
    return [buildGameData(g1, categories, "GAME 1"), buildGameData(g2, categories, "GAME 2")];
  }, [games, categories]);

  // Disable the theme picker while any game is live — a mid-game flip
  // would break in-flight ceremonies. The server enforces this too (409),
  // but blocking it in the UI avoids a confusing error toast.
  const liveGameExists = games.some((g) => g.state === "live");

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

  function firstEmptySlot() {
    if (!overview) return null;
    for (const game of overview) {
      const idx = game.rows.findIndex((row) => row.status === "empty");
      if (idx >= 0) return { gameId: game.gameId, position: idx + 1 };
    }
    return null;
  }

  function handleAddTopic(gameId: string, position: number, topic?: string) {
    const params = new URLSearchParams({
      game: gameId,
      position: String(position),
    });
    if (topic?.trim()) params.set("topic", topic.trim());
    router.push(`/host/setup/${nightId}/topic?${params.toString()}`);
  }

  function handleUseSuggestion(topic: string) {
    const slot = firstEmptySlot();
    if (!slot) {
      setError("All topic slots are filled.");
      return;
    }
    handleAddTopic(slot.gameId, slot.position, topic);
  }

  function handleOpenSlot(categoryId: string) {
    router.push(`/host/setup/${nightId}/pick/${categoryId}`);
  }

  // Inline rename: optimistic — patch the local state immediately, roll
  // back on failure. The `CategorySlot` component bubbles up the saved
  // name promise; on rejection it surfaces the error in the inline input.
  async function handleRenameCategory(categoryId: string, next: string) {
    const previous = categories;
    setError(null);
    setCategories((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, name: next } : c)),
    );
    try {
      const res = await fetch(`/api/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setCategories(previous);
        throw new Error(body.error ?? "could not rename category");
      }
    } catch (err) {
      setCategories(previous);
      throw err;
    }
  }

  // Delete: optimistic — drop the row from local state immediately,
  // restore on failure. Cascade on the server takes care of any
  // generated questions + their plays/answers.
  async function handleDeleteCategory(categoryId: string) {
    const previous = categories;
    setError(null);
    setCategories((prev) => prev.filter((c) => c.id !== categoryId));
    try {
      const res = await fetch(`/api/categories/${categoryId}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setCategories(previous);
        throw new Error(body.error ?? "could not delete category");
      }
    } catch (err) {
      setCategories(previous);
      throw err;
    }
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
        themeKey={themeKey}
        shellTitle={`set up tonight · ${venueName.toLowerCase()}`}
        eyebrow={`TONIGHT · ${venueName.toUpperCase()}`}
        games={overview}
        readyIn="—"
        readyPct={pct}
        readyLabel={`${lockedCount} of 12 categories locked.`}
        onAddTopic={handleAddTopic}
        topSuggestions={topSuggestions}
        onOpenSlot={handleOpenSlot}
        onRenameCategory={handleRenameCategory}
        onDeleteCategory={handleDeleteCategory}
        onOpenRoom={handleOpenRoom}
        isReadyToOpen={isReadyToOpen}
        isOpening={opening}
      />
      <div
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 30,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
        }}
      >
        <div
          role="group"
          aria-label="Room Magic"
          style={{
            padding: 4,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,.12)",
            background: liveGameExists
              ? "rgba(20,19,15,.55)"
              : "rgba(20,19,15,.92)",
            color: liveGameExists ? "rgba(244,230,196,.35)" : "#F4E6C4",
            boxShadow: liveGameExists ? "none" : "0 12px 28px rgba(0,0,0,.45)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontFamily: "var(--font-sans)",
          }}
        >
          <span
            style={{
              padding: "0 9px 0 10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              lineHeight: "30px",
              whiteSpace: "nowrap",
            }}
          >
            Room Magic
          </span>
          <button
            type="button"
            onClick={() => void handleToggleRoomMagic(false)}
            aria-pressed={!roomMagicEnabled}
            disabled={liveGameExists || savingRoomMagic}
            style={roomMagicSegmentStyle(!roomMagicEnabled, liveGameExists)}
          >
            Off
          </button>
          <button
            type="button"
            onClick={() => void handleToggleRoomMagic(true)}
            aria-pressed={roomMagicEnabled}
            disabled={liveGameExists || savingRoomMagic}
            style={roomMagicSegmentStyle(roomMagicEnabled, liveGameExists)}
          >
            On
          </button>
        </div>
        {liveGameExists && (
          <div
            style={{
              fontSize: 11,
              color: "rgba(244,230,196,.55)",
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              textAlign: "right",
            }}
          >
            Themes lock during a live game. End the game first.
          </div>
        )}
        <button
          type="button"
          onClick={() => !liveGameExists && setThemePickerOpen(true)}
          aria-label={
            liveGameExists
              ? "Theme locked while a game is live"
              : "Pick the room's theme"
          }
          disabled={liveGameExists}
          style={{
            padding: "10px 16px",
            borderRadius: 99,
            border: "1px solid rgba(255,255,255,.12)",
            background: liveGameExists
              ? "rgba(20,19,15,.55)"
              : "rgba(20,19,15,.92)",
            color: liveGameExists ? "rgba(244,230,196,.35)" : "#F4E6C4",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            letterSpacing: "0.04em",
            cursor: liveGameExists ? "not-allowed" : "pointer",
            boxShadow: liveGameExists ? "none" : "0 12px 28px rgba(0,0,0,.45)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span aria-hidden="true">◐</span>
          Theme · {themeKey}
        </button>
      </div>
      <PalettePeek
        open={themePickerOpen}
        onClose={() => setThemePickerOpen(false)}
        activeThemeKey={themeKey}
        onPick={(k) => void handlePickTheme(k)}
        title="Pick the room's theme."
        footer={savingTheme ? "Saving…" : "Applies to the TV and every player phone in this room."}
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

function roomMagicSegmentStyle(active: boolean, disabled: boolean) {
  return {
    minWidth: 44,
    height: 30,
    padding: "0 12px",
    borderRadius: 999,
    border: "0",
    background: active
      ? disabled
        ? "rgba(244,230,196,.16)"
        : "#F4E6C4"
      : "transparent",
    color: active
      ? disabled
        ? "rgba(244,230,196,.46)"
        : "#0E0805"
      : disabled
        ? "rgba(244,230,196,.32)"
        : "rgba(244,230,196,.72)",
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0,
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
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
