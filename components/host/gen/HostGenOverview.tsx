// HOST · GENERATE · 1. OVERVIEW
// Linda has just opened the setup workspace. Two games tonight. Game 1 has
// 4 of 6 categories ready; Game 2 is still empty.
//
// Wired form: the setup route passes the two games + their categories
// (locked/review/idle/empty), a venue title, and handlers for adding a
// topic to a slot and opening the room. All props are optional with demo
// defaults so the /dev/host/gen gallery still renders.

"use client";

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
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
  /** Called when the host renames a category inline. Returns a promise so
   *  the slot can keep the input open + show a save error on rejection.
   *  When omitted the pencil affordance is hidden (gallery/preview mode). */
  onRenameCategory?: (categoryId: string, next: string) => Promise<void>;
  /** Called when the host confirms deleting a category. Returns a promise
   *  so the slot can show an error if the DELETE fails. */
  onDeleteCategory?: (categoryId: string) => Promise<void>;
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
  onRenameCategory,
  onDeleteCategory,
  onOpenRoom,
  isReadyToOpen = false,
  isOpening = false,
}: Omit<HostGenOverviewProps, "themeKey">) {
  const { t } = useTheme();
  return (
    <LaptopShell>
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
                      key={`${g.gameId}-${c.categoryId ?? `empty-${i}`}`}
                      c={c}
                      idx={i}
                      onAdd={() => onAddTopic?.(g.gameId, i + 1)}
                      onOpen={() => c.categoryId && onOpenSlot?.(c.categoryId)}
                      onRename={
                        c.categoryId && onRenameCategory
                          ? (next) => onRenameCategory(c.categoryId!, next)
                          : undefined
                      }
                      onDelete={
                        c.categoryId && onDeleteCategory
                          ? () => onDeleteCategory(c.categoryId!)
                          : undefined
                      }
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
  onRename,
  onDelete,
}: {
  c: CategorySlotData;
  idx: number;
  onAdd: () => void;
  onOpen: () => void;
  /** Save handler when the host edits the name inline. Returns a promise
   *  so we can surface a save error in-place. Omitted in gallery mode. */
  onRename?: (next: string) => Promise<void>;
  /** Delete handler. Triggers the confirm modal first; only fires after
   *  the host confirms. Omitted in gallery mode. */
  onDelete?: () => Promise<void>;
}) {
  const { t } = useTheme();
  const cc = c.name ? categoryColor(c.name, t.accent) : t.line;
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  // While editing or showing the confirm modal, the card itself stops
  // acting as the "open slot" button — clicks should target the input
  // or the modal, not navigate away.
  const cardClickable = !editing && !confirmDelete;
  return (
    <>
      <div
        role={cardClickable ? "button" : undefined}
        tabIndex={cardClickable ? 0 : -1}
        onClick={(e) => {
          // Don't navigate away if the click bubbled up from an inline
          // control (the edit pencil, the delete ×, or the input).
          const target = e.target as HTMLElement;
          if (target.closest("[data-slot-control='true']")) return;
          if (cardClickable) onOpen();
        }}
        onKeyDown={(e) => {
          if (!cardClickable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        style={{
          padding: "14px 16px",
          borderRadius: 12,
          background: isActive ? (t.dark ? `${cc}14` : `${cc}11`) : "transparent",
          border: `1.5px solid ${isActive ? cc : t.line}`,
          minHeight: 96,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          textAlign: "left",
          color: t.ink,
          font: "inherit",
          cursor: cardClickable ? "pointer" : "default",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: cc }} />
            <Eyebrow color={t.inkMid} size={9}>SLOT {idx + 1}</Eyebrow>
          </div>
          {onDelete && !editing && (
            <button
              type="button"
              data-slot-control="true"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              aria-label={`Delete the ${c.name || "category"} slot`}
              data-testid={`host-category-delete-btn-${c.categoryId ?? idx}`}
              title="Delete this category"
              style={{
                background: "transparent",
                border: "none",
                padding: 4,
                cursor: "pointer",
                color: t.inkMute,
                display: "flex",
                alignItems: "center",
                lineHeight: 0,
              }}
            >
              <TrashGlyph />
            </button>
          )}
        </div>
        <div>
          {editing && onRename ? (
            <CategoryNameInput
              initial={c.name}
              onCommit={async (next) => {
                await onRename(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: t.ink,
                  letterSpacing: "-0.005em",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </div>
              {onRename && (
                <button
                  type="button"
                  data-slot-control="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                  }}
                  aria-label={`Rename ${c.name}`}
                  data-testid={`host-category-rename-btn-${c.categoryId ?? idx}`}
                  title="Rename"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 2,
                    cursor: "pointer",
                    color: t.inkMid,
                    display: "flex",
                    alignItems: "center",
                    lineHeight: 0,
                  }}
                >
                  <PencilGlyph />
                </button>
              )}
            </div>
          )}
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
      </div>
      {confirmDelete && onDelete && (
        <DeleteCategoryConfirm
          name={c.name || "this category"}
          onConfirm={async () => {
            await onDelete();
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Inline name editor for a CategorySlot. Mirrors the pick screen's
// EditableTopicEyebrow but rendered as an input inside the slot rather
// than under an eyebrow. Enter saves, Escape discards, blur saves if
// changed. The handler returns a promise; we surface a tiny inline error
// when it rejects and keep the input open so the host can retry.
// ─────────────────────────────────────────────────────────────────────────

const RENAME_MAX_LENGTH = 80;

function CategoryNameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (next: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTheme();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function commit(): Promise<void> {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Name can't be blank.");
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > RENAME_MAX_LENGTH) {
      setError(`Keep it under ${RENAME_MAX_LENGTH} characters.`);
      inputRef.current?.focus();
      return;
    }
    if (trimmed === initial) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      await onCommit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  function onBlur(_e: FocusEvent<HTMLInputElement>): void {
    if (saving) return;
    if (draft.trim() !== initial && draft.trim().length > 0) {
      void commit();
    } else {
      onCancel();
    }
  }

  return (
    <div data-slot-control="true" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        disabled={saving}
        maxLength={RENAME_MAX_LENGTH}
        data-testid="host-category-overview-rename-input"
        aria-label="Category name"
        style={{
          background: t.surface,
          border: `1px solid ${error ? "#9c2f2f" : t.line}`,
          borderRadius: 6,
          padding: "4px 8px",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          fontWeight: 700,
          color: t.ink,
          letterSpacing: "-0.005em",
          width: "100%",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {error && (
        <div
          role="alert"
          style={{ marginTop: 4, fontSize: 10, color: "#9c2f2f", fontWeight: 500 }}
        >
          {error}
        </div>
      )}
      {saving && (
        <div
          style={{
            marginTop: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: t.inkMute,
            letterSpacing: "0.1em",
          }}
        >
          SAVING…
        </div>
      )}
    </div>
  );
}

function DeleteCategoryConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTheme();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-delete-category-title"
      data-testid="host-delete-category-confirm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "24px 26px 22px",
          background: t.paper,
          color: t.ink,
          borderRadius: 16,
          boxShadow: "0 40px 80px -20px rgba(0,0,0,.6)",
        }}
      >
        <div
          id="host-delete-category-title"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: t.ink,
            letterSpacing: "-0.01em",
          }}
        >
          Delete &lsquo;{name}&rsquo;?
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 14,
            color: t.inkMid,
            lineHeight: 1.45,
          }}
        >
          You&apos;ll lose any picked questions in this category. The other slots stay put.
        </div>
        {error && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              fontSize: 12,
              color: "#9c2f2f",
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            data-testid="host-delete-category-cancel"
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: `1px solid ${t.line}`,
              background: "transparent",
              color: t.inkMid,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={deleting}
            data-testid="host-delete-category-confirm-btn"
            onClick={async () => {
              setDeleting(true);
              setError(null);
              try {
                await onConfirm();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Couldn't delete.");
                setDeleting(false);
              }
            }}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "none",
              background: "#9c2f2f",
              color: "#FFF",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "var(--font-sans)",
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.7 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PencilGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
      <path d="M9.5 3.5l3 3" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11" />
      <path d="M6 4V2.5h4V4" />
      <path d="M4 4l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" />
      <path d="M6.5 7v5" />
      <path d="M9.5 7v5" />
    </svg>
  );
}
