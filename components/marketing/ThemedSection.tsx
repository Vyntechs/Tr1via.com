// ThemedSection — a server-rendered section that fully paints itself in one
// month's palette by setting the theme CSS vars INLINE (via themeVars).
//
// Because the vars live in the static HTML, the section is themed AND readable
// with zero client JS — the "Year Scroll" tour exists for crawlers and no-JS
// visitors too. The client `YearScroll` island only adds cross-fades + ambient
// motion on top, keyed off the `data-ys-section` attribute. Copy inside rides
// `var(--ink)` on `var(--paper)`, whose contrast is designed-in per theme, so
// every section is legible regardless of which month it wears.
import type { CSSProperties, ReactNode } from "react";
import type { ThemeKey } from "@/lib/theme/tokens";
import { themeVars } from "./themeVars";

export function ThemedSection({
  themeKey,
  id,
  className = "",
  style,
  children,
}: {
  themeKey: ThemeKey;
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-theme={themeKey}
      data-ys-section={themeKey}
      className={`relative isolate ${className}`}
      style={{
        ...themeVars(themeKey),
        background: "var(--paper)",
        color: "var(--ink)",
        ...style,
      }}
    >
      {children}
    </section>
  );
}
