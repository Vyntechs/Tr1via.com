"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import { useTheme } from "@/components/system";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import type { ThemeKey } from "@/lib/theme/tokens";
import styles from "./HostVenueMonitor.module.css";

const TV_WIDTH = 1_600;
const TV_HEIGHT = 900;

export interface HostVenueMonitorProps {
  snapshot: TVSnapshot | null;
  roomCode: string;
  active?: boolean;
  themeKey?: ThemeKey;
  lastBroadcastRevealedAt?: string | null;
  lastBroadcastServerNow?: string | null;
}

export function HostVenueMonitor({
  snapshot,
  roomCode,
  active = true,
  themeKey,
  lastBroadcastRevealedAt = null,
  lastBroadcastServerNow = null,
}: HostVenueMonitorProps) {
  const { t } = useTheme();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
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

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const syncScale = () => {
      const next = frame.getBoundingClientRect().width / TV_WIDTH;
      if (Number.isFinite(next) && next > 0) {
        setScale((current) => Math.abs(current - next) < 0.0001 ? current : next);
      }
    };

    syncScale();
    const observer = new ResizeObserver(syncScale);
    observer.observe(frame);
    return () => observer.disconnect();
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
          <p className={styles.eyebrow}>Audience view</p>
          <h2 className={styles.title}>Venue TV</h2>
        </div>
        <a
          className={styles.open}
          href={`/tv/${roomCode}`}
          target="_blank"
          rel="noreferrer"
          style={{ minWidth: 48, minHeight: 48, display: "inline-flex" }}
        >
          Open full venue display
        </a>
      </header>

      <div className={styles.viewport}>
        <div
          ref={frameRef}
          className={`${styles.frame} venue-tv-preview-frame`}
          data-testid="venue-tv-preview-frame"
        >
          {snapshot && (active || wideLayout) ? (
            <div
              className={styles.canvas}
              data-testid="venue-tv-preview-canvas"
              style={{
                width: `${TV_WIDTH}px`,
                height: `${TV_HEIGHT}px`,
                transform: `scale(${scale})`,
              }}
            >
              <TVStateMachine
                snapshot={snapshot}
                lastBroadcastRevealedAt={lastBroadcastRevealedAt}
                lastBroadcastServerNow={lastBroadcastServerNow}
                themeKey={themeKey}
              />
            </div>
          ) : (
            <p className={styles.waiting} role="status">
              {snapshot ? "Venue picture ready" : "Preparing the venue picture…"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
