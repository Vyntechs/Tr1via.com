// HOST · GENERATE · 3. GENERATING
// The moment questions are being created. Captured at T+1.8s: 12 of 20 cards
// already in, 8 still loading as soft skeletons. Two streams progress
// independently: question text lands first, then the matched photo lands
// ~250ms later.

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

export interface HostGenLoadingProps {
  themeKey?: ThemeKey;
}

export function HostGenLoading({ themeKey }: HostGenLoadingProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenLoadingInner />
      </ThemeProvider>
    );
  }
  return <HostGenLoadingInner />;
}

interface PhaseFull {
  phase: "full";
  seed: string;
  q: string;
  diff: number;
}

interface PhaseText {
  phase: "text";
  q: string;
  diff: number;
}

type Phase = PhaseFull | PhaseText;

function HostGenLoadingInner() {
  const { t } = useTheme();
  const cc = categoryColor("Movies", t.accent);
  const phases: Phase[] = [
    { phase: "full", seed: "pixar1",  q: "What was Pixar's first feature film?",                   diff: 1 },
    { phase: "full", seed: "pixar2",  q: "In Up, what is the name of Carl's dog?",                  diff: 2 },
    { phase: "full", seed: "pixar3",  q: "Toy Story was released in what year?",                    diff: 3 },
    { phase: "full", seed: "pixar4",  q: "Which Pixar character is voiced by Ellen DeGeneres?",     diff: 1 },
    { phase: "full", seed: "pixar5",  q: "In Monsters, Inc., what does CDA stand for?",             diff: 6 },
    { phase: "full", seed: "pixar6",  q: "Wall·E's love interest is named what?",                   diff: 4 },
    { phase: "full", seed: "pixar7",  q: "Ratatouille is set in which city?",                       diff: 2 },
    { phase: "full", seed: "pixar8",  q: "Brave is Pixar's first film with what?",                  diff: 3 },
    { phase: "text",                  q: "In Coco, what is the boy's great-great-grandfather?",      diff: 4 },
    { phase: "text",                  q: "Pixar's opening logo features which character?",           diff: 3 },
    { phase: "text",                  q: "Inside Out's five emotions are joy, sadness, anger, fear, and what?", diff: 1 },
    { phase: "text",                  q: "The Incredibles' family surname is what?",                 diff: 2 },
  ];
  return (
    <LaptopShell title="pulling questions · pixar movies">
      <div style={{ padding: "24px 56px 12px", borderBottom: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: cc }} />
          <div>
            <Eyebrow color={t.accent} size={11}>PULLING 20 ON</Eyebrow>
            <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700, color: t.ink, letterSpacing: "-0.02em" }}>Pixar Movies</div>
            <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid }}>Writing the questions, then matching a photo to each.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", gap: 24 }}>
            <ProgressMini label="QUESTIONS" done={12} total={20} color={cc} />
            <ProgressMini label="PHOTOS" done={8} total={20} color={t.pop} />
          </div>
          <button style={{ padding: "8px 14px", borderRadius: 99, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Cancel</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 56px 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {phases.map((c, i) => {
            if (c.phase === "full") return <PickCardSmall key={i} q={c} cc={cc} />;
            return <PickCardTextOnly key={i} q={c} cc={cc} />;
          })}
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={`s${i}`} delay={i * 150} />
          ))}
        </div>
      </div>
    </LaptopShell>
  );
}

function ProgressMini({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const { t } = useTheme();
  return (
    <div style={{ width: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <Eyebrow color={t.inkMid} size={9}>{label}</Eyebrow>
        <Numeric size={10} color={t.inkMid}>{done}/{total}</Numeric>
      </div>
      <div style={{ height: 4, borderRadius: 99, background: t.line, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${(done / total) * 100}%`, height: "100%", background: color, transition: "width 0.4s ease-out" }} />
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

function PickCardTextOnly({ q, cc }: { q: PhaseText; cc: string }) {
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
        <div style={{ fontSize: 13.5, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35, minHeight: 38 }}>{q.q}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <DifficultyBar value={q.diff} color={cc} />
          <Numeric size={12} color={cc} weight={700}>{q.diff * 100}</Numeric>
        </div>
      </div>
    </div>
  );
}

function PickCardSmall({ q, cc }: { q: PhaseFull; cc: string }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1.5px solid ${t.line}`,
      background: t.dark ? "rgba(244,230,196,.03)" : "#FFF",
      animation: "tr1via-rise .4s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <StockImage seed={q.seed} height={120} radius="11px 11px 0 0" caption={null} />
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 13.5, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35, minHeight: 38 }}>{q.q}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <DifficultyBar value={q.diff} color={cc} />
          <Numeric size={12} color={cc} weight={700}>{q.diff * 100}</Numeric>
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
