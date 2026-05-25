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

import { useMemo } from "react";
import {
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
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
  /** Open the edit panel for a specific question. */
  onEdit?: (questionId: string) => void;
  /** Open the image swap UI for a specific question. */
  onSwapImage?: (questionId: string) => void;
  /** Called when the host taps "Lock the category" with 7 picked. */
  onLock?: () => void;
  /** Called when the host taps "Another 20" / a flavor button. */
  onRegenerate?: (input: {
    difficulty: DifficultyTarget;
    flavor: string[];
  }) => void;
  /** True while the lock-the-category POST is in flight. */
  isLocking?: boolean;
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
  onLock,
  onRegenerate,
  isLocking = false,
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
    <LaptopShell title={shellTitle}>
      <div style={{ padding: "20px 56px 14px", borderBottom: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: cc }} />
          <div>
            <Eyebrow color={t.accent} size={11}>
              {topic.toUpperCase()} · {questions.length} PULLED · PHOTOS MATCHED
            </Eyebrow>
            <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700, color: t.ink, letterSpacing: "-0.02em" }}>Pick your seven.</div>
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
                style={{
                  padding: "7px 14px", borderRadius: 99,
                  border: `1px solid ${active ? t.ink : t.line}`,
                  background: active ? t.ink : "transparent",
                  color: active ? t.paper : t.ink,
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
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
                style={{
                  padding: "7px 12px", borderRadius: 99, border: `1px solid ${active ? t.ink : t.line}`,
                  background: active ? t.ink : "transparent",
                  color: active ? t.paper : t.inkMid,
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
                }}
              >
                {s}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onRegenerate?.({ difficulty, flavor })}
            style={{ padding: "7px 14px", borderRadius: 99, border: `1px solid ${t.line}`, background: "transparent", color: t.ink, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}
          >
            ↻ Another 20
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
  onLock,
  isLocking,
}: {
  cc: string;
  picked: HostGenPickQuestion[];
  tierByPickId: Map<string, number>;
  /** Unpick a question directly from the board (the first host's request: she
   *  doesn't want to scroll the 20-card grid to find + unclick). When
   *  omitted, the × button is hidden. */
  onUnpick?: (questionId: string) => void;
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
  const ready = picked.length === 7;
  return (
    <div style={{ borderLeft: `1px solid ${t.line}`, padding: "20px 24px 24px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <Eyebrow color={t.inkMid} size={10}>YOUR BOARD</Eyebrow>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <Numeric size={24} weight={700} color={cc}>{picked.length}</Numeric>
          <span style={{ fontSize: 13, color: t.inkMute }}>/ 7</span>
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6, flex: 1, overflow: "auto" }}>
        {slots.map((v) => {
          const filled = byTier[v];
          // Three-column when the unpick button can render (filled + handler);
          // two-column otherwise so the empty-slot row keeps its existing
          // alignment.
          const showUnpick = !!filled && !!onUnpick;
          return (
            <div key={v} style={{
              display: "grid",
              gridTemplateColumns: showUnpick ? "52px 1fr 24px" : "52px 1fr",
              alignItems: "center", gap: 12,
              padding: "10px 12px", borderRadius: 10,
              background: filled ? (t.dark ? `${cc}10` : `${cc}06`) : "transparent",
              border: `1px ${filled ? "solid" : "dashed"} ${filled ? cc : t.line}`,
            }}>
              <Numeric size={18} color={filled ? cc : t.inkMute} weight={700}>{v}</Numeric>
              {filled ? (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: t.ink, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{filled.prompt}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: t.inkMute, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{filled.options[filled.correctIndex]}</div>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: t.inkMute, fontWeight: 500 }}>open · pick a {v === 100 ? "easy" : v === 700 ? "hard" : ""} one</span>
              )}
              {showUnpick && (
                <button
                  type="button"
                  onClick={() => onUnpick(filled.id)}
                  aria-label={`Remove from slot ${v}`}
                  title={`Remove (slot ${v} opens up)`}
                  data-testid={`pick-sidebar-unpick-${v}`}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 99,
                    border: `1px solid ${t.line}`,
                    background: "transparent",
                    color: t.inkMid,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
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
        <Eyebrow color={t.inkMute} size={9} style={{ textAlign: "center" }}>YOU CAN STILL EDIT AFTER LOCKING</Eyebrow>
      </div>
    </div>
  );
}
