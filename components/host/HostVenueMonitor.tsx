"use client";

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import { ScaledTVCanvas } from "@/components/tv/ScaledTVCanvas";
import { useTheme } from "@/components/system";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { ThemeKey } from "@/lib/theme/tokens";
import styles from "./HostVenueMonitor.module.css";

export interface HostVenueMonitorProps {
  snapshot: TVSnapshot | null;
  active?: boolean;
  themeKey?: ThemeKey;
  lastBroadcastRevealedAt?: string | null;
  lastBroadcastServerNow?: string | null;
}

export function HostVenueMonitor({
  snapshot,
  active = true,
  themeKey,
  lastBroadcastRevealedAt = null,
  lastBroadcastServerNow = null,
}: HostVenueMonitorProps) {
  const { t } = useTheme();
  const [wideLayout, setWideLayout] = useState(false);

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(
      "(min-width: 768px), (orientation: landscape) and (max-height: 600px)",
    );
    const sync = () => setWideLayout(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  const monitorStyle = {
    "--venue-monitor-line": t.line,
    "--venue-monitor-surface": t.surface,
    "--venue-monitor-ink": t.ink,
    "--venue-monitor-muted": t.inkMid,
    "--venue-monitor-accent": t.accent,
  } as CSSProperties;

  return (
    <section
      className={styles.root}
      aria-label="Venue TV preview"
      data-audience-safe="true"
      style={monitorStyle}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>What players see</p>
          <h2 className={styles.title}>TV preview</h2>
        </div>
      </header>

      <div className={styles.viewport}>
        {snapshot && (active || wideLayout) ? (
          <ScaledTVCanvas
            className={`${styles.frame} venue-tv-preview-frame`}
            frameTestId="venue-tv-preview-frame"
            canvasTestId="venue-tv-preview-canvas"
          >
              <TVStateMachine
                snapshot={snapshot}
                lastBroadcastRevealedAt={lastBroadcastRevealedAt}
                lastBroadcastServerNow={lastBroadcastServerNow}
                themeKey={themeKey}
              />
          </ScaledTVCanvas>
        ) : (
          <div
            className={`${styles.frame} venue-tv-preview-frame`}
            data-testid="venue-tv-preview-frame"
          >
            <p className={styles.waiting} role="status">
              {snapshot ? "Venue picture ready" : "Preparing the venue picture…"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
