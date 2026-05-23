// HOST · GENERATE · 2. TOPIC ENTRY
// Typing into an empty slot. Autocomplete from Linda's history; repeat
// warning surfaces inline. Difficulty + Flavor settings ride in the right rail.
//
// Wired form: controlled topic text + difficulty + flavor selections. The
// setup route owns the state and submits to POST /api/categories. All props
// are optional with demo defaults so the /dev/host/gen gallery still
// renders.

"use client";

import { useState, type FormEvent } from "react";
import {
  Display,
  Eyebrow,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import type { ThemeKey } from "@/lib/theme/tokens";

export type DifficultyTarget = "easy" | "normal" | "hard";

export interface RecentTopic {
  name: string;
  /** Display label (e.g. "Apr 2"). */
  date: string;
  /** True if Linda has already used this exact topic. Surfaces the warning rail. */
  used?: boolean;
}

export interface HostGenTopicEntryProps {
  themeKey?: ThemeKey;
  /** Title shown in the LaptopShell chrome (e.g. "set up tonight · slot 5"). */
  shellTitle?: string;
  /** Eyebrow over the headline (e.g. "GAME 1 · SLOT 5 OF 6"). */
  eyebrow?: string;
  /** Recent topics, used both for autocomplete and as the "your last topics" rail. */
  recent?: RecentTopic[];
  /** Initial topic value. */
  initialTopic?: string;
  /** Initial difficulty target. */
  initialDifficulty?: DifficultyTarget;
  /** Initial flavor selections. */
  initialFlavor?: string[];
  /** Submit handler: receives the trimmed topic + difficulty + flavor. */
  onSubmit?: (input: {
    topic: string;
    difficulty: DifficultyTarget;
    flavor: string[];
  }) => void;
  /** True while the underlying POST is in flight. */
  isSubmitting?: boolean;
  /** Warning shown beneath the input (e.g. "you ran this on April 2"). */
  warning?: string | null;
}

const DEMO_RECENT: RecentTopic[] = [
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

const FLAVOR_OPTIONS = [
  "Sharper",
  "More obscure",
  "More pop",
  "More local",
  "Fresher",
] as const;

export function HostGenTopicEntry(props: HostGenTopicEntryProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenTopicEntryInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenTopicEntryInner {...rest} />;
}

function HostGenTopicEntryInner({
  shellTitle = "set up tonight · slot 5",
  eyebrow = "GAME 1 · SLOT 5 OF 6",
  recent = DEMO_RECENT,
  initialTopic = "",
  initialDifficulty = "normal",
  initialFlavor = [],
  onSubmit,
  isSubmitting = false,
  warning = null,
}: Omit<HostGenTopicEntryProps, "themeKey">) {
  const { t } = useTheme();
  const [topic, setTopic] = useState(initialTopic);
  const [difficulty, setDifficulty] = useState<DifficultyTarget>(initialDifficulty);
  const [flavor, setFlavor] = useState<string[]>(initialFlavor);

  function toggleFlavor(label: string) {
    setFlavor((prev) =>
      prev.includes(label) ? prev.filter((f) => f !== label) : [...prev, label],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed) return;
    onSubmit?.({ topic: trimmed, difficulty, flavor });
  }

  return (
    <LaptopShell title={shellTitle}>
      <form
        onSubmit={handleSubmit}
        style={{ padding: "40px 56px", flex: 1, display: "grid", gridTemplateColumns: "1fr 300px", gap: 40 }}
      >
        <div>
          <Eyebrow color={t.accent} size={11}>{eyebrow}</Eyebrow>
          <Display size={48} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            What&apos;s the topic?
          </Display>
          <div style={{ marginTop: 8, color: t.inkMid, fontSize: 14, lineHeight: 1.45, maxWidth: 540 }}>
            Anything. A movie franchise, a sports league, your town, a decade. The more specific, the sharper the questions.
          </div>

          <div style={{ marginTop: 36, paddingBottom: 18, borderBottom: `2px solid ${t.accent}` }}>
            <input
              type="text"
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Pixar Movies"
              disabled={isSubmitting}
              style={{
                width: "100%",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 64,
                color: t.ink,
                letterSpacing: "-0.035em",
                lineHeight: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                padding: 0,
              }}
            />
          </div>

          {warning && (
            <div style={{ marginTop: 16, padding: "14px 16px", borderRadius: 10, background: t.surface, border: `1px solid ${t.wrong}55`, display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ width: 4, alignSelf: "stretch", background: t.wrong, borderRadius: 99 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: t.ink, fontWeight: 600 }}>{warning}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid }}>Same topic, fresh questions. Same room may not see it again.</div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 32 }}>
            <Eyebrow color={t.inkMute} size={10}>YOUR LAST TOPICS</Eyebrow>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {recent.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setTopic(c.name)}
                  style={{
                    padding: "6px 12px", borderRadius: 99,
                    background: c.used ? t.accent : "transparent",
                    color: c.used ? "#0E0805" : t.ink,
                    border: `1px solid ${c.used ? t.accent : t.line}`,
                    fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)",
                    display: "flex", alignItems: "center", gap: 6,
                    cursor: "pointer",
                  }}
                >
                  {c.name}
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: 10, opacity: c.used ? 0.7 : 0.55 }}>{c.date}</span>
                </button>
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
                {(["easy", "normal", "hard"] as const).map((d) => {
                  const active = d === difficulty;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 8,
                        border: `1px solid ${active ? t.ink : t.line}`,
                        background: active ? t.ink : "transparent",
                        color: active ? t.paper : t.ink,
                        fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: t.inkMid, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Flavor (optional)</div>
              <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {FLAVOR_OPTIONS.map((s) => {
                  const active = flavor.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleFlavor(s)}
                      style={{
                        padding: "6px 10px", borderRadius: 99, border: `1px solid ${active ? t.ink : t.line}`,
                        background: active ? t.ink : "transparent",
                        color: active ? t.paper : t.inkMid,
                        fontSize: 11, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || topic.trim().length === 0}
            style={{
              marginTop: "auto",
              background: t.accent, color: "#FFF", border: "none", borderRadius: 12,
              padding: "18px 0", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-sans)",
              cursor: isSubmitting ? "default" : "pointer", opacity: isSubmitting || !topic.trim() ? 0.7 : 1,
              letterSpacing: "-0.005em",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              boxShadow: `0 12px 24px -10px ${t.accent}77`,
            }}
          >
            {isSubmitting ? "Saving…" : "Pull 20 questions  →"}
          </button>
          <div style={{ fontSize: 11, color: t.inkMute, textAlign: "center", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>~ 4 SECONDS</div>
        </div>
      </form>
    </LaptopShell>
  );
}
