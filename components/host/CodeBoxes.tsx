// Six big boxes for the emailed 6-digit code. Under the boxes is ONE real
// input (numbers only, autocomplete="one-time-code"), so pasting the whole
// code or letting the phone fill it from the email both just work; the
// boxes only draw what's typed. No maxLength on the input: a paste like
// "123 456" or "Your code: 123456" must reach onChange whole, which keeps
// only the digits and then the first six.

"use client";

import { useRef, type ChangeEvent } from "react";
import { useTheme } from "@/components/system";

export const CODE_BOX_COUNT = 6;

/** Digits only, then the first six ("Your code: 123 456" → "123456"). */
export function codeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_BOX_COUNT);
}

export function CodeBoxes({
  value,
  onChange,
  disabled = false,
  invalid = false,
  autoFocus = false,
  compact = false,
}: {
  value: string;
  onChange: (digits: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { t } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const active = Math.min(value.length, CODE_BOX_COUNT - 1);

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `repeat(${CODE_BOX_COUNT}, 1fr)`,
        gap: compact ? 8 : 10,
        width: "100%",
        maxWidth: 380,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {Array.from({ length: CODE_BOX_COUNT }, (_, i) => {
        const digit = value[i] ?? "";
        const isActive = !disabled && i === active && value.length < CODE_BOX_COUNT;
        return (
          <div
            key={i}
            aria-hidden
            data-testid={`code-box-${i}`}
            style={{
              height: compact ? 60 : 68,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontSize: compact ? 28 : 32,
              fontWeight: 700,
              color: t.ink,
              background: t.surface,
              border: `2px solid ${invalid ? t.wrong : isActive ? t.accent : t.line}`,
              borderRadius: 12,
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {digit}
          </div>
        );
      })}
      <input
        ref={inputRef}
        id="email-code"
        aria-label="6-digit code"
        data-testid="login-code-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(codeDigits(e.target.value))}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          // 16px+ keeps iPhone Safari from zooming in on focus.
          fontSize: 16,
          color: "transparent",
          caretColor: "transparent",
          background: "transparent",
          border: "none",
          outline: "none",
          padding: 0,
          cursor: disabled ? "default" : "text",
        }}
      />
    </div>
  );
}
