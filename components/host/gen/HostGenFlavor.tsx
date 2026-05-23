// HOST · GENERATE · 7. FLAVOR RE-PULL
// The moment after "Sharper" is pressed. Same 20 slots; her 4 picked
// questions stay (badged "KEPT · YOUR PICK"); the remaining 16 are
// dissolving out for fresh replacements.

"use client";

import {
  Eyebrow,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { DifficultyBar, StockImage } from "./_shared";

export interface HostGenFlavorProps {
  themeKey?: ThemeKey;
}

export function HostGenFlavor({ themeKey }: HostGenFlavorProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenFlavorInner />
      </ThemeProvider>
    );
  }
  return <HostGenFlavorInner />;
}

interface KeptCard {
  kept: true;
  picked: true;
  diff: number;
  seed: string;
  q: string;
}

interface DissolvingCard {
  kept: false;
  idx: number;
}

type FlavorCard = KeptCard | DissolvingCard;

function HostGenFlavorInner() {
  const { t } = useTheme();
  const cc = categoryColor("Movies", t.accent);
  const cards: FlavorCard[] = [
    { kept: true, picked: true, diff: 1, seed: "pixar1", q: "What was Pixar's first feature film?" },
    { kept: true, picked: true, diff: 2, seed: "pixar2", q: "In Up, what is the name of Carl's dog?" },
    { kept: true, picked: true, diff: 3, seed: "pixar3", q: "Which year did Toy Story open in theaters?" },
    { kept: true, picked: true, diff: 4, seed: "pixar4", q: "Wall·E's love interest is named what?" },
    ...Array.from({ length: 16 }, (_, i): DissolvingCard => ({ kept: false, idx: i })),
  ];
  return (
    <LaptopShell title="pixar movies · sharper">
      <div style={{ padding: "20px 56px 16px", borderBottom: `1px solid ${t.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: cc }} />
          <div>
            <Eyebrow color={t.accent} size={11}>SHARPENING · PIXAR MOVIES</Eyebrow>
            <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: t.ink, letterSpacing: "-0.015em" }}>
              Your 4 picks stay. Pulling fresher 16.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Eyebrow color={t.inkMute} size={10}>FLAVOR</Eyebrow>
          {["Easy", "Normal", "Hard"].map((d) => (
            <span key={d} style={{ padding: "6px 12px", borderRadius: 99, border: `1px solid ${d === "Normal" ? t.ink : t.line}`, background: d === "Normal" ? t.ink : "transparent", color: d === "Normal" ? t.paper : t.ink, fontSize: 11, fontWeight: 600 }}>{d}</span>
          ))}
          <span style={{ width: 1, height: 14, background: t.line, margin: "0 2px" }} />
          <span style={{ padding: "6px 12px", borderRadius: 99, background: cc, color: "#0E0805", fontSize: 11, fontWeight: 700 }}>Sharper · ON</span>
          {["More obscure", "More pop", "More local", "Fresher"].map((s) => (
            <span key={s} style={{ padding: "6px 10px", borderRadius: 99, border: `1px solid ${t.line}`, color: t.inkMid, fontSize: 11, fontWeight: 600 }}>{s}</span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 36px 32px 56px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {cards.map((c, i) => {
            if (c.kept) {
              return (
                <div key={i} style={{
                  borderRadius: 12, overflow: "hidden",
                  border: `1.5px solid ${cc}`,
                  background: t.dark ? `${cc}10` : `${cc}08`,
                  position: "relative",
                }}>
                  <StockImage seed={c.seed} height={90} radius="11px 11px 0 0">
                    <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 99, background: cc, color: "#0E0805", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em" }}>KEPT · YOUR PICK</div>
                  </StockImage>
                  <div style={{ padding: 12 }}>
                    <div style={{ fontSize: 12, color: t.ink, fontWeight: 600, lineHeight: 1.35, minHeight: 32, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.q}</div>
                    <div style={{ marginTop: 8 }}><DifficultyBar value={c.diff} color={cc} /></div>
                  </div>
                </div>
              );
            }
            // dissolving card — fade + slight scale
            const opacity = 0.55 - (c.idx % 4) * 0.07;
            return (
              <div key={i} style={{
                borderRadius: 12, overflow: "hidden",
                border: `1px dashed ${t.line}`,
                background: t.surface,
                minHeight: 180, opacity,
                position: "relative",
                animation: `tr1via-skeleton-pulse 1.6s ease-in-out ${c.idx * 80}ms infinite`,
              }}>
                <div style={{ height: 90, background: t.dark ? "rgba(244,230,196,.04)" : "rgba(27,19,12,.03)" }} />
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ height: 10, width: "80%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.06)" : "rgba(27,19,12,.05)" }} />
                  <div style={{ height: 10, width: "50%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.06)" : "rgba(27,19,12,.05)" }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </LaptopShell>
  );
}
