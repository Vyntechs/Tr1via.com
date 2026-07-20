"use client";

import type { HostStage } from "@/lib/host/gameConsole";
import type { CSSProperties } from "react";
import { useTheme } from "@/components/system";
import styles from "./HostCommandCenter.module.css";

export interface HostDeliveryReceipt {
  tv: "current" | "recovering" | "unknown";
  currentPhones: number | null;
  recoveringPhones: number | null;
  isSending?: boolean;
  isAvailable?: boolean;
}

export interface HostGameStatusProps {
  stage: HostStage;
  playerCount: number;
  lockedCount: number;
  delivery: HostDeliveryReceipt;
}

const STAGE_LABELS: Record<HostStage, string> = {
  "game-ready": "Game ready",
  board: "Board ready",
  "private-preview": "Question preview",
  "question-live": "Question live",
  "answer-result": "Answer result",
  intermission: "Intermission",
  finale: "Finale",
};

export function HostGameStatus({
  stage,
  playerCount,
  lockedCount,
  delivery,
}: HostGameStatusProps) {
  const { t } = useTheme();
  const statusStyle = {
    "--host-status-line": t.line,
    "--host-status-surface": t.surface,
    "--host-status-ink": t.ink,
    "--host-status-muted": t.inkMid,
    "--host-status-success": t.correct,
    "--host-status-danger": t.wrong,
    "--host-status-accent": t.accent,
  } as CSSProperties;
  const receiptKnown = delivery.tv !== "unknown" &&
    delivery.currentPhones !== null &&
    delivery.recoveringPhones !== null;
  const receiptVisible = receiptKnown && !delivery.isSending && delivery.isAvailable !== false;
  let phoneLabel = "";
  let recoveringLabel: string | null = null;
  let phoneClass: string | undefined;
  if (delivery.currentPhones !== null && delivery.recoveringPhones !== null) {
    phoneLabel = `${delivery.currentPhones} phones live ✓`;
    recoveringLabel = delivery.recoveringPhones > 0
      ? `${delivery.recoveringPhones} recovering — answer protected`
      : null;
    phoneClass = delivery.recoveringPhones > 0 ? styles.recovering : styles.current;
  }
  const tvLabel = delivery.tv === "unknown"
    ? ""
    : `TV ${delivery.tv === "current" ? "live ✓" : "recovering"}`;
  const tvClass = delivery.tv === "current"
    ? styles.current
    : delivery.tv === "recovering"
      ? styles.recovering
      : undefined;
  return (
    <section className={styles.status} aria-label="Game Status" style={statusStyle}>
      <div className={styles.statusHeading}>
        <span className={styles.statusIcon} aria-hidden="true">✦</span>
        <div>
          <p className={styles.statusEyebrow}>Game Status</p>
          <p className={styles.statusStage}>{STAGE_LABELS[stage]}</p>
        </div>
      </div>
      <div className={styles.statusFacts} aria-label="Live game details">
        {delivery.isAvailable !== false && (!receiptKnown || delivery.isSending) && (
          <span role="status">Sending…</span>
        )}
        <span><span aria-hidden="true">● </span>{playerCount} players</span>
        <span><span aria-hidden="true">✓ </span>{lockedCount} locked</span>
        {receiptVisible && (
          <span className={tvClass}>
            <span aria-hidden="true">▣ </span>{tvLabel}
          </span>
        )}
        {receiptVisible && (
          <span className={phoneClass}>
            <span aria-hidden="true">◉ </span>{phoneLabel}
          </span>
        )}
        {receiptVisible && recoveringLabel && <span className={styles.recovering}>{recoveringLabel}</span>}
        {receiptVisible && delivery.tv === "current" && delivery.recoveringPhones === 0 && (
          <span className={styles.current}>Shown everywhere</span>
        )}
      </div>
    </section>
  );
}
