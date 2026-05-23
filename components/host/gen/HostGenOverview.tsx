// HOST · GENERATE · 1. OVERVIEW
// Linda has just opened the setup workspace. Two games tonight. Game 1 has
// 4 of 6 categories ready; Game 2 is still empty.
//
// Wired form: the setup route passes the two games + their categories
// (locked/review/idle/empty), a venue title, and handlers for adding a
// topic to a slot and opening the room. All props are optional with demo
// defaults so the /_dev/host/gen gallery still renders.

"use client";

import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface CategorySlotData {
  /** Persisted id when one exists ('empty' slots have no id). */
  categoryId?: string;
  name: string;
  status: "locked" | "review" | "idle" | "empty" | "generating";
  picked?: number;
  generated?: number;
  warn?: string;
}

export interface GameOverviewData {
  gameId: string;
  /** Display label rendered in the eyebrow (e.g. "GAME 1 · 7:00 PM"). */
  label: string;
  /** 6 slots (low → high). Padded with `status:'empty'` for un-filled. */
  rows: CategorySlotData[];
}

export interface HostGenOverviewProps {
  themeKey?: ThemeKey;
  /** LaptopShell title (e.g. "set up tonight · soul fire pizza"). */
  shellTitle?: string;
  /** Eyebrow over the headline (e.g. "TONIGHT · WED MAY 27"). */
  eyebrow?: string;
  /** Both games + their category slots. Demo defaults to game 1+2. */
  games?: [GameOverviewData, GameOverviewData];
  /** Top topic suggestions from players. */
  topSuggestions?: Array<{ name: string; count: number }>;
  /** Display estimate like "00:38" for the ready-in card. */
  readyIn?: string;
  /** Percentage 0..100 for the ready-in progress bar. */
  readyPct?: number;
  /** Counter line under the ready-in bar (e.g. "5 of 12 categories locked."). */
  readyLabel?: string;
  /** Called when the host taps an empty slot OR an idle slot to add a topic. */
  onAddTopic?: (gameId: string, position: number) => void;
  /** Called when the host taps a non-empty slot to continue working on it. */
  onOpenSlot?: (categoryId: string) => void;
  /** Called when the host taps "Open the room". Disabled until ready. */
  onOpenRoom?: () => void;
  /** True if Open the room is enabled (all 12 categories ready). */
  isReadyToOpen?: boolean;
  /** True while the open-room POST is in flight. */
  isOpening?: boolean;
}

export function HostGenOverview(props: HostGenOverviewProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenOverviewInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenOverviewInner {...rest} />;
}

const DEMO_GAMES: [GameOverviewData, GameOverviewData] = [
  {
    gameId: "demo-game-1",
    label: "GAME 1 · 7:00 PM",
    rows: [
      { name: "Geography",    status: "locked",  picked: 7 },
      { name: "Music",        status: "locked",  picked: 7 },
      { name: "Animals",      status: "locked",  picked: 7 },
      { name: "Pixar Movies", status: "review",  picked: 4, generated: 20 },
      { name: "Food",         status: "idle",    warn: "You ran this on May 14." },
      { name: "",             status: "empty" },
    ],
  },
  {
    gameId: "demo-game-2",
    label: "GAME 2 · 7:55 PM",
    rows: [
      { name: "History",      status: "locked",  picked: 7 },
      { name: "",             status: "empty" },
      { name: "",             status: "empty" },
      { name: "",             status: "empty" },
      { name: "",             status: "empty" },
      { name: "",             status: "empty" },
    ],
  },
];

const DEMO_SUGGESTIONS = [
  { name: "Disney Pixar movies", count: 8 },
  { name: "NFL teams", count: 6 },
  { name: "Madison local history", count: 4 },
  { name: "2000s pop songs", count: 3 },
];

