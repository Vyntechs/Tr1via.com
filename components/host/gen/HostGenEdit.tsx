// HOST · GENERATE · 5. EDIT
// Inline panel. The question text + 4 options + image, all editable. Slides
// in from the right of the pick workspace; the workspace dims behind.
//
// Wired form: the pick route passes the live question being edited + a
// `onSave`/`onClose`/`onSwapImage` set of handlers. The panel maintains
// its own local editing state and submits the diff on Save.

"use client";

import { useState } from "react";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { StockImage } from "./_shared";

export interface HostGenEditValues {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  /** Host-placed slot on the board (100..700) or null to let the
   *  lock-time auto-assign choose. The `difficulty` field is still on
   *  the underlying row but no longer host-facing — Claude's rating
   *  becomes a tiebreaker for picks the host hasn't placed manually. */
  pointValue: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
}

export interface HostGenEditProps {
  themeKey?: ThemeKey;
  /** Topic, used for the category color and the breadcrumb. */
  topic?: string;
  /** Eyebrow text (e.g. "EDIT QUESTION · 6 OF 20"). */
  eyebrow?: string;
  /** Title for the shell chrome. */
  shellTitle?: string;
  /** Initial values for the form. */
  initial?: HostGenEditValues;
  /** Photo URL or seed for the placeholder. */
  imageSeed?: string;
  /** Called when the host saves. Receives the (possibly modified) values. */
  onSave?: (values: HostGenEditValues) => void;
  /** Called when the host closes / discards. */
  onClose?: () => void;
  /**
   * Called when the host taps "Swap image →". Receives the current in-progress
   * edit values so the parent can persist them BEFORE this modal unmounts —
   * otherwise the local form state is destroyed and the host's text/options/
   * correct-mark/point edits silently vanish when the swap modal takes over.
   */
  onSwapImage?: (values: HostGenEditValues) => void;
  /** True while the PATCH is in flight. */
  isSaving?: boolean;
}

const DEMO_INITIAL: HostGenEditValues = {
  prompt: "Ratatouille is set in which city?",
  options: ["Paris", "Lyon", "Marseille", "Nice"],
  correctIndex: 0,
  pointValue: 200,
};

export function HostGenEdit(props: HostGenEditProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenEditInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenEditInner {...rest} />;
}

