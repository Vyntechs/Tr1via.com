// HOST · GENERATE · 4. PICK
// The host has 20 candidate questions; she picks 7 to lock as the column.
// The side panel renders the board she's building — point slots 100→700
// light as she picks. Flavor + Difficulty buttons re-generate or steer the
// next batch.
//
// Wired form: the pick route passes the live candidates + selected-id set,
// the topic, and an `onTogglePick` / `onLock` / `onEdit` / `onSwapImage`
// / `onUpload` / `onRegenerate` set of handlers. All props are optional
// with demo defaults so the /dev/host/gen gallery still renders.

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { computeReorderAssignments } from "@/lib/host/boardReorder";
import { DifficultyBar, StockImage } from "./_shared";

export type DifficultyTarget = "easy" | "normal" | "hard";

export interface HostGenPickQuestion {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  difficulty: number;
  /** Host-placed slot on the board (set via the Edit panel's POINT
   *  VALUE picker). When present, supersedes the Claude-difficulty
   *  derivation in YOUR BOARD. Mirrors `questions.point_value`. */
  pointValue?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  /** True if the host edited any field on this question. */
  edited?: boolean;
  /** Optional flavor tag for the badge ("OBSCURE", "POP", "LOCAL"). */
  flavorTag?: string | null;
  /** Pexels / upload image URL. Null shows the placeholder seed. */
  imageUrl?: string | null;
  /** Demo-only seed for the placeholder image when imageUrl is missing. */
  seed?: string;
}

export interface HostGenPickProps {
  themeKey?: ThemeKey;
  /** LaptopShell title (e.g. "pick 7 · pixar movies"). */
  shellTitle?: string;
  /** Topic / category name used in the headline + category color. */
  topic?: string;
  /** All 20 candidates returned by the generator. */
  questions?: HostGenPickQuestion[];
  /** The ids the host has currently selected. */
  pickedIds?: Set<string>;
  /** Active difficulty target (drives the regenerate button group). */
  difficulty?: DifficultyTarget;
  /** Selected flavor tags. */
  flavor?: string[];
  /** Called when the host toggles a candidate's pick state. */
  onTogglePick?: (questionId: string) => void;
  /** Open the edit panel for a specific question. Also wired to the edit
   *  affordance on each YOUR BOARD sidebar card (same modal, different
   *  entry point). */
  onEdit?: (questionId: string) => void;
  /** Open the image swap UI for a specific question. */
  onSwapImage?: (questionId: string) => void;
  /** Persist a drag-to-reorder of the YOUR BOARD sidebar. Receives the new
   *  {id, pointValue} assignment for every filled slot, in top→bottom order.
   *  When omitted (e.g. the /dev gallery) the board renders static — no drag
   *  handles. */
  onReorder?: (assignments: Array<{ id: string; pointValue: number }>) => void;
  /** Called when the host saves a renamed category label. Returns a
   *  promise so the inline editor can keep the input open + restore
   *  focus on failure. When omitted the pencil affordance is hidden
   *  (so the design gallery keeps rendering as a static preview). */
  onRename?: (next: string) => Promise<void>;
  /** True while the rename PATCH is in flight. Disables the input and
   *  shows a "Saving…" microcopy. */
  isRenaming?: boolean;
  /** Called when the host taps "Lock the category" with 7 picked. */
  onLock?: () => void;
  /** Called when the host taps "Another 20" / a flavor button. */
  onRegenerate?: (input: {
    difficulty: DifficultyTarget;
    flavor: string[];
  }) => void;
  /** Called when the host taps "← back" to return to the setup overview.
   *  Optional so the /dev/host/gen gallery keeps rendering. */
  onBack?: () => void;
  /** True while the lock-the-category POST is in flight. */
  isLocking?: boolean;
  /** True while a regenerate ("↻ Another 20") is in flight. Disables
   *  Lock + the flavor buttons and shows a small "generating 20 more…"
   *  banner so the host knows new candidates are inbound. */
  isRegenerating?: boolean;
}

const FLAVOR_OPTIONS = [
  "Sharper",
  "More obscure",
  "More pop",
  "More local",
  "Fresher",
] as const;

