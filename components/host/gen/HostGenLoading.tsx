// HOST · GENERATE · 3. GENERATING
// The moment questions are being created. Two streams progress
// independently: question text lands first, then the matched photo lands
// shortly after.
//
// Wired form: the pick route subscribes to `category:{id}` broadcasts and
// passes a live tally of questions + photos. Each loaded question lands
// here as a card with text (and a photo when ready). The remainder are
// shown as soft skeletons. All props are optional with demo defaults so
// the /_dev/host/gen gallery still renders.

"use client";

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

export interface HostGenLoadingQuestion {
  id: string;
  prompt: string;
  difficulty: number;
  /** When set, render with the image preview; when null, show "matching photo…". */
  imageUrl: string | null;
  /** Fallback seed when we don't have a real URL yet (demo only). */
  seed?: string;
}

export interface HostGenLoadingProps {
  themeKey?: ThemeKey;
  /** Title in the shell chrome. */
  shellTitle?: string;
  /** Topic name displayed in the headline. */
  topic?: string;
  /** Questions loaded so far (in arrival order). */
  loaded?: HostGenLoadingQuestion[];
  /** Total questions expected (default 20). */
  total?: number;
  /** Count of questions whose photo has landed. */
  photosLoaded?: number;
  /** Called when the host taps "Cancel". */
  onCancel?: () => void;
}

const DEMO_LOADED: HostGenLoadingQuestion[] = [
  { id: "1",  prompt: "What was Pixar's first feature film?",                                              difficulty: 1, imageUrl: "demo", seed: "pixar1" },
  { id: "2",  prompt: "In Up, what is the name of Carl's dog?",                                           difficulty: 2, imageUrl: "demo", seed: "pixar2" },
  { id: "3",  prompt: "Toy Story was released in what year?",                                              difficulty: 3, imageUrl: "demo", seed: "pixar3" },
  { id: "4",  prompt: "Which Pixar character is voiced by Ellen DeGeneres?",                               difficulty: 1, imageUrl: "demo", seed: "pixar4" },
  { id: "5",  prompt: "In Monsters, Inc., what does CDA stand for?",                                       difficulty: 6, imageUrl: "demo", seed: "pixar5" },
  { id: "6",  prompt: "Wall·E's love interest is named what?",                                             difficulty: 4, imageUrl: "demo", seed: "pixar6" },
  { id: "7",  prompt: "Ratatouille is set in which city?",                                                 difficulty: 2, imageUrl: "demo", seed: "pixar7" },
  { id: "8",  prompt: "Brave is Pixar's first film with what?",                                            difficulty: 3, imageUrl: "demo", seed: "pixar8" },
  { id: "9",  prompt: "In Coco, what is the boy's great-great-grandfather?",                              difficulty: 4, imageUrl: null },
  { id: "10", prompt: "Pixar's opening logo features which character?",                                    difficulty: 3, imageUrl: null },
  { id: "11", prompt: "Inside Out's five emotions are joy, sadness, anger, fear, and what?",               difficulty: 1, imageUrl: null },
  { id: "12", prompt: "The Incredibles' family surname is what?",                                          difficulty: 2, imageUrl: null },
];

export function HostGenLoading(props: HostGenLoadingProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenLoadingInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenLoadingInner {...rest} />;
}

