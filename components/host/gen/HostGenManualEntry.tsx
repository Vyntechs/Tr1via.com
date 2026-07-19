// HOST · GENERATE · manual entry fallback
//
// Free-form: the host types her 7 questions herself. Used when Claude
// generation failed or when she wants to skip generation entirely.
//
// Order of entry is meaningful: row 1 becomes the 100-pointer and row 7
// the 700-pointer. The form makes that explicit with a permanent PointTag
// on every row.
//
// All props are optional with demo defaults so /dev/host/gen can render
// it standalone.

"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import {
  Eyebrow,
  Numeric,
  PointTag,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostGenManualQuestionInput {
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  imageUrl: string | null;
}

export interface HostGenManualEntryProps {
  themeKey?: ThemeKey;
  /** LaptopShell title (e.g. "type 7 · pixar movies"). */
  shellTitle?: string;
  /** Topic / category name. Drives the accent color and breadcrumb. */
  topic?: string;
  /** Eyebrow above the headline (e.g. "GAME 1 · SLOT 5 OF 6 · MANUAL"). */
  eyebrow?: string;
  /** Optional seed values (e.g. a partial in-progress draft). */
  initial?: HostGenManualQuestionInput[];
  /** Session-storage key used to restore an unfinished phone draft. */
  draftKey?: string;
  /** Called when the host submits 7 valid questions. */
  onSubmit?: (questions: HostGenManualQuestionInput[]) => void;
  /** Called when the host wants to bail back to generation / setup. */
  onCancel?: () => void;
  /** True while the POST is in flight. */
  isSubmitting?: boolean;
  /** Server-side error to surface above the buttons. */
  errorMessage?: string | null;
}

const POINT_VALUES = [100, 200, 300, 400, 500, 600, 700] as const;

function emptyRow(): HostGenManualQuestionInput {
  return {
    prompt: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    imageUrl: null,
  };
}

function defaultRows(): HostGenManualQuestionInput[] {
  return POINT_VALUES.map(() => emptyRow());
}

function normalizeRows(initial?: unknown): HostGenManualQuestionInput[] {
  if (!Array.isArray(initial)) return defaultRows();
  const merged = initial.slice(0, 7).map((candidate) => {
    const row =
      candidate !== null && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    const options = Array.isArray(row.options) ? row.options : [];
    const correctIndex =
      Number.isInteger(row.correctIndex) &&
      Number(row.correctIndex) >= 0 &&
      Number(row.correctIndex) <= 3
        ? (Number(row.correctIndex) as 0 | 1 | 2 | 3)
        : 0;
    return {
      prompt: typeof row.prompt === "string" ? row.prompt : "",
      options: [0, 1, 2, 3].map((index) =>
        typeof options[index] === "string" ? options[index] : "",
      ) as [string, string, string, string],
      correctIndex,
      imageUrl:
        typeof row.imageUrl === "string" || row.imageUrl === null
          ? row.imageUrl
          : null,
    };
  });
  while (merged.length < 7) merged.push(emptyRow());
  return merged;
}

function restoreManualDraft(
  draftKey: string | undefined,
  initial: HostGenManualQuestionInput[] | undefined,
): HostGenManualQuestionInput[] {
  if (!draftKey || typeof window === "undefined") return normalizeRows(initial);
  try {
    const saved = window.sessionStorage.getItem(draftKey);
    return saved ? normalizeRows(JSON.parse(saved) as unknown) : normalizeRows(initial);
  } catch {
    return normalizeRows(initial);
  }
}

export function HostGenManualEntry(props: HostGenManualEntryProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenManualEntryInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenManualEntryInner {...rest} />;
}

