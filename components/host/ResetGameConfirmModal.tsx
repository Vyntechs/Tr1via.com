// "Reset and edit game" confirmation popup. Pure props; HostHomeClient
// owns open/close state and the network call. Vivid plain-English copy
// is the safety mechanism — no typed-confirm pattern (Brandon rejected
// that as engineer-culture friction for non-technical hosts).

"use client";

import type { ResetPreview } from "@/lib/api/resetNightCounts";

export interface ResetGameConfirmModalProps {
  open: boolean;
  venueName: string;
  preview: ResetPreview;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetGameConfirmModal({
  open,
  venueName,
  preview,
  isSubmitting,
  onConfirm,
  onCancel,
}: ResetGameConfirmModalProps) {
  if (!open) return null;

  const categoriesLabel = formatCategories(preview);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reset game confirmation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "var(--paper, #F7F2E5)",
          color: "var(--ink, #15140F)",
          maxWidth: 540,
          width: "100%",
          borderRadius: 14,
          padding: "28px 32px",
          fontFamily: "var(--font-sans)",
          boxShadow: "0 24px 64px -16px rgba(0,0,0,.6)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            lineHeight: 1.2,
          }}
        >
          Are you sure you want to reset {venueName}?
        </h2>

        <Section title="This will throw away — permanently:">
          <BulletLine>
            <strong>{preview.answersToWipe} answers</strong> the {preview.playersInRoom} people in the room sent in
          </BulletLine>
          <BulletLine>
            <strong>{preview.finishedQuestionsToWipe} played-question markers</strong> — questions you already played will count as "not played yet"
          </BulletLine>
          <BulletLine>
            <strong>{preview.revealsToWipe} reveal events</strong> — the TV will forget what's been shown
          </BulletLine>
          {preview.adjustmentsToWipe > 0 && (
            <BulletLine>
              <strong>{preview.adjustmentsToWipe} point adjustments</strong> you made
            </BulletLine>
          )}
        </Section>

        <Section title="You'll keep:">
          <BulletLine>
            Your <strong>{preview.categoriesKept} categories</strong>
            {categoriesLabel ? ` (${categoriesLabel})` : null}
          </BulletLine>
          <BulletLine>
            The <strong>{preview.pickedQuestionsKept} picked questions</strong>
          </BulletLine>
          <BulletLine>
            The <strong>{preview.playersInRoom} people in the room</strong> — their phones will switch to "waiting for host to start," with points back to zero
          </BulletLine>
        </Section>

        <p style={{ marginTop: 20, fontSize: 14, lineHeight: 1.45, color: "var(--ink-mid, #4A4639)" }}>
          The game will go back to the setup screen so you can finish building it and start fresh.
        </p>

        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 12,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              background: "transparent",
              color: "var(--ink, #15140F)",
              border: "1px solid var(--line, #D8D2C0)",
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: isSubmitting ? "default" : "pointer",
              opacity: isSubmitting ? 0.55 : 1,
              fontFamily: "var(--font-sans)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            style={{
              background: "#9C2F2F",
              color: "#FFF",
              border: "none",
              padding: "10px 18px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: isSubmitting ? "default" : "pointer",
              opacity: isSubmitting ? 0.7 : 1,
              fontFamily: "var(--font-sans)",
              boxShadow: "0 10px 22px -10px rgba(156,47,47,.6)",
            }}
          >
            {isSubmitting ? "Resetting…" : "Yes, reset this game"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-mute, #6B6553)",
        }}
      >
        {title}
      </div>
      <ul style={{ margin: "8px 0 0 0", padding: 0, listStyle: "none" }}>
        {children}
      </ul>
    </div>
  );
}

function BulletLine({ children }: { children: React.ReactNode }) {
  return (
    <li
      style={{
        fontSize: 14,
        lineHeight: 1.5,
        paddingLeft: 16,
        position: "relative",
        marginTop: 4,
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0 }}>·</span>
      {children}
    </li>
  );
}

function formatCategories(preview: ResetPreview): string {
  const sample = preview.categoryNamesSample;
  if (sample.length === 0) return "";
  if (sample.length === 1 || preview.categoriesKept <= 2) return sample.join(", ");
  const remaining = preview.categoriesKept - sample.length;
  return `${sample.join(", ")} and ${remaining} more`;
}
