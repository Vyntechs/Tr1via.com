// Add-latecomer modal — host types a name and adds someone who couldn't
// scan in. Compact single-field modal so it's fast during a live game.
// All visuals use design-system theme tokens.

"use client";

import { useEffect, useState } from "react";
import { Eyebrow } from "@/components/system";

export interface AddLatecomerModalProps {
  onCancel: () => void;
  /** Resolves once the row is created server-side; throws on failure. */
  onSubmit: (displayName: string) => Promise<void>;
}

const MAX_NAME = 40;

export function AddLatecomerModal({ onCancel, onSubmit }: AddLatecomerModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a latecomer"
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
          maxWidth: 420,
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
        <Eyebrow color="var(--ink-mute)" size={11}>
          ADD LATECOMER
        </Eyebrow>

        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: "var(--ink-mid)",
            lineHeight: 1.45,
          }}
        >
          Adds someone whose phone died or who scanned in late. They&apos;ll
          appear in the roster but can&apos;t answer from a device until they
          rejoin via the room code.
        </div>

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 12,
              color: "var(--ink-mid)",
              fontWeight: 600,
            }}
          >
            Display name
          </label>
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={MAX_NAME}
            placeholder="e.g. Sam (phone dead)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) void submit();
            }}
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink)",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              flex: 1,
              padding: "10px 0",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink-mid)",
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            style={{
              flex: 2,
              padding: "10px 0",
              borderRadius: 10,
              border: "none",
              background: "var(--accent)",
              color: "#FFF",
              fontSize: 13,
              fontWeight: 700,
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.5,
            }}
          >
            {submitting ? "Adding…" : "Add player"}
          </button>
        </div>
      </div>
    </div>
  );
}