function HostGenOverviewInner({
  shellTitle = "set up tonight · soul fire pizza",
  eyebrow = "TONIGHT · WED MAY 27",
  games = DEMO_GAMES,
  topSuggestions = DEMO_SUGGESTIONS,
  readyIn = "00:38",
  readyPct = 47,
  readyLabel = "5 of 12 categories locked.",
  onAddTopic,
  onOpenSlot,
  onOpenRoom,
  isReadyToOpen = false,
  isOpening = false,
}: Omit<HostGenOverviewProps, "themeKey">) {
  const { t } = useTheme();
  return (
    <LaptopShell title={shellTitle}>
      <div style={{ padding: "32px 56px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 36, flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Eyebrow color={t.accent} size={11}>{eyebrow}</Eyebrow>
          <Display size={48} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            Two games. Twelve topics.
          </Display>
          <div style={{ marginTop: 8, color: t.inkMid, fontSize: 14.5, lineHeight: 1.45, maxWidth: 600 }}>
            Type a topic. We pull 20 fresh questions; you pick the seven for the board. Difficulty sorts itself.
          </div>

          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 24, overflow: "auto", paddingRight: 8 }}>
            {games.map((g) => (
              <div key={g.gameId}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                  <Eyebrow color={t.inkMid} size={10}>{g.label}</Eyebrow>
                  <span style={{ fontSize: 12, color: t.inkMute }}>
                    {g.rows.filter((r) => r.status === "locked").length} of 6 ready
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {g.rows.map((c, i) => (
                    <CategorySlot
                      key={`${g.gameId}-${i}`}
                      c={c}
                      idx={i}
                      onAdd={() => onAddTopic?.(g.gameId, i + 1)}
                      onOpen={() => c.categoryId && onOpenSlot?.(c.categoryId)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: "22px 24px", borderRadius: 16, background: t.accent, color: "#0E0805" }}>
            <Eyebrow color="rgba(14,8,5,.7)" size={10}>READY IN</Eyebrow>
            <Numeric size={56} weight={700} color="#0E0805" tracking={-0.04} style={{ display: "block", marginTop: 4, lineHeight: 1 }}>{readyIn}</Numeric>
            <div style={{ marginTop: 12, height: 4, borderRadius: 99, background: "rgba(14,8,5,.2)", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, readyPct))}%`, height: "100%", background: "#0E0805" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(14,8,5,.7)" }}>{readyLabel}</div>
          </div>

          <div style={{ padding: "16px 18px", borderRadius: 14, border: `1px solid ${t.line}` }}>
            <Eyebrow color={t.inkMute} size={10}>OPTIONAL · LET THE ROOM PICK</Eyebrow>
            <div style={{ marginTop: 8, fontSize: 14, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em" }}>Open audience vote</div>
            <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid, lineHeight: 1.45 }}>~2 min. Majority wins. Players pick tonight&apos;s topics from their phones.</div>
          </div>

          <div style={{ padding: "16px 18px", borderRadius: 14, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>SUGGESTED BY THE ROOM</Eyebrow>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {topSuggestions.length === 0 ? (
                <div style={{ fontSize: 12, color: t.inkMute }}>No suggestions yet.</div>
              ) : (
                topSuggestions.map((s) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: t.ink, fontWeight: 500 }}>{s.name}</span>
                    <Numeric size={12} color={t.inkMid}>{s.count}</Numeric>
                  </div>
                ))
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenRoom}
            disabled={!isReadyToOpen || isOpening}
            style={{
              marginTop: "auto",
              background: isReadyToOpen ? t.accent : t.surface,
              color: isReadyToOpen ? (t.dark ? "#0E0E0C" : "#FFF") : t.inkMute,
              border: "none",
              borderRadius: 14,
              padding: "16px 0",
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "var(--font-sans)",
              cursor: isReadyToOpen && !isOpening ? "pointer" : "not-allowed",
              opacity: isOpening ? 0.7 : 1,
              boxShadow: isReadyToOpen ? `0 12px 22px -10px ${t.accent}77` : "none",
              letterSpacing: "-0.005em",
            }}
          >
            {isOpening
              ? "Opening the room…"
              : isReadyToOpen
                ? "Open the room  →"
                : "Open the room · finish setup first"}
          </button>
        </div>
      </div>
    </LaptopShell>
  );
}

function CategorySlot({
  c,
  idx,
  onAdd,
  onOpen,
}: {
  c: CategorySlotData;
  idx: number;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const { t } = useTheme();
  const cc = c.name ? categoryColor(c.name, t.accent) : t.line;
  if (c.status === "empty") {
    return (
      <button
        type="button"
        onClick={onAdd}
        style={{
          padding: "14px 16px", borderRadius: 12,
          border: `1px dashed ${t.line}`, background: "transparent",
          cursor: "pointer", minHeight: 96, width: "100%",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          textAlign: "left", color: t.ink, font: "inherit",
        }}
      >
        <Eyebrow color={t.inkMute} size={9}>SLOT {idx + 1}</Eyebrow>
        <div style={{ fontSize: 14, color: t.inkMute, fontWeight: 500 }}>+  add a topic</div>
      </button>
    );
  }
  const statusLabel =
    c.status === "locked"
      ? `${c.picked} picked`
      : c.status === "review"
        ? `pick 7 of ${c.generated}`
        : c.status === "generating"
          ? "generating…"
          : "not started";
  const statusColor =
    c.status === "locked"
      ? t.correct
      : c.status === "review"
        ? t.accent
        : c.status === "generating"
          ? t.accent
          : t.inkMute;
  const isActive = c.status === "review" || c.status === "generating";
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        padding: "14px 16px", borderRadius: 12,
        background: isActive ? (t.dark ? `${cc}14` : `${cc}11`) : "transparent",
        border: `1.5px solid ${isActive ? cc : t.line}`,
        minHeight: 96, width: "100%",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        textAlign: "left", color: t.ink, font: "inherit",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: cc }} />
        <Eyebrow color={t.inkMid} size={9}>SLOT {idx + 1}</Eyebrow>
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.ink, letterSpacing: "-0.005em" }}>{c.name}</div>
        {c.warn && <div style={{ marginTop: 4, fontSize: 11, color: t.wrong }}>{c.warn}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: statusColor, fontWeight: 600, letterSpacing: "0.06em" }}>{statusLabel.toUpperCase()}</span>
        {c.status !== "locked" && (
          <span style={{ fontSize: 11, color: t.inkMid, fontWeight: 600 }}>
            {c.status === "review" ? "continue →" : c.status === "generating" ? "open →" : "generate →"}
          </span>
        )}
      </div>
    </button>
  );
}
