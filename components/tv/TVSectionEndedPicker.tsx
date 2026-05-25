// TV — SECTION ENDED PICKER.
//
// Shown on the venue TV (and the host laptop, since it's HDMI'd) right
// after a category finishes and at least one OTHER category still has
// unplayed questions. Replaces the dead-state grid that Brandon's
// playthrough kept getting stuck on ("After there's no more questions in
// a section, why does it just sit there?"). One tap from the host →
// auto-reveal of that topic's lowest-points unplayed question.
//
// The audience sees the same rows the host taps — pre-tap state of the
// reveal becomes part of the show. On the standalone `/tv/[code]` route
// (audience only, no host input), `onTopicClick` is omitted and the rows
// render as inert info ("here's what's left, the host is choosing").
//
// Driven by props for the live host console; demo defaults preserved for
// the `/dev/tv` gallery.

"use client";

import { TVStage, TVHeader, TVFooter } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVSectionEndedTopic {
  /** Display name — the category title. */
  name: string;
  /** Color from the categories table; falls back to `categoryColor(name)`. */
  color?: string | null;
  /** Picked questions remaining (unplayed) in this category. */
  remainingCount: number;
  /** Total picked questions in this category (e.g. 7). */
  totalCount: number;
  /** Underlying question id the picker fires on tap (lowest-points
   *  unplayed). Required when the parent passes `onTopicClick`. */
  questionId?: string | null;
}

export interface TVSectionEndedPickerProps {
  themeKey?: ThemeKey;
  /** Header copy left side, e.g. "GAME 1 · SECTION COMPLETE". */
  headerLeft?: string;
  /** Header copy right side, e.g. "5 OF 14 ANSWERED". */
  headerRight?: string;
  /** Footer left, e.g. "TR1VIA.COM · K9·PR4M". */
  footerLeft?: string;
  /** Footer right, e.g. "HOST PICKS · ONE TAP REVEALS". */
  footerRight?: string;
  /** Topics still available. Rendered in the passed order (usually by
   *  category `position`). */
  topics?: TVSectionEndedTopic[];
  /** When provided, each topic row becomes a button — click fires the
   *  callback with the lowest-points question id. Omitted on the
   *  standalone audience TV so the rows stay inert. */
  onTopicClick?: (questionId: string) => void;
}

const DEMO_TOPICS: TVSectionEndedTopic[] = [
  { name: "Geography", remainingCount: 7, totalCount: 7 },
  { name: "Music",     remainingCount: 4, totalCount: 7 },
  { name: "Movies",    remainingCount: 7, totalCount: 7 },
  { name: "History",   remainingCount: 7, totalCount: 7 },
];

export function TVSectionEndedPicker({ themeKey, ...rest }: TVSectionEndedPickerProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <TVSectionEndedPickerInner {...rest} />
      </ThemeProvider>
    );
  }
  return <TVSectionEndedPickerInner {...rest} />;
}

function TVSectionEndedPickerInner({
  headerLeft = "GAME 1 · SECTION COMPLETE",
  headerRight = "5 OF 14 ANSWERED",
  footerLeft = "TR1VIA.COM · K9·PR4M",
  footerRight = "HOST PICKS · ONE TAP REVEALS",
  topics = DEMO_TOPICS,
  onTopicClick,
}: Omit<TVSectionEndedPickerProps, "themeKey">) {
  const { t } = useTheme();

  return (
    <TVStage data-testid="tv-section-ended-picker">
      <TVHeader left={headerLeft} right={headerRight} />

      <div
        style={{
          flex: 1,
          padding: "12px 56px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          position: "relative",
          zIndex: 1,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Eyebrow color={t.inkMid} size={12}>NEXT TOPIC</Eyebrow>
          <Display size={56} color={t.ink} weight={700}>
            Pick the next <span style={{ color: t.accent }}>topic</span>.
          </Display>
        </div>

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns:
              topics.length > 3 ? "repeat(2, 1fr)" : "1fr",
            gridAutoRows: "1fr",
            gap: 14,
            minHeight: 0,
          }}
        >
          {topics.map((topic) => {
            const cc = topic.color ?? categoryColor(topic.name, t.accent);
            const clickable = !!onTopicClick && !!topic.questionId;
            const row = (
              <div
                style={{
                  height: "100%",
                  borderRadius: 14,
                  background: cc,
                  color: "#0E0805",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 28px",
                  fontFamily: "var(--font-sans)",
                  position: "relative",
                  overflow: "hidden",
                  border: "none",
                  cursor: clickable ? "pointer" : "default",
                  textAlign: "left",
                  width: "100%",
                  boxShadow: `0 14px 30px -16px ${cc}99`,
                  transition: "transform .2s cubic-bezier(.2,.7,.3,1)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <Eyebrow color="rgba(14,8,5,.55)" size={10}>
                    TAP TO START
                  </Eyebrow>
                  <div
                    style={{
                      fontSize: 32,
                      fontWeight: 700,
                      letterSpacing: "-0.012em",
                      lineHeight: 1.1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {topic.name}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 2,
                  }}
                >
                  <Numeric size={28} weight={700} color="#0E0805" tracking={-0.02}>
                    {topic.remainingCount}
                  </Numeric>
                  <Eyebrow color="rgba(14,8,5,.55)" size={9}>
                    OF {topic.totalCount} LEFT
                  </Eyebrow>
                </div>
              </div>
            );
            if (clickable && topic.questionId) {
              return (
                <button
                  key={topic.name}
                  type="button"
                  onClick={() => onTopicClick(topic.questionId!)}
                  data-testid={`tv-section-picker-topic-${slug(topic.name)}`}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  {row}
                </button>
              );
            }
            return (
              <div
                key={topic.name}
                data-testid={`tv-section-picker-topic-${slug(topic.name)}`}
              >
                {row}
              </div>
            );
          })}
        </div>
      </div>

      <TVFooter left={footerLeft} right={footerRight} />
    </TVStage>
  );
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