const DEMO_QUESTIONS: HostGenPickQuestion[] = [
  { id: "1", seed: "pixar1", prompt: "What was Pixar's first feature film?", options: ["Toy Story", "A Bug's Life", "Monsters, Inc.", "Finding Nemo"], correctIndex: 0, difficulty: 1 },
  { id: "2", seed: "pixar2", prompt: "In Up, what is the name of Carl's dog?", options: ["Dug", "Buddy", "Russell", "Charles"], correctIndex: 0, difficulty: 2 },
  { id: "3", seed: "pixar3", prompt: "Which year did Toy Story open in theaters?", options: ["1993", "1995", "1997", "2000"], correctIndex: 1, difficulty: 3 },
  { id: "4", seed: "pixar4", prompt: "Wall·E's love interest is named what?", options: ["EVE", "AVA", "M-O", "BURN-E"], correctIndex: 0, difficulty: 4, edited: true, pointValue: 700 }, // host-placed for design preview
  { id: "5", seed: "pixar5", prompt: "Inside Out's five emotions include joy, sadness, anger, fear, and what?", options: ["Disgust", "Surprise", "Envy", "Pride"], correctIndex: 0, difficulty: 4 },
  { id: "6", seed: "pixar6", prompt: "Ratatouille is set in which city?", options: ["Paris", "Lyon", "Marseille", "Nice"], correctIndex: 0, difficulty: 2 },
  { id: "7", seed: "pixar7", prompt: "In Monsters, Inc., what does CDA stand for?", options: ["Child Detection Agency", "City Defense Authority", "Closet Discovery Alliance", "Citizen Disposal Act"], correctIndex: 0, difficulty: 6, flavorTag: "OBSCURE" },
  { id: "8", seed: "pixar8", prompt: "In Coco, who is the boy's great-great-grandfather?", options: ["Ernesto de la Cruz", "Héctor Rivera", "Imelda Rivera", "Pepita"], correctIndex: 1, difficulty: 5, flavorTag: "OBSCURE" },
  { id: "9", seed: "pixar9", prompt: "The Incredibles' family surname is what?", options: ["Parr", "Heller", "Bonn", "Cole"], correctIndex: 0, difficulty: 2 },
  { id: "10", seed: "pixar10", prompt: "Which Pixar character is voiced by Ellen DeGeneres?", options: ["Dory", "Eve", "Ellie", "Bonnie"], correctIndex: 0, difficulty: 1 },
];

export function HostGenPick(props: HostGenPickProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenPickInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenPickInner {...rest} />;
}

