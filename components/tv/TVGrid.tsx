// TV — the grid. Each category column = its color. Big, weighty board.
// One selected cell (host's pick) glows. Played cells are dashed-out and
// struck through. Sidebar shows leader, board status, and the pick that's
// loading.
//
// Driven by props so the live `/tv/[code]` route can feed real category +
// question state. Falls back to a designer-friendly demo for `/dev/tv`.

"use client";

import { TVStage, TVHeader, TVFooter } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVGridCell {
  /** True when the question at (column, row) has been played and resolved. */
  played: boolean;
  /** True when the host has selected this cell — pulses with the accent color. */
  selected: boolean;
  /** Point value displayed in the cell, e.g. 100 ... 700. */
  value: number;
  /** Underlying question id. Required for cells the host can click via
   *  `onCellClick`; omit (or set null) on the audience-only TV route. */
  questionId?: string | null;
}

export interface TVGridLeader {
  name: string;
  score: number;
}

export interface TVGridProps {
  themeKey?: ThemeKey;
  /** Header copy left side, e.g. "GAME 1 · ROUND 3 · 32 PLAYERS". */
  gameStatusLine?: string;
  /** Header copy right side, e.g. "10 OF 42 ANSWERED". */
  rightHeaderLine?: string;
  /** Category names, left to right. */
  categories?: string[];
  /**
   * Cells indexed [column][row] — outer length = categories.length, inner
   * length = values.length. If omitted, a designer demo board is shown.
   */
  cells?: TVGridCell[][];
  /** Point values shown down the column, e.g. [100, 200, ..., 700]. */
  values?: number[];
  /** Top-of-leaderboard for the right sidebar. */
  leader?: TVGridLeader;
  /** Total remaining cells number for the bottom-right line. */
  boardLeft?: number;
  /** Footer left, e.g. "WAITING ON LINDA". */
  footerLeft?: string;
  /** Footer right — usually `TR1VIA.COM · K9·PR4M`. */
  footerRight?: string;
  /** Optional "up next" sidebar card; null hides it. */
  upNext?: { category: string; value: number; sub?: string } | null;
  /** When provided, unplayed cells with a `questionId` render as buttons —
   *  click fires the callback with that id. The host laptop uses this to
   *  let the first host tap cells directly on the same surface patrons watch on
   *  the HDMI'd TV, so the venue screen never shows separate host chrome.
   *  Omit on the standalone `/tv/[code]` route to keep cells inert. */
  onCellClick?: (questionId: string) => void;
}

export const DEMO_CATEGORIES = ["Geography", "Animals", "Food", "Movies", "Music", "History"];
export const DEMO_VALUES = [100, 200, 300, 400, 500, 600, 700];
const DEMO_PLAYED = new Set(["0-0", "0-1", "1-0", "2-0", "3-0", "4-0", "1-1", "3-1", "5-0", "5-1"]);
const DEMO_SELECTED = "2-2";

function demoCells(): TVGridCell[][] {
  return DEMO_CATEGORIES.map((_, cIdx) =>
    DEMO_VALUES.map((v, rIdx) => ({
      played: DEMO_PLAYED.has(`${cIdx}-${rIdx}`),
      selected: `${cIdx}-${rIdx}` === DEMO_SELECTED,
      value: v,
    })),
  );
}

export function TVGrid({ themeKey, ...rest }: TVGridProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVGridInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVGridInner {...rest} />;
}

