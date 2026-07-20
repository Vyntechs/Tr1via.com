"use client";

import { useMemo } from "react";
import { Eyebrow, useTheme } from "@/components/system";
import type { CategoryRow, QuestionRow } from "@/lib/supabase/types";

const CLASSIC_VALUES = [100, 200, 300, 400, 500, 600, 700] as const;

export interface HostPhoneBoardProps {
  categories: CategoryRow[];
  questions: QuestionRow[];
  selectedQuestionId: string | null;
  onSelect: (questionId: string) => void;
}

export function HostPhoneBoard({
  categories,
  questions,
  selectedQuestionId,
  onSelect,
}: HostPhoneBoardProps) {
  const { t } = useTheme();
  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  );
  const questionsByCell = useMemo(
    () =>
      new Map(
        questions
          .filter((question) => question.is_picked)
          .map((question) => [
            `${question.category_id}:${question.point_value ?? question.difficulty * 100}`,
            question,
          ]),
      ),
    [questions],
  );

  return (
    <section aria-labelledby="phone-board-heading" style={{ minWidth: 0 }}>
      <Eyebrow color={t.accent} size={10}>
        Pick a question
      </Eyebrow>
      <h1
        id="phone-board-heading"
        style={{
          margin: "5px 0 14px",
          color: t.ink,
          fontSize: 22,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
        }}
      >
        Game board
      </h1>

      <div
        role="grid"
        aria-label="Question board"
        aria-colcount={orderedCategories.length}
        aria-rowcount={CLASSIC_VALUES.length + 1}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(orderedCategories.length, 1)}, minmax(0, 1fr))`,
          gap: 6,
          width: "100%",
          minWidth: 0,
        }}
      >
        {orderedCategories.map((category, categoryIndex) => (
          <div
            key={category.id}
            role="columnheader"
            aria-colindex={categoryIndex + 1}
            style={{
              minWidth: 0,
              minHeight: 48,
              padding: "8px 4px",
              borderRadius: 10,
              background: t.surfaceH,
              color: t.ink,
              display: "grid",
              placeItems: "center",
              boxSizing: "border-box",
              textAlign: "center",
              fontSize: 11,
              fontWeight: 750,
              lineHeight: 1.12,
              overflowWrap: "anywhere",
            }}
          >
            {category.name}
          </div>
        ))}

        {CLASSIC_VALUES.flatMap((value, rowIndex) =>
          orderedCategories.map((category, categoryIndex) => {
            const question = questionsByCell.get(`${category.id}:${value}`);
            const played = Boolean(question?.played_at);
            const missing = !question;
            const disabled = missing || played;
            const selected = question?.id === selectedQuestionId;
            const stateLabel = played ? " · Played" : missing ? " · Not available" : "";

            return (
              <div
                key={`${category.id}:${value}`}
                role="gridcell"
                aria-colindex={categoryIndex + 1}
                aria-rowindex={rowIndex + 2}
                style={{ minWidth: 0 }}
              >
                <button
                  type="button"
                  aria-label={`${category.name} for ${value} points${stateLabel}`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => question && onSelect(question.id)}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    minHeight: 48,
                    padding: "8px 3px",
                    borderRadius: 10,
                    border: `1px solid ${selected ? t.pop : t.line}`,
                    background: disabled ? t.surface : selected ? t.pop : t.accent,
                    color: disabled ? t.inkMute : t.paper,
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    fontWeight: 800,
                    lineHeight: 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.72 : 1,
                  }}
                >
                  {played ? "Played" : missing ? "—" : value}
                </button>
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}