function HostGenPickInner({
  shellTitle = "pick 7 · pixar movies",
  topic = "Pixar Movies",
  questions = DEMO_QUESTIONS,
  pickedIds,
  difficulty = "normal",
  flavor = [],
  onTogglePick,
  onEdit,
  onSwapImage,
  onReorder,
  onRename,
  isRenaming = false,
  onLock,
  onRegenerate,
  onBack,
  isLocking = false,
  isRegenerating = false,
}: Omit<HostGenPickProps, "themeKey">) {
  const { t } = useTheme();
  const cc = categoryColor(topic, t.accent);
  const picked = pickedIds ?? new Set(["1", "2", "3", "4", "7", "8"]);
  const pickedQs = questions.filter((q) => picked.has(q.id));
  // Mirror the server's lock-time assignment so the host sees the actual
  // tier each pick will land at. Two-pass:
  //   1. Explicit host-set point_values claim their slots directly
  //      (matches the Edit panel's "PLACED" state — these are what the
  //      Lock endpoint will honor via assignPointValues).
  //   2. Remaining picks fill the open slots by Claude-rated difficulty
  //      ascending — stable, same rule as the original algorithm.
  // At 7 picks this matches the server result exactly.
  const tierByPickId = useMemo(() => {
    const map = new Map<string, number>();
    const takenSlots = new Set<number>();
    for (const q of pickedQs) {
      if (q.pointValue !== undefined && q.pointValue !== null) {
        map.set(q.id, q.pointValue);
        takenSlots.add(q.pointValue);
      }
    }
    const openSlots = [100, 200, 300, 400, 500, 600, 700].filter(
      (v) => !takenSlots.has(v),
    );
    const unplaced = pickedQs
      .filter((q) => q.pointValue === undefined || q.pointValue === null)
      .sort((a, b) => a.difficulty - b.difficulty);
    for (let i = 0; i < unplaced.length && i < openSlots.length; i++) {
      map.set(unplaced[i]!.id, openSlots[i] as number);
    }
    return map;
  }, [pickedQs]);
  return (
    <LaptopShell>
      <div style={{ padding: "20px 56px 14px", borderBottom: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to setup"
              data-testid="host-pick-back-btn"
              style={{
                padding: "6px 12px",
                borderRadius: 99,
                border: `1px solid ${t.line}`,
                background: "transparent",
                color: t.inkMid,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span aria-hidden="true">←</span> Back
            </button>
          )}
          <span style={{ width: 12, height: 12, borderRadius: 99, background: cc }} />
          <div>
            <EditableTopicEyebrow
              value={topic}
              suffix={`· ${questions.length} PULLED · PHOTOS MATCHED`}
              onSave={onRename}
              isSaving={isRenaming}
            />
            <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700, color: t.ink, letterSpacing: "-0.02em" }}>Pick your seven.</div>
            {isRegenerating && (
              <div
                role="status"
                aria-live="polite"
                data-testid="host-pick-regenerating-banner"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: t.accent,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: t.accent,
                    animation: "tr1via-pulse 1.2s ease-in-out infinite",
                  }}
                />
                Generating 20 more — your picks stay safe.
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Eyebrow color={t.inkMute} size={10}>FLAVOR</Eyebrow>
          {(["easy", "normal", "hard"] as const).map((d) => {
            const active = d === difficulty;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onRegenerate?.({ difficulty: d, flavor })}
                disabled={isRegenerating}
                style={{
                  padding: "7px 14px", borderRadius: 99,
                  border: `1px solid ${active ? t.ink : t.line}`,
                  background: active ? t.ink : "transparent",
                  color: active ? t.paper : t.ink,
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                  cursor: isRegenerating ? "not-allowed" : "pointer",
                  opacity: isRegenerating ? 0.55 : 1,
                  textTransform: "capitalize",
                }}
              >
                {d}
              </button>
            );
          })}
          <span style={{ width: 1, height: 16, background: t.line, margin: "0 4px" }} />
          {FLAVOR_OPTIONS.map((s) => {
            const active = flavor.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const next = active ? flavor.filter((f) => f !== s) : [...flavor, s];
                  onRegenerate?.({ difficulty, flavor: next });
                }}
                disabled={isRegenerating}
                style={{
                  padding: "7px 12px", borderRadius: 99, border: `1px solid ${active ? t.ink : t.line}`,
                  background: active ? t.ink : "transparent",
                  color: active ? t.paper : t.inkMid,
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                  cursor: isRegenerating ? "not-allowed" : "pointer",
                  opacity: isRegenerating ? 0.55 : 1,
                }}
              >
                {s}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onRegenerate?.({ difficulty, flavor })}
            disabled={isRegenerating}
            style={{
              padding: "7px 14px",
              borderRadius: 99,
              border: `1px solid ${t.line}`,
              background: "transparent",
              color: t.ink,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              cursor: isRegenerating ? "not-allowed" : "pointer",
              opacity: isRegenerating ? 0.55 : 1,
            }}
          >
            {isRegenerating ? "Generating…" : "↻ Another 20"}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 300px", overflow: "hidden" }}>
        <div style={{ overflow: "auto", padding: "20px 36px 32px 56px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                q={q}
                cc={cc}
                isPicked={picked.has(q.id)}
                assignedPointValue={tierByPickId.get(q.id)}
                onTogglePick={() => onTogglePick?.(q.id)}
                onEdit={() => onEdit?.(q.id)}
                onSwapImage={() => onSwapImage?.(q.id)}
              />
            ))}
          </div>
          <div style={{ marginTop: 18, padding: "12px 16px", borderRadius: 10, background: t.surface, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 4, height: 28, background: t.pop, borderRadius: 99 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: t.ink, fontWeight: 600 }}>Each photo was picked to match its question.</div>
              <div style={{ marginTop: 2, fontSize: 11, color: t.inkMid }}>From your free stock library. Click <em style={{ fontStyle: "normal", fontWeight: 600 }}>Image</em> on any card to swap.</div>
            </div>
          </div>
        </div>

        <PickSidebar
          cc={cc}
          picked={pickedQs}
          tierByPickId={tierByPickId}
          onUnpick={onTogglePick}
          onEdit={onEdit}
          onReorder={onReorder}
          onLock={onLock}
          isLocking={isLocking}
        />
      </div>
    </LaptopShell>
  );
}