function TVGridInner({
  gameStatusLine = "",
  rightHeaderLine = "",
  categories = [],
  cells,
  values = [],
  leader,
  boardLeft = 0,
  footerLeft = "",
  footerRight = "",
  upNext,
  onCellClick,
}: Omit<TVGridProps, "themeKey">) {
  const { t } = useTheme();
  const board = cells ?? [];

  return (
    <TVStage data-testid="tv-grid">
      <TVHeader left={gameStatusLine} right={rightHeaderLine} />

      <div
        style={{
          flex: 1,
          padding: "20px 56px 0",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 36,
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Category row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${categories.length}, 1fr)`,
              gap: 8,
              marginBottom: 10,
            }}
          >
            {categories.map((c) => {
              const cc = categoryColor(c, t.accent);
              return (
                <div
                  key={c}
                  style={{
                    padding: "14px 12px",
                    borderRadius: 10,
                    background: cc,
                    color: "#0E0805",
                    textAlign: "center",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-0.005em",
                    fontFamily: "var(--font-sans)",
                  }}
                >
                  {c}
                </div>
              );
            })}
          </div>

          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateRows: `repeat(${values.length}, 1fr)`,
              gap: 8,
            }}
          >
            {values.map((v, rIdx) => (
              <div
                key={v}
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${categories.length}, 1fr)`,
                  gap: 8,
                }}
              >
                {categories.map((c, cIdx) => {
                  const cc = categoryColor(c, t.accent);
                  const cell = board[cIdx]?.[rIdx] ?? { played: false, selected: false, value: v };
                  const isPlayed = cell.played;
                  const isSelected = cell.selected;
                  const clickable =
                    !!onCellClick &&
                    !!cell.questionId &&
                    !isPlayed &&
                    !isSelected;
                  const cellStyle = {
                    borderRadius: 10,
                    background: isSelected
                      ? cc
                      : isPlayed
                        ? "transparent"
                        : t.dark
                          ? "rgba(244,230,196,.06)"
                          : "rgba(27,19,12,.04)",
                    border: isPlayed
                      ? `1px dashed ${t.line}`
                      : isSelected
                        ? `2px solid ${cc}`
                        : `1px solid ${t.line}`,
                    boxShadow: isSelected
                      ? `0 10px 36px -10px ${cc}77, 0 0 0 4px ${cc}22`
                      : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative" as const,
                    overflow: "hidden",
                    transition: "all .3s cubic-bezier(.2,.7,.3,1)",
                    transform: isSelected ? "scale(1.04)" : "scale(1)",
                    cursor: clickable ? "pointer" : "default",
                  };
                  const innerNumeric = (
                    <Numeric
                      size={36}
                      weight={700}
                      color={isSelected ? "#0E0805" : isPlayed ? t.inkMute : t.ink}
                      tracking={-0.03}
                      style={{
                        textDecoration: isPlayed ? "line-through" : "none",
                        opacity: isPlayed ? 0.4 : 1,
                      }}
                    >
                      {cell.value}
                    </Numeric>
                  );
                  if (clickable && cell.questionId) {
                    const qid = cell.questionId;
                    return (
                      <button
                        key={`${cIdx}-${rIdx}`}
                        type="button"
                        data-testid={`host-question-${qid}`}
                        onClick={() => onCellClick?.(qid)}
                        style={{
                          ...cellStyle,
                          padding: 0,
                          appearance: "none",
                          font: "inherit",
                          color: "inherit",
                        }}
                      >
                        <span
                          data-testid={`tv-grid-cell-${cIdx}-${cell.value}`}
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {innerNumeric}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <div
                      key={`${cIdx}-${rIdx}`}
                      data-testid={`tv-grid-cell-${cIdx}-${cell.value}`}
                      style={cellStyle}
                    >
                      {innerNumeric}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {leader && (
            <div style={{ padding: "18px 22px", borderRadius: 14, background: t.surface }}>
              <Eyebrow color={t.inkMute} size={10}>LEADER</Eyebrow>
              <div style={{ marginTop: 8 }}>
                <Display size={48} color={t.ink} weight={700}>{leader.name}</Display>
                <Numeric size={26} weight={700} color={t.accent} style={{ display: "block", marginTop: 4 }}>
                  {leader.score.toLocaleString()}
                </Numeric>
              </div>
            </div>
          )}

          {upNext && (
            <div style={{ padding: "16px 22px", borderRadius: 14, background: t.accent, color: "#0E0805" }}>
              <Eyebrow color="rgba(14,8,5,.65)" size={10}>UP NEXT · HOST&apos;S PICK</Eyebrow>
              <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}>
                {upNext.category} · {upNext.value} pts
              </div>
              {upNext.sub && (
                <div style={{ marginTop: 4, fontSize: 12, color: "rgba(14,8,5,.65)", fontWeight: 500 }}>
                  {upNext.sub}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <Eyebrow color={t.inkMute} size={10}>BOARD</Eyebrow>
            <Numeric size={20} color={t.ink}>{boardLeft} left</Numeric>
          </div>
        </div>
      </div>

      <TVFooter left={footerLeft} right={footerRight} />
    </TVStage>
  );
}
