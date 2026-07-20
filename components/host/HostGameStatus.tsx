"use client";

import type { HostStage } from "@/lib/host/gameConsole";
import type { CSSProperties } from "react";
import { useTheme } from "@/components/system";
import styles from "./HostCommandCenter.module.css";

export interface HostDeliveryReceipt {
  tv: "current" | "recovering" | "unknown";
  currentPhones: number | null;
  recoveringPhones: number | null;
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
  const phonesObserved =
    delivery.currentPhones !== null && delivery.recoveringPhones !== null;
  const phoneLabel = !phonesObserved
    ? "Phone delivery not confirmed"
    : delivery.recoveringPhones > 0
      ? `${delivery.currentPhones} phones live · ${delivery.recoveringPhones} recovering`
      : `${delivery.currentPhones} phones live`;
  const tvLabel = delivery.tv === "unknown"
    ? "TV not confirmed"
    : `TV ${delivery.tv === "current" ? "live" : "recovering"}`;
  const tvClass = delivery.tv === "current"
    ? styles.current
    : delivery.tv === "recovering"
      ? styles.recovering
      : undefined;
  const phoneClass = !phonesObserved
    ? undefined
    : delivery.recoveringPhones > 0
      ? styles.recovering
      : styles.current;

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
        <span><span aria-hidden="true">● </span>{playerCount} players</span>
        <span><span aria-hidden="true">✓ </span>{lockedCount} locked</span>
        <span className={tvClass}>
          <span aria-hidden="true">▣ </span>{tvLabel}
        </span>
        <span className={phoneClass}>
          <span aria-hidden="true">◉ </span>{phoneLabel}
        </span>
      </div>
    </section>
  );
}
