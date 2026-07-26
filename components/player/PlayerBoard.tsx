"use client";

// PlayerBoard — a read-only view of the game board for the player's phone.
//
// The venue TV is the shared board, but not every seat can see it. This gives
// a player the same board on their own phone (categories × point values, played
// cells dimmed) so they're never dependent on a line of sight to the TV. It is
// strictly read-only: players never pick — only the host does.

import { useMemo } from "react";
import { Eyebrow, ThemeProvider, useTheme } from "@/components/system";
import type { CategoryRow, QuestionRow } from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";

const CLASSIC_VALUES = [100, 200, 300, 400, 500, 600, 700] as const;

export interface PlayerBoardProps {
  categories: CategoryRow[];
  questions: QuestionRow[];
  themeKey?: ThemeKey;
}

export function PlayerBoard({ themeKey, ...props }: PlayerBoardProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <PlayerBoardInner {...props} />
      </ThemeProvider>
    );
  }
  return <PlayerBoardInner {...props} />;
}

function PlayerBoardInner({ categories, questions }: Omit<PlayerBoardProps, "themeKey">) {
  const { t } = useTheme();
  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  );
  const questionByCell = useMemo(
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
    <section aria-labelledby="player-board-heading" style={{ minWidth: 0 }}>
      <Eyebrow color={t.accent} size={10}>
        On the board
      </Eyebrow>
      <h2
        id="player-board-heading"
        style={{
          margin: "5px 0 12px",
          color: t.ink,
          fontSize: 20,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
        }}
      >
        What&rsquo;s left
      </h2>

      <div
        role="grid"
        aria-label="Game board"
        aria-readonly="true"
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
              minHeight: 40,
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
            const question = questionByCell.get(`${category.id}:${value}`);
            const played = Boolean(question?.played_at);
            const missing = !question;
            const stateLabel = played ? " · played" : missing ? " · not in play" : "";
            return (
              <div
                key={`${category.id}:${value}`}
                role="gridcell"
                aria-colindex={categoryIndex + 1}
                aria-rowindex={rowIndex + 2}
                aria-label={`${category.name} for ${value}${stateLabel}`}
                style={{
                  minWidth: 0,
                  minHeight: 40,
                  display: "grid",
                  placeItems: "center",
                  padding: "8px 3px",
                  borderRadius: 10,
                  border: `1px solid ${played || missing ? t.lineSoft : t.line}`,
                  background: played || missing ? "transparent" : t.surface,
                  color: played || missing ? t.inkMute : t.ink,
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  fontWeight: 800,
                  lineHeight: 1,
                  boxSizing: "border-box",
                  opacity: played ? 0.5 : missing ? 0.35 : 1,
                }}
              >
                {missing ? "—" : played ? "✓" : value}
              </div>
            );
          }),
        )}
      </div>
    </section>
  );
}
