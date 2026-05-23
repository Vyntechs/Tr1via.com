// TV — the grid. Each category column = its color. Big, weighty board.
// One selected cell (Linda's pick) glows. Played cells are dashed-out and
// struck through. Sidebar shows leader, current-player rank, and the pick
// that's loading.

"use client";

import { TVStage, TVHeader, TVFooter } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVGridProps {
  themeKey?: ThemeKey;
}

export function TVGrid({ themeKey }: TVGridProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVGridInner />
      </ThemeProvider>
    );
  }
  return <TVGridInner />;
}

function TVGridInner() {
  const { t } = useTheme();
  const categories = ["Geography", "Animals", "Food", "Movies", "Music", "History"];
  const values = [100, 200, 300, 400, 500, 600, 700];
  const played = new Set(["0-0", "0-1", "1-0", "2-0", "3-0", "4-0", "1-1", "3-1", "5-0", "5-1"]);
  const selected = "2-2"; // Food · 300

  return (
    <TVStage>
      <TVHeader left="GAME 1 · ROUND 3 · 32 PLAYERS" right="10 OF 42 ANSWERED" />

      <div
        style={{
          flex: 1,
          padding: "20px 56px 0",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 36,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Category row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${categories.length}, 1fr)`,
              gap: 8,
              marginBottom: 10,
            }}
          >
            {categories.map((c) => {
              const cc = categoryColor(c, t.accent);
              return (
                <div
                  key={c}
                  style={{
                    padding: "14px 12px",
                    borderRadius: 10,
                    background: cc,
                    color: "#0E0805",
                    textAlign: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-0.005em",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {c}
                </div>
              );
            })}
          </div>

          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateRows: `repeat(${values.length}, 1fr)`,
              gap: 8,
            }}
          >
            {values.map((v, rIdx) => (
              <div
                key={v}
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${categories.length}, 1fr)`,
                  gap: 8,
                }}
              >
                {categories.map((c, cIdx) => {
                  const cc = categoryColor(c, t.accent);
                  const key = `${cIdx}-${rIdx}`;
                  const isPlayed = played.has(key);
                  const isSelected = key === selected;
                  return (
                    <div
                      key={key}
                      style={{
                        borderRadius: 10,
                        background: isSelected
                          ? cc
                          : isPlayed
                            ? "transparent"
                            : t.dark
                              ? "rgba(244,230,196,.06)"
                              : "rgba(27,19,12,.04)",
                        border: isPlayed
                          ? `1px dashed ${t.line}`
                          : isSelected
                            ? `2px solid ${cc}`
                            : `1px solid ${t.line}`,
                        boxShadow: isSelected
                          ? `0 10px 36px -10px ${cc}77, 0 0 0 4px ${cc}22`
                          : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        overflow: "hidden",
                        transition: "all .3s cubic-bezier(.2,.7,.3,1)",
                        transform: isSelected ? "scale(1.04)" : "scale(1)",
                      }}
                    >
                      <Numeric
                        size={36}
                        weight={700}
                        color={isSelected ? "#0E0805" : isPlayed ? t.inkMute : t.ink}
                        tracking={-0.03}
                        style={{
                          textDecoration: isPlayed ? "line-through" : "none",
                          opacity: isPlayed ? 0.4 : 1,
                        }}
                      >
                        {v}
                      </Numeric>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ padding: "18px 22px", borderRadius: 14, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>LEADER · ROUND 3</Eyebrow>
            <div style={{ marginTop: 8 }}>
              <Display size={48} color={t.ink} weight={700}>Devon</Display>
              <Numeric size={26} weight={700} color={t.accent} style={{ display: "block", marginTop: 4 }}>
                2,140
              </Numeric>
            </div>
          </div>

          <div style={{ padding: "16px 22px", borderRadius: 14, border: `1px solid ${t.line}` }}>
            <Eyebrow color={t.inkMute} size={10}>YOU · MAYA</Eyebrow>
            <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", gap: 12 }}>
              <Numeric size={32} weight={700} color={t.pop}>#7</Numeric>
              <Numeric size={20} weight={500} color={t.ink}>1,460</Numeric>
            </div>
          </div>

          <div style={{ padding: "16px 22px", borderRadius: 14, background: t.accent, color: "#0E0805" }}>
            <Eyebrow color="rgba(14,8,5,.65)" size={10}>UP NEXT · LINDA&apos;S PICK</Eyebrow>
            <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}>Food · 300 pts</div>
            <div style={{ marginTop: 4, fontSize: 12, color: "rgba(14,8,5,.65)", fontWeight: 500 }}>
              standing by to reveal
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <Eyebrow color={t.inkMute} size={10}>BOARD</Eyebrow>
            <Numeric size={20} color={t.ink}>32 left</Numeric>
          </div>
        </div>
      </div>

      <TVFooter left="WAITING ON LINDA" right="TR1VIA.COM · K9·PR4M" />
    </TVStage>
  );
}