function HostGenManualEntryInner({
  topic = "Pixar Movies",
  eyebrow = "MANUAL ENTRY · 7 QUESTIONS",
  initial,
  draftKey,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage = null,
}: Omit<HostGenManualEntryProps, "themeKey">) {
  const { t } = useTheme();
  const mobile = useMediaQuery("(max-width: 860px)");
  const cc = categoryColor(topic, t.accent);

  const [rows, setRows] = useState<HostGenManualQuestionInput[]>(() =>
    restoreManualDraft(draftKey, initial),
  );
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!draftKey) return;
    try {
      window.sessionStorage.setItem(draftKey, JSON.stringify(rows));
    } catch {
      // Draft recovery is best-effort and must never block editing.
    }
  }, [draftKey, rows]);

  function updateRow(
    idx: number,
    patch: Partial<HostGenManualQuestionInput>,
  ) {
    setRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    );
  }

  function updateOption(idx: number, optIdx: number, value: string) {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = [...row.options] as [string, string, string, string];
        next[optIdx] = value;
        return { ...row, options: next };
      }),
    );
  }

  function setCorrect(idx: number, optIdx: 0 | 1 | 2 | 3) {
    updateRow(idx, { correctIndex: optIdx });
  }

  // ── validation ───────────────────────────────────────────────────────
  const rowsWithErrors = rows.map((row) => {
    const promptOk = row.prompt.trim().length >= 4;
    const optsTrimmed = row.options.map((o) => o.trim());
    const optsFilled = optsTrimmed.every((o) => o.length >= 1);
    const optsDistinct =
      new Set(optsTrimmed.map((o) => o.toLowerCase())).size === 4;
    const imageOk =
      row.imageUrl === null ||
      row.imageUrl.trim().length === 0 ||
      /^https?:\/\//i.test(row.imageUrl.trim());
    return { promptOk, optsFilled, optsDistinct, imageOk };
  });
  const allValid = rowsWithErrors.every(
    (e) => e.promptOk && e.optsFilled && e.optsDistinct && e.imageOk,
  );

  function handleSubmit() {
    setTouched(true);
    if (!allValid) return;
    const cleaned: HostGenManualQuestionInput[] = rows.map((row) => ({
      prompt: row.prompt.trim(),
      options: row.options.map((o) => o.trim()) as [
        string,
        string,
        string,
        string,
      ],
      correctIndex: row.correctIndex,
      imageUrl:
        row.imageUrl && row.imageUrl.trim().length > 0
          ? row.imageUrl.trim()
          : null,
    }));
    onSubmit?.(cleaned);
  }

  return (
    <LaptopShell>
      <div
        data-testid="host-gen-manual-layout"
        data-layout={mobile ? "mobile" : "desktop"}
        data-host-mobile-surface="true"
        style={{
          padding: mobile ? "16px" : "20px 56px 14px",
          borderBottom: `1px solid ${t.line}`,
          display: "flex",
          flexDirection: mobile ? "column" : "row",
          alignItems: mobile ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: mobile ? 12 : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 99,
              background: cc,
            }}
          />
          <div>
            <Eyebrow color={cc} size={11}>
              {eyebrow}
            </Eyebrow>
            <div
              style={{
                marginTop: 4,
                fontSize: 28,
                fontWeight: 700,
                color: t.ink,
                letterSpacing: "-0.02em",
              }}
            >
              Type your seven, easiest first.
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: t.inkMid,
              }}
            >
              Row 1 becomes the 100-pointer · Row 7 becomes the 700-pointer.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Eyebrow color={t.inkMute} size={10}>
            {rows.filter((r, i) => {
              const e = rowsWithErrors[i];
              return (
                e?.promptOk && e.optsFilled && e.optsDistinct && e.imageOk
              );
            }).length}
            /7 READY
          </Eyebrow>
        </div>
      </div>

      <div
        data-host-mobile-surface="true"
        style={{
          flex: 1,
          overflow: mobile ? "visible" : "auto",
          padding: mobile ? "18px 16px 24px" : "24px 56px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {rows.map((row, idx) => {
          const point = POINT_VALUES[idx]!;
          const e = rowsWithErrors[idx]!;
          const showErrors = touched;
          return (
            <div
              key={idx}
              style={{
                borderRadius: 14,
                border: `1.5px solid ${t.line}`,
                background: t.dark ? "rgba(244,230,196,.03)" : "#FFF",
                padding: mobile ? "16px" : "18px 20px",
                display: "grid",
                gridTemplateColumns: mobile ? "minmax(0, 1fr)" : "120px 1fr",
                gap: mobile ? 14 : 20,
                animation:
                  "tr1via-rise .35s cubic-bezier(.2,.7,.3,1) both",
                animationDelay: `${idx * 40}ms`,
              }}
            >
              <div style={{ display: "flex", flexDirection: mobile ? "row" : "column", alignItems: mobile ? "center" : undefined, justifyContent: mobile ? "space-between" : undefined, gap: 10 }}>
                <Eyebrow color={t.inkMute} size={9}>
                  ROW {idx + 1}
                </Eyebrow>
                <PointTag value={point} color={cc} size="md" />
                <div
                  style={{
                    fontSize: 11,
                    color: t.inkMute,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {idx === 0
                    ? "EASIEST"
                    : idx === 6
                      ? "HARDEST"
                      : `LEVEL ${idx + 1}`}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div>
                  <Eyebrow color={t.inkMute} size={9}>
                    QUESTION
                  </Eyebrow>
                  <textarea
                    aria-label={`Question prompt for row ${idx + 1}`}
                    value={row.prompt}
                    onChange={(ev: ChangeEvent<HTMLTextAreaElement>) =>
                      updateRow(idx, { prompt: ev.target.value })
                    }
                    rows={2}
                    placeholder="Type the question players will read off the TV…"
                    style={{
                      marginTop: 6,
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: `1.5px solid ${
                        showErrors && !e.promptOk ? t.wrong : cc
                      }`,
                      background: t.surface,
                      fontSize: 16,
                      color: t.ink,
                      fontWeight: 600,
                      letterSpacing: "-0.005em",
                      lineHeight: 1.35,
                      fontFamily: "var(--font-display)",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                  {showErrors && !e.promptOk && (
                    <FieldError color={t.wrong}>
                      Question is too short.
                    </FieldError>
                  )}
                </div>

                <div>
                  <Eyebrow color={t.inkMute} size={9}>
                    FOUR ANSWERS · TAP TO MARK CORRECT
                  </Eyebrow>
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {row.options.map((opt, optIdx) => {
                      const isCorrect = optIdx === row.correctIndex;
                      return (
                        <div
                          key={optIdx}
                          style={{
                            display: "flex",
                            flexWrap: mobile ? "wrap" : undefined,
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 10,
                            background: isCorrect
                              ? t.dark
                                ? `${t.correct}14`
                                : `${t.correct}10`
                              : t.surface,
                            border: `1.5px solid ${
                              isCorrect ? t.correct : t.line
                            }`,
                          }}
                        >
                          <Numeric
                            size={13}
                            weight={700}
                            color={isCorrect ? t.correct : t.inkMid}
                            style={{ minWidth: 14 }}
                          >
                            {optIdx + 1}
                          </Numeric>
                          <input
                            type="text"
                            aria-label={`Row ${idx + 1} option ${optIdx + 1}`}
                            value={opt}
                            onChange={(
                              ev: ChangeEvent<HTMLInputElement>,
                            ) => updateOption(idx, optIdx, ev.target.value)}
                            placeholder={`Option ${optIdx + 1}`}
                            style={{
                              flex: 1,
                              minWidth: mobile ? "calc(100% - 40px)" : undefined,
                              fontSize: 14,
                              color: t.ink,
                              fontWeight: 500,
                              background: "transparent",
                              border: "none",
                              outline: "none",
                              fontFamily: "var(--font-sans)",
                            }}
                          />
                          {isCorrect ? (
                            <span
                              style={{
                                padding: mobile ? "10px 12px" : "3px 9px",
                                borderRadius: 99,
                                background: t.correct,
                                color: "#0E0805",
                                fontFamily: "var(--font-mono)",
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: "0.08em",
                              }}
                            >
                              CORRECT
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setCorrect(idx, optIdx as 0 | 1 | 2 | 3)
                              }
                              aria-label={`Mark row ${idx + 1} option ${optIdx + 1} as correct`}
                              style={{
                                padding: "3px 9px",
                                borderRadius: 99,
                                border: `1px solid ${t.line}`,
                                color: t.inkMute,
                                fontFamily: "var(--font-mono)",
                                fontSize: 9,
                                fontWeight: 600,
                                letterSpacing: "0.08em",
                                cursor: "pointer",
                                background: "transparent",
                              }}
                            >
                              mark
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {showErrors && !e.optsFilled && (
                    <FieldError color={t.wrong}>
                      Fill in all four answer options.
                    </FieldError>
                  )}
                  {showErrors && e.optsFilled && !e.optsDistinct && (
                    <FieldError color={t.wrong}>
                      The four options must be distinct.
                    </FieldError>
                  )}
                </div>

                <div>
                  <Eyebrow color={t.inkMute} size={9}>
                    IMAGE URL · OPTIONAL
                  </Eyebrow>
                  <input
                    type="url"
                    aria-label={`Row ${idx + 1} optional image URL`}
                    value={row.imageUrl ?? ""}
                    onChange={(ev: ChangeEvent<HTMLInputElement>) =>
                      updateRow(idx, {
                        imageUrl:
                          ev.target.value.length === 0
                            ? null
                            : ev.target.value,
                      })
                    }
                    placeholder="https:// — paste a photo URL or leave blank"
                    style={{
                      marginTop: 6,
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${
                        showErrors && !e.imageOk ? t.wrong : t.line
                      }`,
                      background: t.surface,
                      fontSize: 13,
                      color: t.ink,
                      fontWeight: 500,
                      fontFamily: "var(--font-mono)",
                      outline: "none",
                    }}
                  />
                  {showErrors && !e.imageOk && (
                    <FieldError color={t.wrong}>
                      Image URL must start with http(s)://.
                    </FieldError>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        data-host-mobile-surface="true"
        style={{
          padding: mobile ? "14px 16px max(16px, env(safe-area-inset-bottom))" : "16px 56px 20px",
          borderTop: `1px solid ${t.line}`,
          display: "flex",
          flexDirection: mobile ? "column" : "row",
          alignItems: mobile ? "stretch" : "center",
          gap: 12,
          background: t.paper,
          position: mobile ? "sticky" : undefined,
          bottom: mobile ? 0 : undefined,
          zIndex: mobile ? 5 : undefined,
        }}
      >
        {errorMessage && (
          <div
            role="alert"
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              background: t.dark
                ? "rgba(156,47,47,.16)"
                : "rgba(156,47,47,.08)",
              border: `1px solid ${
                t.dark ? "rgba(255,140,120,.28)" : "rgba(156,47,47,.30)"
              }`,
              color: t.ink,
              fontSize: 12.5,
              fontWeight: 500,
            }}
          >
            {errorMessage}
          </div>
        )}
        {!errorMessage && (
          <div
            style={{
              flex: 1,
              fontSize: 12.5,
              color: t.inkMid,
            }}
          >
            {touched && !allValid
              ? "Fix the highlighted rows, then lock your category."
              : "Order matters — easiest first. You can still edit anything later."}
          </div>
        )}
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "12px 18px",
            minHeight: mobile ? 48 : undefined,
            borderRadius: 10,
            border: `1px solid ${t.line}`,
            background: "transparent",
            color: t.inkMid,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || (touched && !allValid)}
          style={{
            padding: "12px 24px",
            minHeight: mobile ? 52 : undefined,
            borderRadius: 10,
            border: "none",
            background: allValid ? t.accent : t.surface,
            color: allValid ? "#FFF" : t.inkMute,
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "var(--font-sans)",
            cursor:
              isSubmitting || (touched && !allValid)
                ? "not-allowed"
                : "pointer",
            opacity: isSubmitting ? 0.7 : 1,
            boxShadow: allValid
              ? `0 10px 22px -10px ${t.accent}77`
              : "none",
          }}
        >
          {isSubmitting ? "Saving…" : "Lock the category  →"}
        </button>
      </div>
    </LaptopShell>
  );
}

function FieldError({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 4,
        fontSize: 11,
        color,
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </div>
  );
}
