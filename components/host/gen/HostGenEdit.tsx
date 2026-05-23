// HOST · GENERATE · 5. EDIT
// Inline panel. The question text + 4 options + image, all editable. Slides
// in from the right of the pick workspace; the workspace dims behind.

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
import { DifficultyBar, StockImage } from "./_shared";

export interface HostGenEditProps {
  themeKey?: ThemeKey;
}

export function HostGenEdit({ themeKey }: HostGenEditProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenEditInner />
      </ThemeProvider>
    );
  }
  return <HostGenEditInner />;
}

function HostGenEditInner() {
  const { t } = useTheme();
  const cc = categoryColor("Movies", t.accent);
  const options = ["Paris", "Lyon", "Marseille", "Nice"];
  return (
    <LaptopShell title="edit · pixar movies · q6">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 540px", overflow: "hidden" }}>
        {/* Dimmed background — the pick workspace fading */}
        <div style={{ background: t.paper, padding: "24px 56px", opacity: 0.35, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 12 }}>
          <Eyebrow color={t.accent} size={11}>PIXAR MOVIES</Eyebrow>
          <Display size={32} color={t.ink}>Pick your seven.</Display>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{ height: 240, borderRadius: 14, background: t.surface, border: `1px solid ${t.line}` }} />
            ))}
          </div>
        </div>

        {/* The edit panel */}
        <div style={{
          background: t.paper, color: t.ink,
          borderLeft: `1px solid ${t.line}`,
          padding: "28px 32px", display: "flex", flexDirection: "column", gap: 18,
          overflow: "auto",
          boxShadow: "-20px 0 60px -20px rgba(0,0,0,.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Eyebrow color={cc} size={11}>EDIT QUESTION · 6 OF 20</Eyebrow>
            <button style={{ background: "transparent", border: "none", color: t.inkMid, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>

          <div>
            <Eyebrow color={t.inkMute} size={9}>QUESTION</Eyebrow>
            <div style={{ marginTop: 8, padding: "14px 16px", borderRadius: 10, border: `1.5px solid ${cc}`, background: t.surface }}>
              <span style={{ fontSize: 18, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35 }}>Ratatouille is set in which city?</span>
              <span style={{ width: 2, height: 22, background: cc, marginLeft: 4, animation: "tr1via-caret 1s steps(2) infinite", display: "inline-block", verticalAlign: "middle" }} />
            </div>
          </div>

          <div>
            <Eyebrow color={t.inkMute} size={9}>FOUR ANSWERS · TAP TO MARK CORRECT</Eyebrow>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((o, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 10,
                  background: i === 0 ? (t.dark ? `${t.correct}12` : `${t.correct}10`) : t.surface,
                  border: `1.5px solid ${i === 0 ? t.correct : t.line}`,
                }}>
                  <Numeric size={14} weight={700} color={i === 0 ? t.correct : t.inkMid} style={{ minWidth: 14 }}>{i + 1}</Numeric>
                  <span style={{ flex: 1, fontSize: 14, color: t.ink, fontWeight: 500, letterSpacing: "-0.005em" }}>{o}</span>
                  {i === 0
                    ? <span style={{ padding: "3px 9px", borderRadius: 99, background: t.correct, color: "#0E0805", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}>CORRECT</span>
                    : <span style={{ padding: "3px 9px", borderRadius: 99, border: `1px solid ${t.line}`, color: t.inkMute, fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer" }}>mark</span>
                  }
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 16, alignItems: "flex-start" }}>
            <div>
              <Eyebrow color={t.inkMute} size={9}>IMAGE · AUTO-MATCHED</Eyebrow>
              <div style={{ marginTop: 8 }}>
                <StockImage seed="pixar6" height={120} radius="10px" />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: t.inkMid, lineHeight: 1.45 }}>
                Picked to fit “Ratatouille · Paris” from your library.
              </div>
              <button style={{ marginTop: 8, width: "100%", padding: "8px 0", borderRadius: 8, border: `1px solid ${t.line}`, background: "transparent", color: t.ink, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Swap image  →</button>
            </div>

            <div>
              <Eyebrow color={t.inkMute} size={9}>DIFFICULTY · AUTO</Eyebrow>
              <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 10, background: t.surface }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <Numeric size={28} weight={700} color={cc}>200</Numeric>
                  <span style={{ fontSize: 11, color: t.inkMid, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>EASY-MEDIUM</span>
                </div>
                <div style={{ marginTop: 10 }}>
                  <DifficultyBar value={2} color={cc} />
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: t.inkMute, fontWeight: 500 }}>Override if you disagree.</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 18, borderTop: `1px solid ${t.line}` }}>
            <button style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Discard changes</button>
            <button style={{ flex: 2, padding: "12px 0", borderRadius: 10, border: "none", background: t.accent, color: "#FFF", fontSize: 13, fontWeight: 700, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Save · this question</button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
