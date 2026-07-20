// Adjust-points modal for the live host console.
//
// Lets the host pick any player, dial in a ± integer delta (small chip
// shortcuts for common values), and attach a short reason. The reason is
// stored on the `adjustments` row so the audit trail is always answerable
// to "why did Sara lose 200 points?" two weeks later.
//
// All visuals use design-system tokens (`var(--paper)` / `var(--accent)`
// etc.) so the modal inherits the active theme automatically.

"use client";

import { useEffect, useMemo, useState } from "react";
import { Eyebrow, Numeric, useTheme } from "@/components/system";
import { readableForeground } from "@/lib/theme/contrast";
import type { HostLivePlayer } from "./HostLiveConsole";

export interface AdjustPointsModalProps {
  /** Player initially focused. The host can swap to anyone in `allPlayers`. */
  initialPlayer: HostLivePlayer;
  /** Full live roster — drives the player picker. */
  allPlayers: HostLivePlayer[];
  /** Cancel / backdrop click / Esc. */
  onCancel: () => void;
  /** Submit. Delta is a non-zero integer; reason may be empty. */
  onSubmit: (playerId: string, delta: number, reason: string) => void;
}

const QUICK_DELTAS = [-300, -100, 100, 300] as const;

export function AdjustPointsModal({
  initialPlayer,
  allPlayers,
  onCancel,
  onSubmit,
}: AdjustPointsModalProps) {
  const { t } = useTheme();
  const [selectedId, setSelectedId] = useState(initialPlayer.id);
  const [deltaStr, setDeltaStr] = useState("100");
  const [reason, setReason] = useState("");

  const parsedDelta = useMemo(() => {
    const n = Number.parseInt(deltaStr, 10);
    return Number.isFinite(n) ? n : 0;
  }, [deltaStr]);
  const canApply = parsedDelta !== 0 && allPlayers.some((p) => p.id === selectedId);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    if (!canApply) return;
    onSubmit(selectedId, parsedDelta, reason.trim());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adjust points"
      data-host-mobile-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: "calc(100% - 32px)",
          maxWidth: 460,
          background: "var(--paper)",
          borderRadius: 14,
          padding: 24,
          color: "var(--ink)",
          fontFamily: "var(--font-sans)",
          boxShadow: "0 24px 48px -12px rgba(0,0,0,.4)",
          boxSizing: "border-box",
          maxHeight: "calc(100dvh - 32px)",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Eyebrow color="var(--ink-mute)" size={11}>
            ADJUST POINTS
          </Eyebrow>
          <button
            type="button"
            aria-label="Close point adjustment"
            onClick={onCancel}
            style={{
              minWidth: 48,
              minHeight: 48,
              padding: 0,
              border: "1px solid var(--line)",
              borderRadius: 12,
              background: "transparent",
              color: "var(--ink-mid)",
              font: "inherit",
              fontSize: 22,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <Field label="Player">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={fieldStyle}
            >
              {allPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.score.toLocaleString()}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Delta (+/- points)">
            <input
              type="number"
              value={deltaStr}
              onChange={(e) => setDeltaStr(e.target.value)}
              autoFocus
              style={{
                ...fieldStyle,
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {QUICK_DELTAS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDeltaStr(String(d))}
                  style={chipStyle}
                >
                  <Numeric size={12} color="var(--ink-mid)">
                    {d > 0 ? `+${d}` : d}
                  </Numeric>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Reason">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Host-awarded bonus, scoring fix, or manual correction"
              maxLength={200}
              style={fieldStyle}
            />
          </Field>
        </div>

        <div
          style={{
            marginTop: 22,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button type="button" onClick={onCancel} style={ghostBtn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canApply}
            style={{
              ...primaryBtn,
              background: t.accent,
              color: readableForeground(t.accent),
              opacity: canApply ? 1 : 0.5,
              cursor: canApply ? "pointer" : "not-allowed",
            }}
          >
            Apply {parsedDelta > 0 ? "+" : ""}
            {parsedDelta || 0}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 12,
          color: "var(--ink-mid)",
          fontWeight: 600,
          letterSpacing: "0.01em",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  minHeight: 48,
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 14,
  fontFamily: "inherit",
};

const chipStyle: React.CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  padding: "6px 10px",
  borderRadius: 999,
  background: "var(--surface)",
  border: "1px solid var(--line)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};

const ghostBtn: React.CSSProperties = {
  flex: 1,
  minWidth: 48,
  minHeight: 48,
  padding: "10px 0",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "transparent",
  color: "var(--ink-mid)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  flex: 2,
  minWidth: 48,
  minHeight: 48,
  padding: "10px 0",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "#FFF",
  fontSize: 13,
  fontWeight: 700,
};
