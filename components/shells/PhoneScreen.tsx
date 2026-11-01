// Full-height phone container with the active theme's weather layered
// behind. Most player + host-phone screens nest inside this.
//
// `fill={true}` is used for high-energy reveal screens that paint the whole
// background with the accent color (and switch ink contrast accordingly);
// in that mode weather is suppressed so it doesn't compete.

"use client";

import { useEffect, type CSSProperties, type ReactNode, type Ref } from "react";
import { preloadNovemberPhoneArt } from "@/components/experience/november/preloadPhoneArt";
import { useTheme } from "@/components/system/ThemeProvider";
import { ThemeTokensOverride } from "@/components/system/ThemeProvider";
import { Weather, type WeatherProps } from "@/components/system/Weather";
import { NovemberPhoneContext } from "@/components/experience/november/phoneContext";
import {
  NOVEMBER_PHONE_PANEL,
  NOVEMBER_PHONE_PANEL_STRONG,
  isNovemberPhone,
  phoneWorldUrl,
  type HarvestSky,
} from "@/lib/experience/november/phone";

// November's field panels: cards that use the theme's surface tokens sit on
// dark paper instead of a faint tint, so they read over the field picture.
const NOVEMBER_PANELS = { surface: NOVEMBER_PHONE_PANEL, surfaceH: NOVEMBER_PHONE_PANEL_STRONG };
// Darkens the field where the text sits: strong under the header, lighter
// through the middle where the turkey stands, strong again at the bottom.
const NOVEMBER_VEIL =
  "linear-gradient(180deg, rgba(30,18,8,.86) 0%, rgba(30,18,8,.5) 34%, rgba(30,18,8,.42) 58%, rgba(30,18,8,.8) 100%)";
// The golden lobby light is the brightest, so its veil is a little stronger.
const NOVEMBER_VEIL_GOLDEN =
  "linear-gradient(180deg, rgba(30,18,8,.9) 0%, rgba(30,18,8,.64) 34%, rgba(30,18,8,.56) 58%, rgba(30,18,8,.84) 100%)";

export interface PhoneScreenProps {
  children: ReactNode;
  /** Paint the whole background with `accent` (or a passed color) instead of
   *  paper. Used by the correct-answer takeover screen. */
  fill?: boolean;
  /** Color override when fill=true (defaults to current theme accent). */
  fillColor?: string;
  weather?: boolean;
  /** Weather intensity 0-2.2 (>1 for the finale). */
  weatherIntensity?: number;
  /** Lets state-aware monthly weather quiet itself on timed reading screens. */
  weatherPage?: WeatherProps["page"];
  /** Dense states scroll on short phones; timed question input stays locked. */
  scroll?: "auto" | "locked";
  style?: CSSProperties;
  /** Optional handle to the measured phone surface for responsive children. */
  screenRef?: Ref<HTMLDivElement>;
  /** Forwarded data-testid for E2E tests. Applied to the outer container so
   *  Playwright can target any phone screen by its top-level id. */
  "data-testid"?: string;
  /** November only: which light of the Harvest Field shows behind the screen
   *  (golden lobby, dusk game 1, night between games and the finale). Ignored
   *  on every other month and on fill screens. */
  harvestSky?: HarvestSky;
}

export function PhoneScreen({
  children,
  fill = false,
  fillColor,
  weather = true,
  weatherIntensity = 0.5,
  weatherPage,
  scroll = "auto",
  style,
  screenRef,
  "data-testid": dataTestId,
  harvestSky,
}: PhoneScreenProps) {
  const { t, themeKey } = useTheme();
  const field = !fill && !!harvestSky && isNovemberPhone(themeKey) ? harvestSky : null;
  // November: the first field screen fetches every phone picture (strips,
  // dusk/night field) so a mood change never waits on venue wifi.
  const novemberTheme = isNovemberPhone(themeKey);
  useEffect(() => {
    if (novemberTheme) preloadNovemberPhoneArt();
  }, [novemberTheme]);
  const bg = fill ? fillColor ?? t.accent : t.paper;
  const fg = fill ? (t.dark ? "#0E0805" : t.paper) : t.ink;
  return (
    <div
      ref={screenRef}
      data-testid={dataTestId}
      data-harvest-sky={field ?? undefined}
      style={{
        width: "100%",
        height: "100%",
        // Grow to fill a flex-column parent (the player layout) so short
        // screens still cover the viewport. height:100% alone doesn't resolve
        // through a min-height-only chain; flexGrow does. Harmless in fixed-
        // size embeds (dev gallery / host-phone), where it's simply ignored.
        flexGrow: 1,
        minHeight: 0,
        background: bg,
        // The field stays put while a long screen scrolls over it.
        ...(field
          ? {
              backgroundImage: `${field === "golden" ? NOVEMBER_VEIL_GOLDEN : NOVEMBER_VEIL}, url(${phoneWorldUrl(field)})`,
              backgroundSize: "100% 100%, cover",
              backgroundPosition: "center, center bottom",
              backgroundRepeat: "no-repeat",
            }
          : null),
        color: fg,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        paddingTop: 14,
        paddingRight: 22,
        paddingBottom: "max(26px, env(safe-area-inset-bottom))",
        paddingLeft: 22,
        boxSizing: "border-box",
        overflowX: "hidden",
        overflowY: scroll === "auto" ? "auto" : "hidden",
        overscrollBehaviorY: scroll === "auto" ? "contain" : "none",
        WebkitOverflowScrolling: scroll === "auto" ? "touch" : undefined,
        position: "relative",
        // Player typography can size against the actual phone surface (cqw),
        // not the browser/TV viewport that happens to contain it.
        containerType: "inline-size",
        ...style,
      }}
    >
      {weather && !fill && (
        <Weather themeKey={themeKey} intensity={weatherIntensity} compact page={weatherPage} />
      )}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {field ? (
          <NovemberPhoneContext.Provider value>
            <ThemeTokensOverride patch={NOVEMBER_PANELS}>{children}</ThemeTokensOverride>
          </NovemberPhoneContext.Provider>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
