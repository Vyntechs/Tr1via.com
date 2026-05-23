// HOST · GENERATE · 6c. UPLOAD READY
// The photo has landed, ready to crop + use. Live TV reveal preview rides in
// the right rail with the new image already substituted in.

"use client";

import {
  Display,
  Eyebrow,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { StockImage } from "./_shared";

export interface HostGenImageUploadReadyProps {
  themeKey?: ThemeKey;
}

export function HostGenImageUploadReady({ themeKey }: HostGenImageUploadReadyProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenImageUploadReadyInner />
      </ThemeProvider>
    );
  }
  return <HostGenImageUploadReadyInner />;
}

function HostGenImageUploadReadyInner() {
  const { t } = useTheme();
  const cc = categoryColor("Movies", t.accent);
  return (
    <LaptopShell title="upload · pixar movies · q6">
      <div style={{ padding: "24px 56px 0", flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 380px", gap: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Eyebrow color={t.correct} size={11}>UPLOADED · PARIS-EIFFEL-2024.JPG</Eyebrow>
          <Display size={32} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            Looks great. Crop it?
          </Display>
          <div style={{ marginTop: 6, fontSize: 13, color: t.inkMid, lineHeight: 1.4, maxWidth: 540 }}>
            Drag the corners to fit the TV&apos;s reveal frame, or leave it and we&apos;ll fit it automatically.
          </div>

          <div style={{ marginTop: 22, flex: 1, position: "relative", borderRadius: 14, overflow: "hidden", border: `1px solid ${t.line}`, minHeight: 360 }}>
            <StockImage seed="linda1" height="100%" radius="13px" />
            {/* crop frame overlay */}
            <div style={{
              position: "absolute", left: "8%", top: "12%", right: "8%", bottom: "12%",
              border: `2px solid ${t.pop}`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,.4)`,
              pointerEvents: "none",
            }}>
              {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => (
                <span key={`${x}${y}`} style={{
                  position: "absolute",
                  left: x ? "auto" : -7, right: x ? -7 : "auto",
                  top: y ? "auto" : -7, bottom: y ? -7 : "auto",
                  width: 14, height: 14, background: t.pop, borderRadius: 3,
                }} />
              ))}
              <div style={{ position: "absolute", bottom: -28, left: 0, right: 0, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: t.pop, letterSpacing: "0.06em" }}>
                16 : 9  ·  TV REVEAL FRAME
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 10, paddingBottom: 24 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 99, border: `1px solid ${t.line}`, cursor: "pointer", fontSize: 12, color: t.ink, fontWeight: 600 }}>
              <input type="checkbox" defaultChecked style={{ accentColor: t.accent }} />
              <span>Save to my photos</span>
            </label>
            <button style={{ padding: "8px 14px", borderRadius: 99, border: `1px solid ${t.line}`, background: "transparent", color: t.ink, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Reset crop</button>
            <button style={{ padding: "8px 14px", borderRadius: 99, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Replace</button>
          </div>
        </div>

        {/* Right rail — live preview of TV reveal with new image */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24 }}>
          <Eyebrow color={t.inkMute} size={10}>LIVE PREVIEW · TV REVEAL</Eyebrow>
          <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${t.line}` }}>
            <StockImage seed="linda1" height={200} radius="12px 12px 0 0" />
            <div style={{ padding: "16px 18px", background: cc, color: "#0E0805" }}>
              <Eyebrow color="rgba(14,8,5,.65)" size={9}>PIXAR MOVIES · 200 PTS</Eyebrow>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 }}>Ratatouille is set in which city?</div>
            </div>
          </div>

          <div style={{ padding: "12px 14px", borderRadius: 10, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={9}>FILE</Eyebrow>
            <div style={{ marginTop: 6, fontSize: 13, color: t.ink, fontWeight: 600 }}>paris-eiffel-2024.jpg</div>
            <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 11, color: t.inkMid }}>
              <span>2.4 MB · 1920 × 1280</span>
              <span style={{ color: t.correct, fontFamily: "var(--font-mono)", fontWeight: 600 }}>SCANNED · OK</span>
            </div>
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <button style={{ background: t.accent, color: "#FFF", border: "none", borderRadius: 12, padding: "16px 0", fontSize: 15, fontWeight: 700, fontFamily: "var(--font-sans)", cursor: "pointer", boxShadow: `0 12px 22px -10px ${t.accent}77` }}>Use this photo  →</button>
            <button style={{ background: "transparent", color: t.inkMute, border: "none", padding: "4px 0", fontSize: 12, fontWeight: 500, fontFamily: "var(--font-sans)", cursor: "pointer" }}>Discard</button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
