"use client";

import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "@/components/system";
import type { HostStage } from "@/lib/host/gameConsole";
import { HostGameStatus, type HostDeliveryReceipt } from "./HostGameStatus";
import styles from "./HostCommandCenter.module.css";

export type HostSection = "board" | "players" | "scores" | "tv";

export interface HostCommandCenterProps {
  stage: HostStage;
  active?: HostSection;
  playerCount: number;
  lockedCount: number;
  delivery: HostDeliveryReceipt;
  onNavigate: (section: HostSection) => void;
  venueMonitor?: ReactNode;
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
  venueMonitor,
  children,
}: HostCommandCenterProps) {
  const { t } = useTheme();
  const themeStyle = {
    "--host-paper": t.paper,
    "--host-ink": t.ink,
    "--host-muted": t.inkMid,
    "--host-line": t.line,
    "--host-surface": t.surface,
    "--host-active": `${t.accent}22`,
    "--host-focus": t.pop,
    "--host-success": t.correct,
    "--host-danger": t.wrong,
    "--host-accent": t.accent,
  } as CSSProperties;

  return (
    <main
      className={styles.root}
      data-stage={stage}
      data-active={active}
      data-has-monitor={venueMonitor ? "true" : "false"}
      style={themeStyle}
    >
      <div className={styles.layout}>
        <HostGameStatus
          stage={stage}
          playerCount={playerCount}
          lockedCount={lockedCount}
          delivery={delivery}
        />
        <section className={styles.workspace} aria-label="Live host workspace">
          <div className={styles.body}>{children}</div>
          {venueMonitor && <aside className={styles.monitor}>{venueMonitor}</aside>}
        </section>
        <nav className={styles.nav} aria-label="Host controls">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={styles.navAction}
              aria-current={active === section.id ? "page" : undefined}
              onClick={() => onNavigate(section.id)}
            >
              <span className={styles.navIcon} aria-hidden="true">{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </main>
  );
}
