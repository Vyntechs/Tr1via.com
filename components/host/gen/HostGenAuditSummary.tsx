"use client";

import { Eyebrow, Numeric, useTheme } from "@/components/system";
import type { HostQuestionAuditSummary } from "@/lib/ai/question-generation-report";

export interface HostGenAuditSummaryProps {
  summary: HostQuestionAuditSummary;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function plural(count: number, singular: string, pluralLabel: string): string {
  return count === 1 ? singular : pluralLabel;
}

export function HostGenAuditSummary({ summary }: HostGenAuditSummaryProps) {
  const { t } = useTheme();
  const items = [
    `${summary.acceptedCount} accepted from ${summary.generatedCount} candidates`,
    `${summary.verifyPasses} ${plural(
      summary.verifyPasses,
      "verification pass",
      "verification passes",
    )}`,
    `Estimated AI cost: ${money(summary.estimatedCostUsd)}`,
    `Images: ${summary.imageTargetCount} attempted, ${summary.imageAttachedCount} attached`,
    `${summary.riskFlagCount} ${plural(
      summary.riskFlagCount,
      "wording flag",
      "wording flags",
    )} to review`,
  ];

  return (
    <section
      aria-label="Question quality summary"
      data-testid="host-gen-audit-summary"
      style={{
        marginBottom: 14,
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${t.line}`,
        background: t.dark ? "rgba(255,255,255,.035)" : "rgba(255,255,255,.78)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <Eyebrow color={t.inkMid} size={9}>
        AI CHECK
      </Eyebrow>
      {items.map((item, index) => (
        <span
          key={item}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 6,
            flex: "1 1 150px",
            minWidth: 0,
            color: index === 4 && summary.riskFlagCount > 0 ? t.accent : t.inkMid,
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          <Numeric size={11} weight={700} color="currentColor">
            {index + 1}
          </Numeric>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{item}</span>
        </span>
      ))}
    </section>
  );
}