function HostGenLoadingInner({
  shellTitle = "pulling questions · pixar movies",
  topic = "Pixar Movies",
  loaded = DEMO_LOADED,
  total = 20,
  photosLoaded,
  onCancel,
}: Omit<HostGenLoadingProps, "themeKey">) {
  const { t } = useTheme();
  const cc = categoryColor(topic, t.accent);
  const questionsLoaded = loaded.length;
  const photosCount =
    typeof photosLoaded === "number"
      ? photosLoaded
      : loaded.filter((l) => l.imageUrl).length;
  const skeletonCount = Math.max(0, total - questionsLoaded);
  return (
    <LaptopShell title={shellTitle}>
      <div style={{ padding: "24px 56px 12px", borderBottom: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: cc }} />
          <div>
            <Eyebrow color={t.accent} size={11}>PULLING {total} ON</Eyebrow>
            <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700, color: t.ink, letterSpacing: "-0.02em" }}>{topic}</div>
            <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid }}>Writing the questions, then matching a photo to each.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", gap: 24 }}>
            <ProgressMini label="QUESTIONS" done={questionsLoaded} total={total} color={cc} />
            <ProgressMini label="PHOTOS" done={photosCount} total={total} color={t.pop} />
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              style={{ padding: "8px 14px", borderRadius: 99, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 56px 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {loaded.map((q) =>
            q.imageUrl ? (
              <PickCardSmall key={q.id} q={q} cc={cc} />
            ) : (
              <PickCardTextOnly key={q.id} q={q} cc={cc} />
            ),
          )}
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <SkeletonCard key={`s${i}`} delay={i * 150} />
          ))}
        </div>
      </div>
    </LaptopShell>
  );
}

function ProgressMini({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const { t } = useTheme();
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div style={{ width: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <Eyebrow color={t.inkMid} size={9}>{label}</Eyebrow>
        <Numeric size={10} color={t.inkMid}>{done}/{total}</Numeric>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: t.line, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.4s ease-out" }} />
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(90deg, transparent, ${color}55, transparent)`,
          backgroundSize: "200% 100%",
          animation: "tr1via-shimmer 1.6s linear infinite",
        }} />
      </div>
    </div>
  );
}

function PickCardTextOnly({ q, cc }: { q: HostGenLoadingQuestion; cc: string }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1px solid ${t.line}`,
      background: t.dark ? "rgba(244,230,196,.03)" : "#FFF",
      animation: "tr1via-rise .4s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <div style={{
        height: 120, position: "relative", overflow: "hidden",
        background: t.dark ? "rgba(244,230,196,.05)" : "rgba(27,19,12,.04)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(90deg, transparent, ${t.pop}33, transparent)`,
          backgroundSize: "200% 100%",
          animation: "tr1via-shimmer 1.6s linear infinite",
        }} />
        <span style={{
          padding: "4px 10px", borderRadius: 99, background: t.dark ? "rgba(0,0,0,.4)" : "rgba(255,255,255,.85)",
          color: t.pop, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 10, letterSpacing: "0.08em",
          position: "relative", zIndex: 1,
        }}>MATCHING PHOTO…</span>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 13.5, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35, minHeight: 38 }}>{q.prompt}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <DifficultyBar value={q.difficulty} color={cc} />
          <Numeric size={12} color={cc} weight={700}>{q.difficulty * 100}</Numeric>
        </div>
      </div>
    </div>
  );
}

function PickCardSmall({ q, cc }: { q: HostGenLoadingQuestion; cc: string }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1.5px solid ${t.line}`,
      background: t.dark ? "rgba(244,230,196,.03)" : "#FFF",
      animation: "tr1via-rise .4s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <StockImage seed={q.seed ?? q.id} height={120} radius="11px 11px 0 0" caption={null} />
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 13.5, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35, minHeight: 38 }}>{q.prompt}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <DifficultyBar value={q.difficulty} color={cc} />
          <Numeric size={12} color={cc} weight={700}>{q.difficulty * 100}</Numeric>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard({ delay = 0 }: { delay?: number }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1px solid ${t.line}`,
      background: t.surface,
      animation: `tr1via-skeleton-pulse 1.6s ease-in-out ${delay}ms infinite`,
      minHeight: 200,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ height: 120, background: t.dark ? "rgba(244,230,196,.05)" : "rgba(27,19,12,.04)" }} />
      <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ height: 11, width: "85%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.06)" : "rgba(27,19,12,.05)" }} />
        <div style={{ height: 11, width: "60%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.06)" : "rgba(27,19,12,.05)" }} />
        <div style={{ height: 5, width: "40%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.04)" : "rgba(27,19,12,.04)", marginTop: 6 }} />
      </div>
    </div>
  );
}
