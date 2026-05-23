// HOST · GENERATE · 4. PICK
// 6 of 7 picked. The side panel shows the board she's building, point values
// 100→700 lit as she picks. Pulling a fresh 20 or applying flavor tweaks
// happens in the header rail.

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

export interface HostGenPickProps {
  themeKey?: ThemeKey;
}

export function HostGenPick({ themeKey }: HostGenPickProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenPickInner />
      </ThemeProvider>
    );
  }
  return <HostGenPickInner />;
}

type FlavorTag = "obscure" | "pop" | "local" | null;

interface Question {
  id: number;
  seed: string;
  q: string;
  options: string[];
  correct: number;
  diff: number;
  picked: boolean;
  edited: boolean;
  flavor: FlavorTag;
}

function HostGenPickInner() {
  const { t } = useTheme();
  const cc = categoryColor("Movies", t.accent);
  const questions: Question[] = [
    { id: 1,  seed: "pixar1",  q: "What was Pixar's first feature film?",                                            options: ["Toy Story", "A Bug's Life", "Monsters, Inc.", "Finding Nemo"],                       correct: 0, diff: 1, picked: true,  edited: false, flavor: null },
    { id: 2,  seed: "pixar2",  q: "In Up, what is the name of Carl's dog?",                                          options: ["Dug", "Buddy", "Russell", "Charles"],                                                  correct: 0, diff: 2, picked: true,  edited: false, flavor: null },
    { id: 3,  seed: "pixar3",  q: "Which year did Toy Story open in theaters?",                                       options: ["1993", "1995", "1997", "2000"],                                                        correct: 1, diff: 3, picked: true,  edited: false, flavor: null },
    { id: 4,  seed: "pixar4",  q: "Wall·E's love interest is named what?",                                            options: ["EVE", "AVA", "M-O", "BURN-E"],                                                         correct: 0, diff: 4, picked: true,  edited: true,  flavor: null },
    { id: 5,  seed: "pixar5",  q: "Inside Out's five emotions include joy, sadness, anger, fear, and what?",          options: ["Disgust", "Surprise", "Envy", "Pride"],                                                 correct: 0, diff: 4, picked: false, edited: false, flavor: null },
    { id: 6,  seed: "pixar6",  q: "Ratatouille is set in which city?",                                                options: ["Paris", "Lyon", "Marseille", "Nice"],                                                  correct: 0, diff: 2, picked: false, edited: false, flavor: null },
    { id: 7,  seed: "pixar7",  q: "In Monsters, Inc., what does CDA stand for?",                                       options: ["Child Detection Agency", "City Defense Authority", "Closet Discovery Alliance", "Citizen Disposal Act"], correct: 0, diff: 6, picked: true,  edited: false, flavor: "obscure" },
    { id: 8,  seed: "pixar8",  q: "In Coco, who is the boy's great-great-grandfather?",                                options: ["Ernesto de la Cruz", "Héctor Rivera", "Imelda Rivera", "Pepita"],                       correct: 1, diff: 5, picked: true,  edited: false, flavor: "obscure" },
    { id: 9,  seed: "pixar9",  q: "The Incredibles' family surname is what?",                                          options: ["Parr", "Heller", "Bonn", "Cole"],                                                       correct: 0, diff: 2, picked: false, edited: false, flavor: null },
    { id: 10, seed: "pixar10", q: "Which Pixar character is voiced by Ellen DeGeneres?",                               options: ["Dory", "Eve", "Ellie", "Bonnie"],                                                       correct: 0, diff: 1, picked: false, edited: false, flavor: null },
  ];
  return (
    <LaptopShell title="pick 7 · pixar movies">
      <div style={{ padding: "20px 56px 14px", borderBottom: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: cc }} />
          <div>
            <Eyebrow color={t.accent} size={11}>PIXAR MOVIES · 20 PULLED · PHOTOS MATCHED</Eyebrow>
            <div style={{ marginTop: 4, fontSize: 28, fontWeight: 700, color: t.ink, letterSpacing: "-0.02em" }}>Pick your seven.</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Eyebrow color={t.inkMute} size={10}>FLAVOR</Eyebrow>
          {["Easy", "Normal", "Hard"].map((d) => (
            <button key={d} style={{
              padding: "7px 14px", borderRadius: 99,
              border: `1px solid ${d === "Normal" ? t.ink : t.line}`,
              background: d === "Normal" ? t.ink : "transparent",
              color: d === "Normal" ? t.paper : t.ink,
              fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
            }}>{d}</button>
          ))}
          <span style={{ width: 1, height: 16, background: t.line, margin: "0 4px" }} />
          {["Sharper", "More obscure", "More pop", "More local", "Fresher"].map((s) => (
            <button key={s} style={{
              padding: "7px 12px", borderRadius: 99, border: `1px solid ${t.line}`,
              background: "transparent", color: t.inkMid,
              fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
            }}>{s}</button>
          ))}
          <button style={{ padding: "7px 14px", borderRadius: 99, border: `1px solid ${t.line}`, background: "transparent", color: t.ink, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>↻ Another 20</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 300px", overflow: "hidden" }}>
        <div style={{ overflow: "auto", padding: "20px 36px 32px 56px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
            {questions.map((q) => <QuestionCard key={q.id} q={q} cc={cc} />)}
          </div>
          <div style={{ marginTop: 18, padding: "12px 16px", borderRadius: 10, background: t.surface, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 4, height: 28, background: t.pop, borderRadius: 99 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, color: t.ink, fontWeight: 600 }}>Each photo was picked to match its question.</div>
              <div style={{ marginTop: 2, fontSize: 11, color: t.inkMid }}>From your free stock library. Click <em style={{ fontStyle: "normal", fontWeight: 600 }}>Image</em> on any card to swap.</div>
            </div>
          </div>
        </div>

        <PickSidebar cc={cc} picked={questions.filter((q) => q.picked)} />
      </div>
    </LaptopShell>
  );
}

function QuestionCard({ q, cc }: { q: Question; cc: string }) {
  const { t } = useTheme();
  const flavorLabel =
    q.flavor === "obscure" ? "OBSCURE" : q.flavor === "pop" ? "POP" : q.flavor === "local" ? "LOCAL" : null;
  return (
    <div style={{
      borderRadius: 14, overflow: "hidden",
      border: `1.5px solid ${q.picked ? cc : t.line}`,
      background: q.picked ? (t.dark ? `${cc}10` : `${cc}08`) : (t.dark ? "rgba(244,230,196,.03)" : "#FFF"),
      display: "flex", flexDirection: "column",
      position: "relative",
      animation: "tr1via-rise .35s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <StockImage seed={q.seed} height={140} radius="13px 13px 0 0">
        <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
          {q.edited && <span style={{ padding: "2px 7px", borderRadius: 99, background: "rgba(0,0,0,.55)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, color: "#FFF", letterSpacing: "0.08em" }}>EDITED</span>}
          {flavorLabel && <span style={{ padding: "2px 7px", borderRadius: 99, background: "rgba(0,0,0,.55)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, color: "#FFF", letterSpacing: "0.08em" }}>{flavorLabel}</span>}
        </div>
        <div style={{
          position: "absolute", top: 10, left: 10,
          width: 26, height: 26, borderRadius: 99,
          background: q.picked ? cc : "rgba(0,0,0,.5)",
          border: q.picked ? "none" : "1.5px solid rgba(255,255,255,.85)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {q.picked && <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="#0E0805" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
      </StockImage>

      <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35 }}>{q.q}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {q.options.map((o, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 8px", borderRadius: 6,
              background: i === q.correct ? (t.dark ? `${t.correct}18` : `${t.correct}12`) : "transparent",
            }}>
              <Numeric size={11} color={i === q.correct ? t.correct : t.inkMute} weight={700} style={{ minWidth: 12 }}>{i + 1}</Numeric>
              <span style={{ fontSize: 12, color: i === q.correct ? t.correct : t.inkMid, fontWeight: i === q.correct ? 600 : 500, flex: 1 }}>{o}</span>
              {i === q.correct && <Eyebrow color={t.correct} size={8}>✓</Eyebrow>}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DifficultyBar value={q.diff} color={cc} />
            <Numeric size={12} color={cc} weight={700}>{q.diff * 100}</Numeric>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Edit</button>
            <button style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Image</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PickSidebar({ cc, picked }: { cc: string; picked: Question[] }) {
  const { t } = useTheme();
  const slots = [100, 200, 300, 400, 500, 600, 700];
  const byDiff: Record<number, Question | undefined> = {};
  picked.forEach((p) => {
    byDiff[p.diff * 100] = p;
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

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6, flex: 1, overflow: "auto" }}>
        {slots.map((v) => {
          const filled = byDiff[v];
          return (
            <div key={v} style={{
              display: "grid", gridTemplateColumns: "52px 1fr", alignItems: "center", gap: 12,
              padding: "10px 12px", borderRadius: 10,
              background: filled ? (t.dark ? `${cc}10` : `${cc}06`) : "transparent",
              border: `1px ${filled ? "solid" : "dashed"} ${filled ? cc : t.line}`,
            }}>
              <Numeric size={18} color={filled ? cc : t.inkMute} weight={700}>{v}</Numeric>
              {filled ? (
                <div>
                  <div style={{ fontSize: 12, color: t.ink, fontWeight: 600, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{filled.q}</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: t.inkMute, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>{filled.options[filled.correct]}</div>
                </div>
              ) : (
                <span style={{ fontSize: 12, color: t.inkMute, fontWeight: 500 }}>open · pick a {v === 100 ? "easy" : v === 700 ? "hard" : ""} one</span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <button style={{
          background: picked.length === 7 ? t.accent : t.surface,
          color: picked.length === 7 ? "#FFF" : t.inkMute,
          border: "none", borderRadius: 12,
          padding: "14px 0", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-sans)",
          cursor: picked.length === 7 ? "pointer" : "not-allowed",
          boxShadow: picked.length === 7 ? `0 10px 22px -10px ${t.accent}77` : "none",
        }}>
          {picked.length === 7 ? "Lock the category  →" : `Pick ${7 - picked.length} more to lock`}
        </button>
        <Eyebrow color={t.inkMute} size={9} style={{ textAlign: "center" }}>YOU CAN STILL EDIT AFTER LOCKING</Eyebrow>
      </div>
    </div>
  );
}

