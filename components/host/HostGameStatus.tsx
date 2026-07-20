"use client";

import type { HostStage } from "@/lib/host/gameConsole";

export interface HostDeliveryReceipt {
  tv: "current" | "recovering";
  currentPhones: number;
  recoveringPhones: number;
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
  const phoneLabel = delivery.recoveringPhones > 0
    ? `${delivery.currentPhones} phones live · ${delivery.recoveringPhones} recovering`
    : `${delivery.currentPhones} phones live`;

  return (
    <section className="host-game-status" aria-label="Game Status">
      <div className="host-game-status__heading">
        <span className="host-game-status__icon" aria-hidden="true">✦</span>
        <div>
          <p className="host-game-status__eyebrow">Game Status</p>
          <p className="host-game-status__stage">{STAGE_LABELS[stage]}</p>
        </div>
      </div>
      <div className="host-game-status__facts" aria-label="Live game details">
        <span><span aria-hidden="true">● </span>{playerCount} players</span>
        <span><span aria-hidden="true">✓ </span>{lockedCount} locked</span>
        <span className={delivery.tv === "current" ? "is-current" : "is-recovering"}>
          <span aria-hidden="true">▣ </span>TV {delivery.tv === "current" ? "live" : "recovering"}
        </span>
        <span className={delivery.recoveringPhones > 0 ? "is-recovering" : "is-current"}>
          <span aria-hidden="true">◉ </span>{phoneLabel}
        </span>
      </div>
    </section>
  );
}