function HostGenEditInner({
  topic = "Pixar Movies",
  eyebrow = "EDIT QUESTION · 6 OF 20",
  shellTitle = "edit · pixar movies · q6",
  initial = DEMO_INITIAL,
  imageSeed = "pixar6",
  onSave,
  onClose,
  onSwapImage,
  isSaving = false,
}: Omit<HostGenEditProps, "themeKey">) {
  const { t } = useTheme();
  const mobile = useMediaQuery("(max-width: 860px)");
  const cc = categoryColor(topic, t.accent);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [options, setOptions] = useState<[string, string, string, string]>(initial.options);
  const [correctIndex, setCorrectIndex] = useState<0 | 1 | 2 | 3>(initial.correctIndex);
  const [pointValue, setPointValue] = useState<HostGenEditValues["pointValue"]>(
    initial.pointValue,
  );

  function updateOption(idx: number, value: string) {
    setOptions((prev) => {
      const next = [...prev] as [string, string, string, string];
      next[idx] = value;
      return next;
    });
  }

  function handleSave() {
    onSave?.({ prompt, options, correctIndex, pointValue });
  }

  function handleSwapImage() {
    onSwapImage?.({ prompt, options, correctIndex, pointValue });
  }

  return (
    <LaptopShell>
      <div
        data-testid="host-gen-edit-layout"
        data-layout={mobile ? "mobile" : "desktop"}
        data-host-mobile-surface="true"
        style={{ flex: 1, display: "grid", gridTemplateColumns: mobile ? "minmax(0, 1fr)" : "1fr 540px", overflow: mobile ? "visible" : "hidden", minWidth: 0 }}
      >
        {/* Dimmed background — the pick workspace fading */}
        <div style={{ background: t.paper, padding: "24px 56px", opacity: 0.35, pointerEvents: "none", display: mobile ? "none" : "flex", flexDirection: "column", gap: 12 }}>
          <Eyebrow color={t.accent} size={11}>{topic.toUpperCase()}</Eyebrow>
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
          borderLeft: mobile ? "none" : `1px solid ${t.line}`,
          padding: mobile ? "18px 16px max(24px, env(safe-area-inset-bottom))" : "28px 32px", display: "flex", flexDirection: "column", gap: 18,
          overflow: mobile ? "visible" : "auto",
          boxShadow: mobile ? "none" : "-20px 0 60px -20px rgba(0,0,0,.3)",
          minWidth: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Eyebrow color={cc} size={11}>{eyebrow}</Eyebrow>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close question editor"
              style={{ background: "transparent", border: "none", color: t.inkMid, cursor: "pointer", fontSize: 18, width: mobile ? 44 : undefined, minHeight: mobile ? 44 : undefined }}
            >
              ×
            </button>
          </div>

          <div>
            <Eyebrow color={t.inkMute} size={9}>QUESTION</Eyebrow>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              style={{
                marginTop: 8, width: "100%", padding: "14px 16px", borderRadius: 10,
                border: `1.5px solid ${cc}`, background: t.surface,
                fontSize: 18, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35,
                fontFamily: "var(--font-display)",
                resize: "vertical", outline: "none",
              }}
            />
          </div>

          <div>
            <Eyebrow color={t.inkMid} size={11}>FOUR ANSWERS · CLICK ANY ROW TO MARK IT CORRECT</Eyebrow>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((o, i) => {
                const isCorrect = i === correctIndex;
                return (
                  <div
                    key={i}
                    role="radio"
                    aria-checked={isCorrect}
                    onClick={(e) => {
                      // Click anywhere on the row (except the text input itself)
                      // marks this option as the correct one. Editing option
                      // text still works via the input.
                      if ((e.target as HTMLElement).tagName === "INPUT") return;
                      setCorrectIndex(i as 0 | 1 | 2 | 3);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, flexWrap: mobile ? "wrap" : undefined,
                      padding: "12px 14px", borderRadius: 10,
                      background: isCorrect ? (t.dark ? `${t.correct}12` : `${t.correct}10`) : t.surface,
                      border: `1.5px solid ${isCorrect ? t.correct : t.line}`,
                      cursor: isCorrect ? "default" : "pointer",
                    }}
                  >
                    <Numeric size={14} weight={700} color={isCorrect ? t.correct : t.inkMid} style={{ minWidth: 14 }}>{i + 1}</Numeric>
                    <input
                      type="text"
                      value={o}
                      onChange={(e) => updateOption(i, e.target.value)}
                      style={{
                        flex: 1, minWidth: mobile ? "calc(100% - 46px)" : undefined, fontSize: 14, color: t.ink, fontWeight: 500,
                        background: "transparent", border: "none", outline: "none",
                        fontFamily: "var(--font-sans)",
                      }}
                    />
                    {isCorrect ? (
                      <span style={{ padding: "5px 12px", borderRadius: 99, background: t.correct, color: "#0E0805", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}>✓ CORRECT</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCorrectIndex(i as 0 | 1 | 2 | 3);
                        }}
                        style={{ padding: "5px 12px", borderRadius: 99, border: `1.5px solid ${t.correct}`, color: t.correct, fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", cursor: "pointer", background: "transparent", marginLeft: mobile ? 26 : undefined }}
                      >
                        Make correct
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0, 1fr)" : "180px 1fr", gap: 16, alignItems: "flex-start" }}>
            <div>
              <Eyebrow color={t.inkMute} size={9}>IMAGE · AUTO-MATCHED</Eyebrow>
              <div style={{ marginTop: 8 }}>
                <StockImage seed={imageSeed} height={120} radius="10px" />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: t.inkMid, lineHeight: 1.45 }}>
                Picked to fit this question from your library.
              </div>
              <button
                type="button"
                onClick={handleSwapImage}
                disabled={isSaving}
                style={{ marginTop: 8, width: "100%", padding: "8px 0", borderRadius: 8, border: `1px solid ${t.line}`, background: "transparent", color: t.ink, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: isSaving ? "default" : "pointer", opacity: isSaving ? 0.6 : 1 }}
              >
                Swap image  →
              </button>
            </div>

            <div>
              <Eyebrow color={t.inkMute} size={9}>POINT VALUE · PICK ONE</Eyebrow>
              <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 10, background: t.surface }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <Numeric size={28} weight={700} color={cc}>
                    {pointValue ?? "—"}
                  </Numeric>
                  <span style={{ fontSize: 11, color: t.inkMid, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
                    {pointValue === null ? "AUTO ON LOCK" : "PLACED"}
                  </span>
                </div>
                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: mobile ? "repeat(4, minmax(0, 1fr))" : "repeat(7, 1fr)", gap: 6 }}>
                  {([100, 200, 300, 400, 500, 600, 700] as const).map((v) => {
                    const active = v === pointValue;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setPointValue(v)}
                        style={{
                          padding: "8px 0",
                          borderRadius: 6,
                          border: `1px solid ${active ? cc : t.line}`,
                          background: active ? cc : "transparent",
                          color: active ? "#0E0805" : t.inkMid,
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          cursor: "pointer",
                        }}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 11, color: t.inkMute, fontWeight: 500, flex: 1 }}>
                    Pick a slot already taken? Whatever was there moves to yours.
                  </div>
                  <button
                    type="button"
                    onClick={() => setPointValue(null)}
                    disabled={pointValue === null}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${t.line}`,
                      background: "transparent",
                      color: pointValue === null ? t.inkMute : t.ink,
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font-sans)",
                      cursor: pointValue === null ? "default" : "pointer",
                      opacity: pointValue === null ? 0.55 : 1,
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: mobile ? "column-reverse" : "row", gap: 8, paddingTop: 18, borderTop: `1px solid ${t.line}`, position: mobile ? "sticky" : undefined, bottom: mobile ? "max(0px, env(safe-area-inset-bottom))" : undefined, background: t.paper, zIndex: mobile ? 4 : undefined }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: "12px 0", minHeight: mobile ? 48 : undefined, borderRadius: 10, border: `1px solid ${t.line}`, background: "transparent", color: t.inkMid, fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              style={{
                flex: 2, padding: "12px 0", minHeight: mobile ? 52 : undefined, borderRadius: 10, border: "none",
                background: t.accent, color: "#FFF",
                fontSize: 13, fontWeight: 700, fontFamily: "var(--font-sans)",
                cursor: isSaving ? "default" : "pointer",
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? "Saving…" : "Save · this question"}
            </button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
