"use client";

import type { CSSProperties } from "react";
import { PhoneScreen } from "@/components/shells";
import { Eyebrow, ThemeProvider, useTheme } from "@/components/system";
import { readableForeground } from "@/lib/theme/contrast";
import type { AnswerRow, PlayerRow, QuestionRow } from "@/lib/supabase/types";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostAnswerResultProps {
  themeKey?: ThemeKey;
  question: QuestionRow;
  answers: AnswerRow[];
  players: PlayerRow[];
  onReturnToBoard: () => void;
}

export function HostAnswerResult({ themeKey, ...props }: HostAnswerResultProps) {
  if (themeKey) {
    return <ThemeProvider themeKey={themeKey}><HostAnswerResultInner {...props} /></ThemeProvider>;
  }
  return <HostAnswerResultInner {...props} />;
}

function HostAnswerResultInner({ question, answers, players, onReturnToBoard }: Omit<HostAnswerResultProps, "themeKey">) {
  const { t } = useTheme();
  const canonical = dedupeQuestionAnswers(question.id, answers);
  const distribution = [0, 0, 0, 0];
  for (const answer of canonical) distribution[answer.chosen_index] += 1;
  const correct = canonical.filter((answer) => answer.is_correct ?? answer.chosen_index === question.correct_index);
  const percent = canonical.length > 0 ? Math.round((correct.length / canonical.length) * 100) : 0;
  const maxChoice = Math.max(1, ...distribution);
  const nameById = new Map(players.map((player) => [player.id, player.display_name]));
  const fastest = [...correct]
    .sort((a, b) => a.ms_to_lock - b.ms_to_lock || a.locked_at.localeCompare(b.locked_at) || a.id.localeCompare(b.id))
    .slice(0, 5);
  const card: CSSProperties = { border: `1px solid ${t.line}`, borderRadius: 18, background: t.surface, padding: 16 };

  return (
    <PhoneScreen weather={false} style={{ color: t.ink, gap: 16 }}>
      <header>
        <Eyebrow color={t.inkMid} size={9}>ANSWER RESULT · DELIVERY NOT CONFIRMED</Eyebrow>
        <div style={{ ...card, marginTop: 10, background: t.correct, color: readableForeground(t.correct), borderColor: t.correct }}>
          <Eyebrow color="currentColor" size={9}>THE ANSWER WAS</Eyebrow>
          <h1 style={{ margin: "12px 0 5px", fontFamily: "var(--font-display)", fontSize: "clamp(28px, 8cqw, 44px)", lineHeight: 1.02, overflowWrap: "anywhere" }}>
            {question.correct_index + 1} {question.options[question.correct_index]}
          </h1>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 850 }}>{correct.length} of {canonical.length} correct · {percent}%</p>
        </div>
      </header>

      <section aria-label="Answer distribution">
        <Eyebrow color={t.accent} size={9}>HOW EVERYONE ANSWERED</Eyebrow>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {question.options.map((option, index) => (
            <div key={option} data-testid={`answer-choice-${index + 1}`} style={{ ...card, padding: "10px 12px", display: "grid", gridTemplateColumns: "24px minmax(90px, 1fr) minmax(56px, .7fr) 28px", alignItems: "center", gap: 8, minHeight: 48, boxSizing: "border-box" }}>
              <strong style={{ color: index === question.correct_index ? t.correct : t.accent, fontFamily: "var(--font-mono)", fontSize: 12 }}>{index + 1}</strong>
              <span style={{ minWidth: 0, overflowWrap: "anywhere", fontSize: 12, fontWeight: 750 }}>{option}</span>
              <span style={{ height: 8, borderRadius: 99, background: t.line, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(distribution[index] / maxChoice) * 100}%`, borderRadius: 99, background: index === question.correct_index ? t.correct : t.accent }} />
              </span>
              <strong style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{distribution[index]}</strong>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Fastest five correct responses" style={card}>
        <Eyebrow color={t.accent} size={9}>FASTEST FIVE</Eyebrow>
        {fastest.length === 0 ? (
          <p style={{ margin: "10px 0 0", color: t.inkMid, fontSize: 12 }}>No confirmed correct responses</p>
        ) : (
          <ol style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
            {fastest.map((answer, index) => (
              <li key={answer.player_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{index + 1} {nameById.get(answer.player_id) ?? "Player"}</span>
                <span style={{ flexShrink: 0, color: t.inkMid }}>{formatSeconds(answer.ms_to_lock)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {question.fact_blurb && (
        <aside style={{ ...card, color: t.inkMid, fontSize: 12, lineHeight: 1.5 }}>
          <Eyebrow color={t.pop} size={9}>FACT</Eyebrow>
          <p style={{ margin: "8px 0 0" }}>{question.fact_blurb}</p>
        </aside>
      )}

      <button type="button" onClick={onReturnToBoard} style={{ width: "100%", minWidth: 48, minHeight: 48, padding: "12px 16px", border: `1px solid ${t.accent}`, borderRadius: 16, background: t.accent, color: readableForeground(t.accent), font: "inherit", fontWeight: 900, cursor: "pointer", marginTop: "auto" }}>
        Return to board
      </button>
    </PhoneScreen>
  );
}

export function dedupeQuestionAnswers(questionId: string, answers: AnswerRow[]): AnswerRow[] {
  const byPlayer = new Map<string, AnswerRow>();
  for (const answer of answers) {
    if (answer.question_id !== questionId) continue;
    const previous = byPlayer.get(answer.player_id);
    if (!previous || compareCanonicalAnswer(answer, previous) > 0) byPlayer.set(answer.player_id, answer);
  }
  return [...byPlayer.values()];
}

function compareCanonicalAnswer(a: AnswerRow, b: AnswerRow): number {
  const aFinal = a.is_correct !== null || a.awarded_points !== null ? 1 : 0;
  const bFinal = b.is_correct !== null || b.awarded_points !== null ? 1 : 0;
  if (aFinal !== bFinal) return aFinal - bFinal;
  const time = Date.parse(a.locked_at) - Date.parse(b.locked_at);
  if (Number.isFinite(time) && time !== 0) return time;
  return a.id.localeCompare(b.id);
}

function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