function QuestionCard({
  q,
  cc,
  isPicked,
  assignedPointValue,
  onTogglePick,
  onEdit,
  onSwapImage,
}: {
  q: HostGenPickQuestion;
  cc: string;
  isPicked: boolean;
  /** Tier the question will lock at, if currently picked. Undefined for unpicked. */
  assignedPointValue: number | undefined;
  onTogglePick: () => void;
  onEdit: () => void;
  onSwapImage: () => void;
}) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 14, overflow: "hidden",
      border: `1.5px solid ${isPicked ? cc : t.line}`,
      background: isPicked ? (t.dark ? `${cc}10` : `${cc}08`) : (t.dark ? "rgba(244,230,196,.03)" : "#FFF"),
      display: "flex", flexDirection: "column",
      position: "relative",
      animation: "tr1via-rise .35s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <StockImage src={q.imageUrl ?? null} seed={q.seed ?? q.id} height={140} radius="13px 13px 0 0">
        <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
          {q.edited && <span style={{ padding: "2px 7px", borderRadius: 99, background: "rgba(0,0,0,.55)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, color: "#FFF", letterSpacing: "0.08em" }}>EDITED</span>}
          {q.flavorTag && <span style={{ padding: "2px 7px", borderRadius: 99, background: "rgba(0,0,0,.55)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, color: "#FFF", letterSpacing: "0.08em" }}>{q.flavorTag}</span>}
        </div>
        <button
          type="button"
          onClick={onTogglePick}
          aria-label={isPicked ? "Unpick question" : "Pick question"}
          style={{
            position: "absolute", top: 10, left: 10,
            width: 26, height: 26, borderRadius: 99,
            background: isPicked ? cc : "rgba(0,0,0,.5)",
            border: isPicked ? "none" : "1.5px solid rgba(255,255,255,.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {isPicked && <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="#0E0805" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
      </StockImage>

      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35 }}>{q.prompt}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {q.options.map((o, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 8px", borderRadius: 6,
              background: i === q.correctIndex ? (t.dark ? `${t.correct}18` : `${t.correct}12`) : "transparent",
            }}>
              <Numeric size={11} color={i === q.correctIndex ? t.correct : t.inkMute} weight={700} style={{ minWidth: 12 }}>{i + 1}</Numeric>
              <span style={{ fontSize: 12, color: i === q.correctIndex ? t.correct : t.inkMid, fontWeight: i === q.correctIndex ? 600 : 500, flex: 1 }}>{o}</span>
              {i === q.correctIndex && <Eyebrow color={t.correct} size={8}>✓</Eyebrow>}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DifficultyBar value={q.difficulty} color={cc} />
            {(() => {
              const inherent = q.difficulty * 100;
              const displayed = isPicked && assignedPointValue !== undefined
                ? assignedPointValue
                : inherent;
              const shifted = isPicked && assignedPointValue !== undefined && assignedPointValue !== inherent;
              return (
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  {shifted && (
                    <Numeric size={10} color={t.inkMute} weight={500} style={{ textDecoration: "line-through" }}>
                      {inherent}
                    </Numeric>
                  )}
                  <Numeric size={12} color={cc} weight={700}>{displayed}</Numeric>
                </div>
              );
            })()}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={onEdit}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onSwapImage}
              style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              Image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PickSidebar({
  cc,
  picked,
  tierByPickId,
  onUnpick,
  onEdit,
  onReorder,
  onLock,
  isLocking,
}: {
  cc: string;
  picked: HostGenPickQuestion[];
  tierByPickId: Map<string, number>;
  /** Unpick a question directly from the board (Heather's request: she
   *  doesn't want to scroll the 20-card grid to find + unclick). When
   *  omitted, the × button is hidden. */
  onUnpick?: (questionId: string) => void;
  /** Open the edit modal for a board card — same modal as the left grid's
   *  Edit button, different entry point. When omitted, the pencil is hidden. */
  onEdit?: (questionId: string) => void;
  /** Persist a drag-to-reorder. When omitted (or <2 filled slots) the board
   *  renders static — no drag handles. */
  onReorder?: (assignments: Array<{ id: string; pointValue: number }>) => void;
  onLock?: () => void;
  isLocking: boolean;
}) {
  const { t } = useTheme();
  const slots = [100, 200, 300, 400, 500, 600, 700];
  // Key by the preview-assigned tier — not raw difficulty*100 — so picks
  // with the same Claude rating no longer overwrite each other. Matches
  // exactly what the server stores on lock.
  const byTier: Record<number, HostGenPickQuestion | undefined> = {};
  picked.forEach((p) => {
    const tier = tierByPickId.get(p.id);
    if (tier !== undefined) byTier[tier] = p;
  });

  // Filled slots in ascending point-value order. This is both the render
  // order (top→bottom) and the sortable list. `occupiedValues` stays pinned
  // to slot positions; reordering only changes which card sits in each.
  const filledSlots = slots.filter((v) => byTier[v]);
  const orderedIds = filledSlots.map((v) => byTier[v]!.id);
  const occupiedValues = filledSlots.slice();
  // Drag is only meaningful with ≥2 filled cards AND a persistence handler.
  const dndEnabled = !!onReorder && orderedIds.length >= 2;

  // Hooks must run unconditionally — sensors are cheap even when DnD is off.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const assignments = computeReorderAssignments(
      orderedIds,
      occupiedValues,
      String(active.id),
      String(over.id),
    );
    if (assignments) onReorder?.(assignments);
  }

  const ready = picked.length === 7;

  const rows = slots.map((v) => {
    const filled = byTier[v];
    if (!filled) {
      return <EmptyBoardSlotRow key={v} slot={v} reserveGrip={dndEnabled} />;
    }
    const common = {
      slot: v,
      q: filled,
      cc,
      onEdit,
      onUnpick,
    };
    return dndEnabled ? (
      <SortableBoardSlotRow key={filled.id} {...common} />
    ) : (
      <StaticBoardSlotRow key={filled.id} {...common} />
    );
  });

  return (
    <div style={{ borderLeft: `1px solid ${t.line}`, padding: "20px 24px 24px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <Eyebrow color={t.inkMid} size={10}>YOUR BOARD</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <Numeric size={24} weight={700} color={cc}>{picked.length}</Numeric>
          <span style={{ fontSize: 13, color: t.inkMute }}>/ 7</span>
        </div>
      </div>

      <div
        data-testid="pick-sidebar-board"
        style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6, flex: 1, overflow: "auto" }}
      >
        {dndEnabled ? (
          <DndContext id="pick-board-reorder" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
              {rows}
            </SortableContext>
          </DndContext>
        ) : (
          rows
        )}
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          type="button"
          onClick={onLock}
          disabled={!ready || isLocking}
          style={{
            background: ready ? t.accent : t.surface,
            color: ready ? "#FFF" : t.inkMute,
            border: "none", borderRadius: 12,
            padding: "14px 0", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-sans)",
            cursor: ready && !isLocking ? "pointer" : "not-allowed",
            opacity: isLocking ? 0.7 : 1,
            boxShadow: ready ? `0 10px 22px -10px ${t.accent}77` : "none",
          }}
        >
          {isLocking ? "Locking…" : ready ? "Lock the category  →" : `Pick ${7 - picked.length} more to lock`}
        </button>
        <Eyebrow color={t.inkMute} size={9} style={{ textAlign: "center" }}>
          {dndEnabled ? "DRAG TO REORDER · EDIT FROM ANY CARD" : "YOU CAN STILL EDIT AFTER LOCKING"}
        </Eyebrow>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Board slot rows — the YOUR BOARD sidebar cards.
//
// A filled slot can be reordered (drag the grip handle) and edited (the
// pencil opens the same modal the left grid's Edit button does). Drag
// listeners live ONLY on the grip so clicking the pencil / × never starts a
// drag. Sortable + static variants share BoardSlotContent so the markup can't
// drift between them; the empty-slot row reserves the grip column so filled
// and empty rows stay column-aligned while dragging is enabled.
// ─────────────────────────────────────────────────────────────────────────

const SLOT_GRIP_COL = "18px";
const SLOT_VALUE_COL = "44px";

function BoardSlotContent({
  slot,
  q,
  cc,
  grip,
  onEdit,
  onUnpick,
}: {
  slot: number;
  q: HostGenPickQuestion;
  cc: string;
  /** The drag handle element, or null when DnD is off (no grip column). */
  grip: React.ReactNode | null;
  onEdit?: (questionId: string) => void;
  onUnpick?: (questionId: string) => void;
}) {
  const { t } = useTheme();
  const cols = [
    grip !== null ? SLOT_GRIP_COL : null,
    SLOT_VALUE_COL,
    "1fr",
    onEdit || onUnpick ? "auto" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols,
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: t.dark ? `${cc}10` : `${cc}06`,
        border: `1px solid ${cc}`,
      }}
    >
      {grip !== null && grip}
      <Numeric size={18} color={cc} weight={700}>{slot}</Numeric>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: t.ink, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{q.prompt}</div>
        <div style={{ marginTop: 2, fontSize: 10, color: t.inkMute, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{q.options[q.correctIndex]}</div>
      </div>
      {(onEdit || onUnpick) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(q.id)}
              aria-label={`Edit the ${slot}-point question`}
              title="Edit this question"
              data-testid={`pick-sidebar-edit-${slot}`}
              style={slotIconButtonStyle(t.line, t.inkMid)}
            >
              <PencilGlyph />
            </button>
          )}
          {onUnpick && (
            <button
              type="button"
              onClick={() => onUnpick(q.id)}
              aria-label={`Remove from slot ${slot}`}
              title={`Remove (slot ${slot} opens up)`}
              data-testid={`pick-sidebar-unpick-${slot}`}
              style={{ ...slotIconButtonStyle(t.line, t.inkMid), fontSize: 14, fontWeight: 600, fontFamily: "var(--font-sans)" }}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StaticBoardSlotRow(props: {
  slot: number;
  q: HostGenPickQuestion;
  cc: string;
  onEdit?: (questionId: string) => void;
  onUnpick?: (questionId: string) => void;
}) {
  return <BoardSlotContent {...props} grip={null} />;
}

function SortableBoardSlotRow({
  slot,
  q,
  cc,
  onEdit,
  onUnpick,
}: {
  slot: number;
  q: HostGenPickQuestion;
  cc: string;
  onEdit?: (questionId: string) => void;
  onUnpick?: (questionId: string) => void;
}) {
  const { t } = useTheme();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: q.id });

  const grip = (
    <button
      type="button"
      aria-label={`Drag to reorder the ${slot}-point question`}
      title="Drag to reorder"
      data-testid={`pick-sidebar-drag-${slot}`}
      {...attributes}
      {...listeners}
      style={{
        width: 18,
        height: 24,
        border: "none",
        background: "transparent",
        color: t.inkMute,
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        touchAction: "none",
      }}
    >
      <GripGlyph />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        position: "relative",
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      <BoardSlotContent
        slot={slot}
        q={q}
        cc={cc}
        grip={grip}
        onEdit={onEdit}
        onUnpick={onUnpick}
      />
    </div>
  );
}

function EmptyBoardSlotRow({
  slot,
  reserveGrip,
}: {
  slot: number;
  /** Render an empty grip-width gutter so columns line up with filled rows
   *  while dragging is enabled. */
  reserveGrip: boolean;
}) {
  const { t } = useTheme();
  const cols = [reserveGrip ? SLOT_GRIP_COL : null, SLOT_VALUE_COL, "1fr"]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols,
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: "transparent",
        border: `1px dashed ${t.line}`,
      }}
    >
      {reserveGrip && <span aria-hidden="true" />}
      <Numeric size={18} color={t.inkMute} weight={700}>{slot}</Numeric>
      <span style={{ fontSize: 12, color: t.inkMute, fontWeight: 500 }}>open · pick a {slot === 100 ? "easy" : slot === 700 ? "hard" : ""} one</span>
    </div>
  );
}

function slotIconButtonStyle(border: string, color: string): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 99,
    border: `1px solid ${border}`,
    background: "transparent",
    color,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  };
}

