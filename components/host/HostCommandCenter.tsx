"use client";

import type { ReactNode } from "react";
import type { HostStage } from "@/lib/host/gameConsole";
import { HostGameStatus, type HostDeliveryReceipt } from "./HostGameStatus";

export type HostSection = "board" | "players" | "scores" | "tv";

export interface HostCommandCenterProps {
  stage: HostStage;
  active?: HostSection;
  playerCount: number;
  lockedCount: number;
  delivery: HostDeliveryReceipt;
  onNavigate?: (section: HostSection) => void;
  children: ReactNode;
}

const SECTIONS: ReadonlyArray<{ id: HostSection; icon: string; label: string }> = [
  { id: "board", icon: "▦", label: "Board" },
  { id: "players", icon: "◉", label: "Players" },
  { id: "scores", icon: "★", label: "Scores" },
  { id: "tv", icon: "▣", label: "TV" },
];

export function HostCommandCenter({
  stage,
  active = "board",
  playerCount,
  lockedCount,
  delivery,
  onNavigate,
  children,
}: HostCommandCenterProps) {
  return (
    <main className="host-command-center" data-stage={stage}>
      <HostGameStatus
        stage={stage}
        playerCount={playerCount}
        lockedCount={lockedCount}
        delivery={delivery}
      />
      <section className="host-command-center__body">{children}</section>
      <nav className="host-command-center__nav" aria-label="Host controls">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className="host-command-center__nav-action"
            aria-current={active === section.id ? "page" : undefined}
            onClick={() => onNavigate?.(section.id)}
          >
            <span className="host-command-center__nav-icon" aria-hidden="true">{section.icon}</span>
            <span>{section.label}</span>
          </button>
        ))}
      </nav>
      <style>{`
        .host-command-center {
          --host-ink: #fff7e9;
          --host-muted: #b7c4d8;
          --host-line: rgba(255, 247, 233, 0.14);
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 12px;
          min-height: 100dvh;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow-x: clip;
          padding: max(14px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
          background: #071125;
          color: var(--host-ink);
          font-family: var(--font-sans, sans-serif);
        }
        .host-game-status {
          min-width: 0;
          border: 1px solid var(--host-line);
          border-radius: 16px;
          padding: 14px;
          background: linear-gradient(135deg, rgba(19, 39, 72, 0.96), rgba(7, 17, 37, 0.96));
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.16);
        }
        .host-game-status__heading { display: flex; align-items: center; gap: 10px; }
        .host-game-status__icon { color: #c8f36c; font-size: 20px; line-height: 1; }
        .host-game-status__eyebrow { margin: 0; color: #a8e9dc; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
        .host-game-status__stage { margin: 3px 0 0; color: var(--host-ink); font-size: 16px; font-weight: 700; }
        .host-game-status__facts { display: flex; flex-wrap: wrap; gap: 8px 12px; margin-top: 13px; color: var(--host-muted); font-size: 13px; line-height: 1.35; }
        .host-game-status__facts span { min-width: 0; overflow-wrap: anywhere; }
        .host-game-status__facts .is-current { color: #a8e9dc; }
        .host-game-status__facts .is-recovering { color: #ffaaa0; }
        .host-command-center__body { min-width: 0; min-height: 0; overflow: auto; }
        .host-command-center__nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; min-width: 0; border: 1px solid var(--host-line); border-radius: 16px; padding: 6px; background: rgba(11, 27, 56, 0.98); }
        .host-command-center__nav-action { display: grid; place-items: center; align-content: center; gap: 3px; min-width: 0; min-height: 52px; border: 0; border-radius: 11px; padding: 6px 4px; background: transparent; color: var(--host-muted); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
        .host-command-center__nav-action[aria-current="page"] { background: #17375f; color: var(--host-ink); box-shadow: inset 0 -2px 0 #c8f36c; }
        .host-command-center__nav-action:focus-visible { outline: 3px solid #a8e9dc; outline-offset: 2px; }
        .host-command-center__nav-icon { color: #e98d86; font-size: 16px; line-height: 1; }
        .host-command-center__nav-action[aria-current="page"] .host-command-center__nav-icon { color: #c8f36c; }
        @media (min-width: 768px) {
          .host-command-center { grid-template-columns: minmax(0, 1fr) 92px; grid-template-rows: auto minmax(0, 1fr); }
          .host-game-status, .host-command-center__body { grid-column: 1; }
          .host-command-center__nav { grid-column: 2; grid-row: 1 / span 2; grid-template-columns: 1fr; align-content: center; }
          .host-command-center__body { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
          .host-command-center__body > :only-child { grid-column: 1 / -1; }
          .host-command-center__nav-action { min-height: 64px; }
        }
        @media (orientation: landscape) and (max-height: 600px) and (max-width: 767px) {
          .host-command-center { grid-template-columns: minmax(0, 1fr) 88px; grid-template-rows: auto minmax(0, 1fr); padding-top: max(8px, env(safe-area-inset-top)); padding-bottom: max(8px, env(safe-area-inset-bottom)); }
          .host-game-status, .host-command-center__body { grid-column: 1; }
          .host-command-center__nav { grid-column: 2; grid-row: 1 / span 2; grid-template-columns: 1fr; align-content: center; }
        }
      `}</style>
    </main>
  );
}
