// Labeled password box + "Show password" switch, shared by /login and
// /host/set-password. Plain inputs styled with the active theme tokens so
// they match the rest of the host surfaces.

"use client";

import type { ChangeEvent } from "react";
import { useTheme } from "@/components/system";

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** true = letters visible (the shared "Show password" switch). */
  revealed: boolean;
  autoComplete: "current-password" | "new-password";
  disabled?: boolean;
  invalid?: boolean;
  /** Bigger type + padding for the set-password screen. */
  large?: boolean;
  autoFocus?: boolean;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  revealed,
  autoComplete,
  disabled = false,
  invalid = false,
  large = false,
  autoFocus = false,
}: PasswordFieldProps) {
  const { t } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: large ? 10 : 8 }}>
      <label
        htmlFor={id}
        style={
          large
            ? { fontSize: 20, fontWeight: 700, color: t.ink }
            : {
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: t.inkMute,
                fontWeight: 600,
              }
        }
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={revealed ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={{
          padding: large ? "20px 20px" : "16px 18px",
          fontSize: large ? 24 : 17,
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          color: t.ink,
          background: t.surface,
          border: `${large ? 2 : 1}px solid ${invalid ? t.wrong : t.line}`,
          borderRadius: large ? 14 : 12,
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

export function ShowPasswordToggle({
  revealed,
  onToggle,
  large = false,
  disabled = false,
}: {
  revealed: boolean;
  onToggle: () => void;
  large?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={revealed}
      data-testid="show-password-toggle"
      onClick={onToggle}
      disabled={disabled}
      style={{
        alignSelf: "flex-start",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: large ? "12px 16px" : "8px 12px",
        background: "transparent",
        color: t.inkMid,
        border: `1px solid ${t.line}`,
        borderRadius: 10,
        fontFamily: "var(--font-sans)",
        fontSize: large ? 18 : 14,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          width: large ? 22 : 18,
          height: large ? 22 : 18,
          borderRadius: 6,
          border: `2px solid ${revealed ? t.accent : t.inkMute}`,
          background: revealed ? t.accent : "transparent",
          color: "#FFF",
          fontSize: large ? 14 : 12,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {revealed ? "✓" : ""}
      </span>
      Show password
    </button>
  );
}
