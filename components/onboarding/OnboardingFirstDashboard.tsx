// FIRST-TIME DASHBOARD — Linda's home base, the very first time. Big
// "Welcome, Linda" hero with one primary CTA and three expectations cards.

"use client";

import { LaptopShell } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface OnboardingFirstDashboardProps {
  themeKey?: ThemeKey;
  /** First name to greet the host with (defaults to "Linda"). */
  hostName?: string;
  /** Venue label under the host name (e.g. "Soul Fire Pizza"). */
  venueLabel?: string;
  /** CTA label override (e.g. "Set up Wednesday"). */
  ctaLabel?: string;
  /** Called when the host taps the "Set up Wednesday" CTA. */
  onSetup?: () => void;
  /** True while the underlying POST /api/nights is in flight. */
  isSettingUp?: boolean;
}

export function OnboardingFirstDashboard({
  themeKey,
  hostName,
  venueLabel,
  ctaLabel,
  onSetup,
  isSettingUp,
}: OnboardingFirstDashboardProps) {
  const inner = (
    <OnboardingFirstDashboardInner
      hostName={hostName}
      venueLabel={venueLabel}
      ctaLabel={ctaLabel}
      onSetup={onSetup}
      isSettingUp={isSettingUp}
    />
  );
  if (themeKey) {
    return <ThemeProvider themeKey={themeKey}>{inner}</ThemeProvider>;
  }
  return inner;
}

interface OnboardingFirstDashboardInnerProps {
  hostName?: string;
  venueLabel?: string;
  ctaLabel?: string;
  onSetup?: () => void;
  isSettingUp?: boolean;
}

function OnboardingFirstDashboardInner({
  hostName = "Linda",
  venueLabel = "Soul Fire Pizza",
  ctaLabel = "Set up Wednesday",
  onSetup,
  isSettingUp = false,
}: OnboardingFirstDashboardInnerProps) {
  const { t } = useTheme();
  return (
    <LaptopShell title="tr1via.com / linda">
      <div
        data-testid="host-onboarding-first"
        style={{
          padding: "40px 56px",
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: 56,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Sidebar — same as the regular dashboard, but no past nights */}
        <div>
          <Eyebrow color={t.inkMute} size={10}>
            HOSTING AS
          </Eyebrow>
          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 700,
              color: t.ink,
              letterSpacing: "-0.015em",
            }}
          >
            {hostName}
          </div>
          <div style={{ color: t.inkMid, fontSize: 13, marginTop: 2 }}>
            {venueLabel}
          </div>

          <div
            style={{
              marginTop: "auto",
              paddingTop: 36,
              fontSize: 12,
              color: t.inkMute,
              lineHeight: 1.5,
            }}
          >
            Your home base. Past nights live here as soon as you start running them.
          </div>
        </div>

        {/* Main */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <Eyebrow color={t.accent} size={11}>
            YOUR FIRST NIGHT
          </Eyebrow>
          <Display
            size={88}
            color={t.ink}
            weight={700}
            tracking={-0.04}
            style={{ marginTop: 10, display: "block", lineHeight: 0.95 }}
          >
            Welcome,
            <br />
            <span style={{ color: t.accent }}>{hostName}.</span>
          </Display>

          <div
            style={{
              marginTop: 22,
              fontSize: 18,
              color: t.inkMid,
              lineHeight: 1.5,
              maxWidth: 560,
            }}
          >
            About a minute to set up your first Wednesday at {venueLabel}. Type your six
            topics; we&apos;ll do the rest.
          </div>

          <button
            type="button"
            onClick={onSetup}
            disabled={isSettingUp}
            style={{
              marginTop: 32,
              alignSelf: "flex-start",
              background: t.accent,
              color: "#FFF",
              border: "none",
              borderRadius: 14,
              padding: "20px 32px",
              fontSize: 17,
              fontWeight: 700,
              fontFamily: "var(--font-sans)",
              cursor: isSettingUp ? "default" : "pointer",
              opacity: isSettingUp ? 0.7 : 1,
              letterSpacing: "-0.005em",
              display: "flex",
              alignItems: "center",
              gap: 14,
              boxShadow: `0 16px 32px -10px ${t.accent}77`,
            }}
          >
            {isSettingUp ? "Setting up…" : ctaLabel}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 500,
                opacity: 0.7,
              }}
            >
              ~60 seconds
            </span>
          </button>

          {/* Three small expectations cards — never preachy */}
          <div
            style={{
              marginTop: 56,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
            }}
          >
            {[
              {
                l: "TYPE A TOPIC",
                body: "Anything. Pixar Movies, NFL teams, the 90s.",
                v: "1",
              },
              {
                l: "PICK YOUR SEVEN",
                body: "We pull 20. You keep the ones you like.",
                v: "2",
              },
              {
                l: "OPEN THE ROOM",
                body: "A QR code goes on the TV. Players scan and play.",
                v: "3",
              },
            ].map((s) => (
              <div
                key={s.l}
                style={{
                  padding: "18px 20px",
                  borderRadius: 14,
                  background: t.surface,
                }}
              >
                <Numeric size={22} weight={700} color={t.accent}>
                  {s.v}
                </Numeric>
                <Eyebrow
                  color={t.inkMute}
                  size={10}
                  style={{ display: "block", marginTop: 8 }}
                >
                  {s.l}
                </Eyebrow>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    color: t.ink,
                    fontWeight: 500,
                    lineHeight: 1.45,
                  }}
                >
                  {s.body}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: "auto",
              paddingTop: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Eyebrow color={t.inkMute} size={9}>
              BUILT FOR YOU · BY BRANDON
            </Eyebrow>
            <Eyebrow color={t.inkMute} size={9}>
              v1.0 · MAY 2026
            </Eyebrow>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
