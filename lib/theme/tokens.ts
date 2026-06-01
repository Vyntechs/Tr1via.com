// TR1VIA themed palettes — 14 total: house default + daylight + 12 months.
// Source of truth for the theme system. Mirrored to CSS vars by lib/theme/__build__.ts.
// Direction: warm-dark pub-night default; each month its own confident color statement
// (not a tint of the previous). Per the design package.

export type ThemeMode = "light" | "dark";

export type ThemeKey =
  | "house"
  | "daylight"
  | "january"
  | "february"
  | "march"
  | "april"
  | "may"
  | "june"
  | "july"
  | "august"
  | "september"
  | "october"
  | "november"
  | "december";

export interface ThemeDef {
  name: string;
  mode: ThemeMode;
  /** Page background */
  paper: string;
  /** Primary text / element color */
  ink: string;
  /** Brand signature accent (the "1", primary CTAs, category banners) */
  accent: string;
  /** Secondary energy color (correct streaks, leaderboard, motion) */
  pop: string;
  correct: string;
  wrong: string;
}

export const TR1VIA_THEMES: Record<ThemeKey, ThemeDef> = {
  house:     { name: "House · Pub Night",    mode: "dark",  paper: "#1B130C", ink: "#F4E6C4", accent: "#FF6A3D", pop: "#4ECDC4", correct: "#C8E25E", wrong: "#E55A4F" },
  daylight:  { name: "Daylight",             mode: "light", paper: "#F4E6C4", ink: "#1B130C", accent: "#D9421F", pop: "#1E7A6E", correct: "#3F6B1F", wrong: "#A92E22" },
  january:   { name: "January · Ice",        mode: "dark",  paper: "#0E1A26", ink: "#E6EEF6", accent: "#5AA8E0", pop: "#E8C46A", correct: "#B7D88C", wrong: "#E58A7A" },
  february:  { name: "February · Valentine", mode: "dark",  paper: "#280A14", ink: "#F8DCDC", accent: "#FF4673", pop: "#FFD93D", correct: "#C8E25E", wrong: "#FFB3B3" },
  march:     { name: "March · St. Patrick",  mode: "dark",  paper: "#0E1F12", ink: "#E8F0D8", accent: "#3FAE56", pop: "#F2C94C", correct: "#C8E25E", wrong: "#E55A4F" },
  april:     { name: "April · Spring",       mode: "light", paper: "#F5EAEF", ink: "#22112A", accent: "#7A4FCC", pop: "#E64A8C", correct: "#3F8030", wrong: "#A92E22" },
  may:       { name: "May · Storm",          mode: "dark",  paper: "#181C24", ink: "#ECE6DC", accent: "#E8C46A", pop: "#94A5BC", correct: "#A8D88C", wrong: "#E58A7A" },
  june:      { name: "June · Summer",        mode: "light", paper: "#F7D9B0", ink: "#2A1620", accent: "#E04A6B", pop: "#F2A02D", correct: "#3F8030", wrong: "#A92E22" },
  july:      { name: "July · 4th",           mode: "dark",  paper: "#0E1A36", ink: "#F4E6C4", accent: "#E63946", pop: "#FFD93D", correct: "#C8E25E", wrong: "#FFB3B3" },
  august:    { name: "August · Late Sun",    mode: "dark",  paper: "#1F1208", ink: "#F2E2B8", accent: "#F08C2A", pop: "#C84A2C", correct: "#C8E25E", wrong: "#E58A7A" },
  september: { name: "September · Fall",     mode: "dark",  paper: "#1A0F08", ink: "#F2DEAE", accent: "#C84A2C", pop: "#E8A02A", correct: "#C8E25E", wrong: "#E58A7A" },
  october:   { name: "October · Halloween",  mode: "dark",  paper: "#120A06", ink: "#F4E6C4", accent: "#F08C2A", pop: "#A94ACC", correct: "#C8E25E", wrong: "#E55A4F" },
  november:  { name: "November · Thanks",    mode: "dark",  paper: "#1E1208", ink: "#F2DEAE", accent: "#C25E22", pop: "#7E8C2A", correct: "#C8E25E", wrong: "#E58A7A" },
  december:  { name: "December · Christmas", mode: "dark",  paper: "#0E1F14", ink: "#F4E6C4", accent: "#E63946", pop: "#F2C94C", correct: "#C8E25E", wrong: "#FFB3B3" },
};

export const THEME_KEYS = Object.keys(TR1VIA_THEMES) as ThemeKey[];

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && value in TR1VIA_THEMES;
}
