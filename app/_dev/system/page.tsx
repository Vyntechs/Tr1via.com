// Internal design-system gallery. Browse every atom, every theme, every
// weather pattern. Replaces the Claude Design canvas's /design-canvas route.
//
// Visit at /_dev/system in dev. Pick a theme from the dropdown to see all
// atoms adapt live.

"use client";

import { useState } from "react";
import {
  useTheme,
  Wordmark,
  Display,
  Eyebrow,
  Numeric,
  Rule,
  PointTag,
  AnswerCard,
  TimerRing,
  TVTimerArc,
  QRBlock,
  Weather,
  weatherLabel,
} from "@/components/system";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import { TR1VIA_CATEGORIES, categoryColor } from "@/lib/theme/categories";

export default function SystemGallery() {
  const { themeKey, setThemeKey, t } = useTheme();

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 48px",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Weather themeKey={themeKey} intensity={0.5} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <Wordmark size={36} />
          <select
            value={themeKey}
            onChange={(e) => setThemeKey(e.target.value as ThemeKey)}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${t.line}`,
              background: t.surface,
              color: t.ink,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {THEME_KEYS.map((k) => (
              <option key={k} value={k} style={{ background: t.paper, color: t.ink }}>
                {TR1VIA_THEMES[k].name}
              </option>
            ))}
          </select>
        </div>

        <Section title="01 · Brand mark · the '1' is the brand">
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "flex-start" }}>
              <Wordmark size={88} />
              <Wordmark size={36} />
              <Wordmark size={16} />
            </div>
          </Card>
        </Section>

        <Section title="02 · Display voice · Bricolage Grotesque · hero only">
          <Card>
            <Display size={72} color={t.ink}>
              Pizza, <span style={{ color: t.accent }}>beer,</span>{" "}
              <span style={{ color: t.pop }}>bragging rights.</span>
            </Display>
          </Card>
        </Section>

        <Section title="03 · Eyebrow · mono caps · 0.16em tracking">
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Eyebrow size={14}>QUESTION 10 · GEOGRAPHY</Eyebrow>
              <Eyebrow size={11} color={t.inkMid}>HOST · LINDA</Eyebrow>
              <Eyebrow size={10} color={t.inkMute}>SEE YOU NEXT WEDNESDAY</Eyebrow>
            </div>
          </Card>
        </Section>

        <Section title="04 · Numeric · tabular nums · for live numbers only">
          <Card>
            <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
              <Numeric size={64} weight={700} color={t.accent}>2,140</Numeric>
              <Numeric size={32} color={t.ink}>1.2s</Numeric>
              <Numeric size={20} color={t.inkMid}>K9·PR4M</Numeric>
            </div>
          </Card>
        </Section>

        <Section title="05 · PointTag · category-colored chunky chips">
          <Card>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <PointTag value={100} color={categoryColor("Geography")} />
              <PointTag value={300} color={categoryColor("Music")} />
              <PointTag value={500} color={categoryColor("History")} />
              <PointTag value={700} color={categoryColor("Movies")} size="lg" />
            </div>
          </Card>
        </Section>

        <Section title="06 · Rule">
          <Card>
            <Rule color={t.ink} />
            <div style={{ height: 12 }} />
            <Rule color={t.accent} />
          </Card>
        </Section>

        <Section title="07 · AnswerCard · 6 states">
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <AnswerCard n={1} text="Florida" accent={categoryColor("Geography")} state="idle" />
              <AnswerCard n={2} text="Alaska" accent={categoryColor("Geography")} state="locked-self" />
              <AnswerCard n={3} text="California" accent={categoryColor("Geography")} state="locked-other" />
              <AnswerCard n={4} text="Maine" accent={categoryColor("Geography")} state="idle" />
              <AnswerCard n={2} text="Alaska" accent={categoryColor("Geography")} state="correct" />
              <AnswerCard n={1} text="Florida" accent={categoryColor("Geography")} state="wrong" />
              <AnswerCard n={2} text="Alaska" accent={categoryColor("Geography")} state="missed-correct" />
            </div>
          </Card>
        </Section>

        <Section title="08 · Timers · phone + TV">
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
              <TimerRing seconds={18} accent={categoryColor("Geography")} />
              <TimerRing seconds={11} accent={categoryColor("Music")} />
              <TimerRing seconds={4} accent={categoryColor("History")} />
              <TVTimerArc seconds={14} accent={categoryColor("Movies")} size={120} />
            </div>
          </Card>
        </Section>

        <Section title="09 · QR · real qrcode-package SVG">
          <Card>
            <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
              <QRBlock url="https://tr1via.com/join/K9PR4M" size={180} light />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Eyebrow color={t.inkMute} size={10}>ROOM CODE</Eyebrow>
                <Numeric size={36} weight={700} color={t.accent} tracking={-0.02}>K9·PR4M</Numeric>
                <span style={{ color: t.inkMid, fontSize: 13 }}>tr1via.com</span>
              </div>
            </div>
          </Card>
        </Section>

        <Section title="10 · Category color tokens">
          <Card>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {TR1VIA_CATEGORIES.map((c) => (
                <span
                  key={c.name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 99,
                    background: t.surface,
                  }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 99, background: c.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: t.ink }}>{c.name}</span>
                </span>
              ))}
            </div>
          </Card>
        </Section>

        <Section title={`11 · Weather · ${weatherLabel(themeKey)}`}>
          <Card>
            <div style={{ position: "relative", height: 240, overflow: "hidden", borderRadius: 12, background: t.paper, border: `1px solid ${t.line}` }}>
              <Weather themeKey={themeKey} intensity={1} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: t.inkMute, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                {TR1VIA_THEMES[themeKey].name}
              </div>
            </div>
          </Card>
        </Section>

        <Section title="12 · Twelve months · poster grid (cycle the dropdown)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {THEME_KEYS.map((k) => (
              <ThemePosterMini key={k} themeKey={k} active={k === themeKey} onClick={() => setThemeKey(k)} />
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <section style={{ margin: "40px 0" }}>
      <Eyebrow color={t.inkMid} size={11} style={{ display: "block", marginBottom: 14 }}>
        {title}
      </Eyebrow>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <div
      style={{
        padding: "28px 32px",
        borderRadius: 14,
        border: `1px solid ${t.line}`,
        background: t.surface,
      }}
    >
      {children}
    </div>
  );
}

function ThemePosterMini({ themeKey, active, onClick }: { themeKey: ThemeKey; active: boolean; onClick: () => void }) {
  const meta = TR1VIA_THEMES[themeKey];
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        height: 120,
        borderRadius: 12,
        border: active ? `2px solid ${meta.accent}` : `1px solid rgba(0,0,0,.08)`,
        background: meta.paper,
        color: meta.ink,
        overflow: "hidden",
        cursor: "pointer",
        padding: 12,
        textAlign: "left",
        fontFamily: "var(--font-sans)",
      }}
    >
      <Weather themeKey={themeKey} intensity={0.6} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, opacity: 0.6, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {meta.name}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {[meta.paper, meta.ink, meta.accent, meta.pop, meta.correct].map((c, i) => (
            <span key={i} style={{ width: 12, height: 12, borderRadius: 99, background: c, border: "1px solid rgba(0,0,0,.1)" }} />
          ))}
        </div>
      </div>
    </button>
  );
}
