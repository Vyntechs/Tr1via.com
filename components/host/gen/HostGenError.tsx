// HOST · GENERATE · failure state
//
// Rendered when Claude generation didn't finish — either the background
// job reported an `error` broadcast, or the host has been staring at the
// "pulling questions" spinner past the safety timeout (60s default with
// zero rows landed). Two actions:
//   • Try again      → re-POST /api/categories/[id]/generate
//   • Enter manually → router.push(.../manual)
//
// The component is purely presentational. Polling / timeout logic lives
// in the parent client (lib/hooks/useGenerationStatus.ts).

"use client";

import {
  Display,
  Eyebrow,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostGenErrorProps {
  themeKey?: ThemeKey;
  /** LaptopShell title (e.g. "generation didn't work · pixar movies"). */
  shellTitle?: string;
  /** Topic / category name — drives accent color and breadcrumb. */
  topic?: string;
  /**
   * Specific failure message from the API. We do NOT show internal stack
   * traces here; the parent should already have mapped (e.g.) HTTP 5xx →
   * "Anthropic is busy — try again." If null we fall back to a generic
   * message.
   */
  message?: string | null;
  /** Called when the host taps "Try again". */
  onRetry?: () => void;
  /** Called when the host taps "Enter manually". */
  onEnterManually?: () => void;
  /** Called when the host taps "Back to setup". */
  onBack?: () => void;
  /** True while the retry POST is in flight (disables the Try again button). */
  isRetrying?: boolean;
}

export function HostGenError(props: HostGenErrorProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenErrorInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenErrorInner {...rest} />;
}

function HostGenErrorInner({
  shellTitle = "generation didn't work",
  topic = "Pixar Movies",
  message,
  onRetry,
  onEnterManually,
  onBack,
  isRetrying = false,
}: Omit<HostGenErrorProps, "themeKey">) {
  const { t } = useTheme();
  const cc = categoryColor(topic, t.accent);
  const friendlyMessage =
    message?.trim().length
      ? message
      : "Something went sideways while pulling your questions. It happens — usually a quick retry sorts it.";
  return (
    <LaptopShell>
      <div
        style={{
          flex: 1,
          padding: "56px 56px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{
            width: "100%",
            maxWidth: 720,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            animation: "tr1via-rise .45s cubic-bezier(.2,.7,.3,1) both",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 99,
                background: cc,
              }}
            />
            <Eyebrow color={cc} size={11}>
              {topic.toUpperCase()} · GENERATION FAILED
            </Eyebrow>
          </div>

          <Display
            size={48}
            color={t.ink}
            tracking={-0.03}
            style={{ display: "block" }}
          >
            Generation didn&rsquo;t work.
          </Display>

          <div
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: t.dark ? "rgba(156,47,47,.16)" : "rgba(156,47,47,.08)",
              border: `1px solid ${t.dark ? "rgba(255,140,120,.28)" : "rgba(156,47,47,.30)"}`,
              color: t.ink,
              fontSize: 14,
              lineHeight: 1.55,
              fontWeight: 500,
            }}
          >
            {friendlyMessage}
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              color: t.inkMid,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <li>
              <strong style={{ color: t.ink, fontWeight: 600 }}>
                Try again
              </strong>{" "}
              — the usual cause is a slow upstream. A second attempt almost
              always works.
            </li>
            <li>
              <strong style={{ color: t.ink, fontWeight: 600 }}>
                Enter manually
              </strong>{" "}
              — type your 7 questions yourself. You stay in control of the
              order and the point values 100 to 700.
            </li>
          </ul>

          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              style={{
                flex: "1 1 220px",
                padding: "14px 22px",
                borderRadius: 12,
                border: "none",
                background: t.accent,
                color: "#FFF",
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "var(--font-sans)",
                cursor: isRetrying ? "default" : "pointer",
                opacity: isRetrying ? 0.7 : 1,
                boxShadow: `0 12px 26px -12px ${t.accent}88`,
              }}
            >
              {isRetrying ? "Trying…" : "Try again  ↻"}
            </button>
            <button
              type="button"
              onClick={onEnterManually}
              style={{
                flex: "1 1 220px",
                padding: "14px 22px",
                borderRadius: 12,
                border: `1px solid ${t.ink}`,
                background: "transparent",
                color: t.ink,
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              Enter manually  →
            </button>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                style={{
                  flex: "0 0 auto",
                  padding: "14px 18px",
                  borderRadius: 12,
                  border: `1px solid ${t.line}`,
                  background: "transparent",
                  color: t.inkMid,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font-sans)",
                  cursor: "pointer",
                }}
              >
                Back to setup
              </button>
            )}
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
