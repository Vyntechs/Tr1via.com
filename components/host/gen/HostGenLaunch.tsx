// HOST · GENERATE · 8. BOTH BOARDS READY
// The launch moment. Both games' boards are built. Room code is fresh, theme
// is set, the only thing left is the host's tap on "Open the room".

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

export interface HostGenLaunchProps {
  themeKey?: ThemeKey;
}

export function HostGenLaunch({ themeKey }: HostGenLaunchProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenLaunchInner />
      </ThemeProvider>
    );
  }
  return <HostGenLaunchInner />;
}

function HostGenLaunchInner() {
  const { t } = useTheme();
  const g1 = ["Geography", "Music", "Animals", "Pixar Movies", "Food", "Local Madison"];
  const g2 = ["History", "Sports", "Movies", "90s Songs", "Science", "Cocktails"];
  return (
    <LaptopShell title="both boards ready · soul fire pizza">
      <div style={{ padding: "32px 56px 0", flex: 1, display: "grid", gridTemplateColumns: "1fr 320px", gap: 40, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Eyebrow color={t.accent} size={11}>READY · 00:54 ELAPSED</Eyebrow>
          <Display size={64} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.03}>
            <span style={{ color: t.accent }}>Two boards.</span><br />
            Forty-two questions each.
          </Display>
          <div style={{ marginTop: 12, fontSize: 14.5, color: t.inkMid, lineHeight: 1.5, maxWidth: 540 }}>
            Game 2&apos;s board is already built. Players who arrive late will see it open one tap after Game 1 ends. No setup between games.
          </div>

          <div style={{ marginTop: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, flex: 1, overflow: "hidden" }}>
            {[{ label: "GAME 1 · 7:00 PM", cats: g1 }, { label: "GAME 2 · 7:55 PM", cats: g2 }].map((g) => (
              <div key={g.label} style={{ borderRadius: 14, border: `1px solid ${t.line}`, padding: "18px 18px", display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <Eyebrow color={t.inkMid} size={10}>{g.label}</Eyebrow>
                  <Numeric size={11} color={t.correct}>READY</Numeric>
                </div>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
                  {g.cats.map((c) => {
                    const cc = categoryColor(c, t.accent);
                    return (
                      <div key={c} style={{
                        padding: "8px 10px", borderRadius: 8,
                        background: t.dark ? `${cc}14` : `${cc}10`,
                        border: `1px solid ${cc}55`,
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, background: cc }} />
                        <span style={{ fontSize: 12, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em" }}>{c}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: "auto", paddingTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <Eyebrow color={t.inkMute} size={9}>42 QUESTIONS</Eyebrow>
                  <Eyebrow color={t.inkMute} size={9}>~50 MIN</Eyebrow>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 24 }}>
          <div style={{ padding: "20px 22px", borderRadius: 14, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>VENUE</Eyebrow>
            <div style={{ marginTop: 6, fontSize: 18, color: t.ink, fontWeight: 600 }}>Soul Fire Pizza</div>
            <div style={{ marginTop: 2, fontSize: 12, color: t.inkMid }}>123 W. Mifflin · Madison, WI</div>

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.line}` }}>
              <Eyebrow color={t.inkMute} size={10}>ROOM CODE</Eyebrow>
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ padding: "6px 12px", borderRadius: 8, background: t.accent, color: "#0E0805", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 20, letterSpacing: "0.05em" }}>K9·PR4M</span>
                <span style={{ fontSize: 11, color: t.inkMute }}>auto-generated</span>
              </div>
            </div>

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.line}` }}>
              <Eyebrow color={t.inkMute} size={10}>THEME</Eyebrow>
              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 99, background: t.accent }} />
                <span style={{ fontSize: 14, color: t.ink, fontWeight: 600 }}>May · Storm</span>
              </div>
              <div style={{ marginTop: 2, fontSize: 11, color: t.inkMute }}>distant lightning · grey sky · moody</div>
            </div>
          </div>

          <button style={{
            marginTop: "auto",
            background: t.accent, color: "#FFF", border: "none", borderRadius: 14,
            padding: "20px 0", fontSize: 17, fontWeight: 700, fontFamily: "var(--font-sans)",
            cursor: "pointer", letterSpacing: "-0.005em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            boxShadow: `0 16px 30px -10px ${t.accent}77`,
          }}>
            Open the room  →
          </button>
          <div style={{ fontSize: 11, color: t.inkMute, textAlign: "center", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>QR GOES UP ON THE TV</div>
        </div>
      </div>
    </LaptopShell>
  );
}