function GripGlyph() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.3" />
      <circle cx="7.5" cy="3" r="1.3" />
      <circle cx="2.5" cy="8" r="1.3" />
      <circle cx="7.5" cy="8" r="1.3" />
      <circle cx="2.5" cy="13" r="1.3" />
      <circle cx="7.5" cy="13" r="1.3" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// EditableTopicEyebrow — pencil-inline rename for the Pick header.
//
// Read state: eyebrow text + suffix + small pencil. Click pencil → text
// input + ✓ / ✕. Enter saves, Escape discards, blur saves if changed.
// Empty/whitespace → inline error, keep input open. Max 80 chars (mirrors
// PatchCategoryBodySchema). While saving the input is disabled and a
// micro "Saving…" label renders to the right.
//
// When `onSave` is omitted, renders the static eyebrow with no pencil —
// keeps the /dev/host/gen gallery preview clean.
// ─────────────────────────────────────────────────────────────────────────

const RENAME_MAX_LENGTH = 80;

interface EditableTopicEyebrowProps {
  value: string;
  suffix: string;
  onSave?: (next: string) => Promise<void>;
  isSaving: boolean;
}

function EditableTopicEyebrow({
  value,
  suffix,
  onSave,
  isSaving,
}: EditableTopicEyebrowProps) {
  const { t } = useTheme();
  const cc = categoryColor(value, t.accent);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When entering edit mode, sync draft + focus the input.
  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    setLocalError(null);
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [editing, value]);

  // Gallery mode (no save handler) — render the static eyebrow.
  if (!onSave) {
    return (
      <Eyebrow color={cc} size={12}>
        {value.toUpperCase()} {suffix}
      </Eyebrow>
    );
  }

  async function commit(): Promise<void> {
    const trimmed = draft.trim();
    if (!trimmed) {
      setLocalError("Name can't be blank.");
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > RENAME_MAX_LENGTH) {
      setLocalError(`Keep it under ${RENAME_MAX_LENGTH} characters.`);
      inputRef.current?.focus();
      return;
    }
    if (trimmed === value) {
      // No change — just close.
      setEditing(false);
      return;
    }
    try {
      await onSave!(trimmed);
      setEditing(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Couldn't save.");
      inputRef.current?.focus();
    }
  }

  function cancel(): void {
    setDraft(value);
    setLocalError(null);
    setEditing(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  function onBlur(e: FocusEvent<HTMLInputElement>): void {
    // Don't react to blur if focus is moving to one of our own controls;
    // those buttons handle their own click → commit / cancel.
    const next = e.relatedTarget as HTMLElement | null;
    if (next?.dataset.editControl === "true") return;
    // Save on blur only if the value actually changed; otherwise discard.
    if (draft.trim() !== value && draft.trim().length > 0) {
      void commit();
    } else {
      cancel();
    }
  }

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 16 }}>
        <Eyebrow color={cc} size={12}>
          {value.toUpperCase()} {suffix}
        </Eyebrow>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Rename category"
          data-testid="host-category-rename-btn"
          style={{
            background: "transparent",
            border: "none",
            padding: 2,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            color: t.inkMid,
            lineHeight: 0,
          }}
        >
          <PencilGlyph />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          disabled={isSaving}
          maxLength={RENAME_MAX_LENGTH}
          data-testid="host-category-rename-input"
          aria-label="Category name"
          style={{
            background: t.surface,
            border: `1px solid ${localError ? "#9c2f2f" : t.line}`,
            borderRadius: 6,
            padding: "4px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: cc,
            minWidth: 220,
            outline: "none",
          }}
        />
        <button
          type="button"
          data-edit-control="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void commit()}
          disabled={isSaving}
          aria-label="Save name"
          data-testid="host-category-rename-save"
          style={renameControlStyle(t.ink, t.paper)}
        >
          ✓
        </button>
        <button
          type="button"
          data-edit-control="true"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          disabled={isSaving}
          aria-label="Discard rename"
          data-testid="host-category-rename-cancel"
          style={renameControlStyle(t.line, t.ink)}
        >
          ✕
        </button>
        {isSaving && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: t.inkMute,
              marginLeft: 4,
              letterSpacing: "0.1em",
            }}
          >
            SAVING…
          </span>
        )}
      </div>
      {localError && (
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 11,
            color: "#9c2f2f",
            fontWeight: 500,
          }}
          role="alert"
        >
          {localError}
        </div>
      )}
    </div>
  );
}

function renameControlStyle(
  bg: string,
  fg: string,
): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: "none",
    borderRadius: 4,
    width: 22,
    height: 22,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    lineHeight: 1,
  };
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
