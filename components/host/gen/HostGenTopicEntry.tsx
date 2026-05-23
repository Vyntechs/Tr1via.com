// HOST · GENERATE · 2. TOPIC ENTRY
// Typing into an empty slot. Autocomplete from Linda's history; repeat
// warning surfaces inline. Difficulty + Flavor settings ride in the right rail.

"use client";

import {
  Display,
  Eyebrow,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostGenTopicEntryProps {
  themeKey?: ThemeKey;
}

export function HostGenTopicEntry({ themeKey }: HostGenTopicEntryProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenTopicEntryInner />
      </ThemeProvider>
    );
  }
  return <HostGenTopicEntryInner />;
}

interface RecentTopic {
  name: string;
  date: string;
  used?: boolean;
}

function HostGenTopicEntryInner() {
  const { t } = useTheme();
  const recent: RecentTopic[] = [
    { name: "Pixar Movies", date: "Apr 2", used: true },
    { name: "Geography", date: "last night" },
    { name: "NFL Teams", date: "May 12" },
    { name: "90s Music", date: "May 7" },
    { name: "Local Madison", date: "May 5" },
    { name: "Greek Mythology", date: "Apr 23" },
    { name: "World Cup", date: "Apr 16" },
    { name: "Cocktails", date: "Apr 9" },
    { name: "Beatles", date: "Mar 26" },
  ];
  return (
    <LaptopShell title="set up tonight · slot 5">
      <div style={{ padding: "40px 56px", flex: 1, display: "grid", gridTemplateColumns: "1fr 300px", gap: 40 }}>
        <div>
          <Eyebrow color={t.accent} size={11}>GAME 1 · SLOT 5 OF 6</Eyebrow>
          <Display size={48} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            What&apos;s the topic?
          </Display>
          <div style={{ marginTop: 8, color: t.inkMid, fontSize: 14, lineHeight: 1.45, maxWidth: 540 }}>
            Anything. A movie franchise, a sports league, your town, a decade. The more specific, the sharper the questions.
          </div>

          <div style={{ marginTop: 36, paddingBottom: 18, borderBottom: `2px solid ${t.accent}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 64, color: t.ink, letterSpacing: "-0.035em", lineHeight: 1 }}>Pixar Movies</span>
              <span style={{ width: 3, height: 56, background: t.accent, animation: "tr1via-caret 1s steps(2) infinite", marginLeft: 4 }} />
            </div>
          </div>

          <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, background: t.surface, border: `1px solid ${t.wrong}55`, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 4, alignSelf: "stretch", background: t.wrong, borderRadius: 99 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: t.ink, fontWeight: 600 }}>
                Pixar Movies — <span style={{ color: t.inkMid, fontWeight: 500 }}>you ran this on April 2.</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid }}>Same topic, fresh questions. Same room may not see it again.</div>
            </div>
            <button style={{ background: "transparent", border: `1px solid ${t.line}`, color: t.ink, padding: "6px 12px", borderRadius: 99, fontSize: 12, fontFamily: "var(--font-sans)", fontWeight: 600, cursor: "pointer" }}>Use it anyway</button>
          </div>

          <div style={{ marginTop: 32 }}>
            <Eyebrow color={t.inkMute} size={10}>YOUR LAST TOPICS</Eyebrow>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {recent.map((c) => (
                <span key={c.name} style={{
                  padding: "6px 12px", borderRadius: 99,
                  background: c.used ? t.accent : "transparent",
                  color: c.used ? "#0E0805" : t.ink,
                  border: `1px solid ${c.used ? t.accent : t.line}`,
                  fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                  display: "flex", alignItems: "center", gap: 6,
                  cursor: "pointer",
                }}>
                  {c.name}
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: 10, opacity: c.used ? 0.7 : 0.55 }}>{c.date}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "18px 20px", borderRadius: 14, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>SETTINGS · APPLIED TO THIS BATCH</Eyebrow>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: t.inkMid, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Difficulty</div>
              <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
                {["Easy", "Normal", "Hard"].map((d) => (
                  <button key={d} style={{
                    flex: 1, padding: "8px 0", borderRadius: 8,
                    border: `1px solid ${d === "Normal" ? t.ink : t.line}`,
                    background: d === "Normal" ? t.ink : "transparent",
                    color: d === "Normal" ? t.paper : t.ink,
                    fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
                  }}>{d}</button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: t.inkMid, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Flavor (optional)</div>
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {["Sharper", "More obscure", "More pop", "More local", "Fresher"].map((s) => (
                  <button key={s} style={{
                    padding: "6px 10px", borderRadius: 99, border: `1px solid ${t.line}`,
                    background: "transparent", color: t.inkMid,
                    fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
                  }}>{s}</button>
                ))}
              </div>
            </div>
          </div>

          <button style={{
            marginTop: "auto",
            background: t.accent, color: "#FFF", border: "none", borderRadius: 12,
            padding: "18px 0", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-sans)",
            cursor: "pointer", letterSpacing: "-0.005em",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            boxShadow: `0 12px 24px -10px ${t.accent}77`,
          }}>
            Pull 20 questions  →
          </button>
          <div style={{ fontSize: 11, color: t.inkMute, textAlign: "center", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>~ 4 SECONDS</div>
        </div>
      </div>
    </LaptopShell>
  );
}
