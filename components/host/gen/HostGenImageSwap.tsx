// HOST · GENERATE · 6. IMAGE SWAP
// Stock photo picker (real photos, never AI). Three rails: auto-matched
// library suggestions, her own uploads, upload new. Right rail is a live
// TV reveal preview.
//
// Wired form: the pick route passes the list of alternative photos
// (fetched from GET /api/questions/[id]/photos), the current image URL,
// the question prompt + point value, and handlers for choose/upload/back.

"use client";

import { useState } from "react";
import {
  Display,
  Eyebrow,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { StockImage } from "./_shared";

export interface HostGenPhotoCandidate {
  /** Pexels photo id, or a stable opaque key. */
  id: string;
  /** Display URL (we render it via <StockImage seed=...>; the wired version
   *  could swap in a real <Image> tag). */
  url: string;
  attribution?: string;
}

export interface HostGenImageSwapProps {
  themeKey?: ThemeKey;
  /** LaptopShell title. */
  shellTitle?: string;
  /** Topic, used for the eyebrow + category color. */
  topic?: string;
  /** The question prompt — shown in the eyebrow + preview. */
  prompt?: string;
  /** Point value for the preview footer. */
  pointValue?: number;
  /** Current image URL (the one being replaced). */
  currentImageUrl?: string | null;
  /** Alternative library candidates. */
  candidates?: HostGenPhotoCandidate[];
  /** Called when the host taps "Use this image". */
  onChoose?: (candidate: HostGenPhotoCandidate) => void;
  /** Called when the host taps the upload-your-own tile. */
  onOpenUpload?: () => void;
  /** Called when the host taps "More from library" / refresh. */
  onLoadMore?: () => void;
  /** Called when the host taps "Back without changes". */
  onBack?: () => void;
  /** True while the photo patch / refresh is in flight. */
  isSaving?: boolean;
}

const DEMO_CANDIDATES: HostGenPhotoCandidate[] = [
  { id: "rat1", url: "rat1" },
  { id: "rat2", url: "rat2" },
  { id: "rat3", url: "rat3" },
  { id: "rat4", url: "rat4" },
  { id: "rat5", url: "rat5" },
  { id: "rat6", url: "rat6" },
  { id: "rat7", url: "rat7" },
  { id: "rat8", url: "rat8" },
];

export function HostGenImageSwap(props: HostGenImageSwapProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenImageSwapInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenImageSwapInner {...rest} />;
}

function HostGenImageSwapInner({
  shellTitle = "image · pixar movies · q6",
  topic = "Pixar Movies",
  prompt = "Ratatouille is set in which city?",
  pointValue = 200,
  currentImageUrl = "rat1",
  candidates = DEMO_CANDIDATES,
  onChoose,
  onOpenUpload,
  onLoadMore,
  onBack,
  isSaving = false,
}: Omit<HostGenImageSwapProps, "themeKey">) {
  const { t } = useTheme();
  const cc = categoryColor(topic, t.accent);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const previewUrl = selected?.url ?? currentImageUrl ?? candidates[0]?.url ?? "";

  return (
    <LaptopShell title={shellTitle}>
      <div style={{ padding: "24px 56px 0", flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 360px", gap: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Eyebrow color={cc} size={11}>IMAGE FOR · &quot;{prompt.toUpperCase()}&quot;</Eyebrow>
          <Display size={32} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            Pick a better photo.
          </Display>
          <div style={{ marginTop: 6, fontSize: 13, color: t.inkMid, lineHeight: 1.4, maxWidth: 540 }}>
            Three places to look — auto-matched options, photos you&apos;ve used before, or upload your own.
          </div>

          {/* Tabs */}
          <div style={{ marginTop: 22, display: "flex", gap: 4, padding: 4, borderRadius: 99, background: t.surface, alignSelf: "flex-start" }}>
            {[
              { id: "lib", label: "From the library", sub: `${candidates.length} fresh`, active: true },
              { id: "mine", label: "My photos", sub: "0 saved", active: false },
              { id: "upload", label: "Upload new", sub: "+ add", active: false },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={tab.id === "upload" ? onOpenUpload : undefined}
                style={{
                  padding: "8px 16px", borderRadius: 99,
                  background: tab.active ? t.ink : "transparent",
                  color: tab.active ? t.paper : t.ink,
                  border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                {tab.label}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, opacity: 0.6, fontWeight: 500, letterSpacing: "0.05em" }}>{tab.sub}</span>
              </button>
            ))}
          </div>

          {/* From the library */}
          <div style={{ marginTop: 18, flex: 1, overflow: "auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, gridAutoRows: "130px", paddingBottom: 24 }}>
            {candidates.map((c) => {
              const isCurrent = c.url === currentImageUrl;
              const isSelected = selectedId === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    position: "relative", borderRadius: 12, overflow: "hidden",
                    border: `2px solid ${isSelected ? cc : "transparent"}`,
                    cursor: "pointer",
                    boxShadow: isSelected ? `0 10px 24px -10px ${cc}88` : "none",
                    padding: 0, background: "transparent",
                  }}
                >
                  <StockImage seed={c.url} height="100%" radius="10px" />
                  {isCurrent && (
                    <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 99, background: "rgba(0,0,0,.55)", color: t.pop, fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>CURRENT</div>
                  )}
                  {isSelected && (
                    <div style={{
                      position: "absolute", top: 8, right: 8,
                      width: 22, height: 22, borderRadius: 99, background: cc,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="#0E0805" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={onLoadMore}
              style={{
                gridColumn: "span 2",
                borderRadius: 12, border: `1.5px dashed ${t.line}`,
                background: "transparent", color: t.ink,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                cursor: "pointer", fontFamily: "var(--font-sans)",
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 300, color: t.inkMid }}>↻</span>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Show twelve more</span>
              <span style={{ fontSize: 10, color: t.inkMute }}>from the same library</span>
            </button>
            <button
              type="button"
              onClick={onOpenUpload}
              style={{
                gridColumn: "span 2",
                borderRadius: 12, border: `1.5px solid ${t.pop}`,
                background: t.dark ? `${t.pop}10` : `${t.pop}08`, color: t.ink,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                cursor: "pointer", fontFamily: "var(--font-sans)",
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 300, color: t.pop }}>↑</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Upload your own</span>
              <span style={{ fontSize: 10, color: t.inkMid }}>drag a file or paste a link</span>
            </button>
          </div>
        </div>

        {/* Right preview rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24 }}>
          <Eyebrow color={t.inkMute} size={10}>PREVIEW · TV REVEAL</Eyebrow>
          <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${t.line}` }}>
            <StockImage seed={previewUrl || "rat4"} height={200} radius="12px 12px 0 0" />
            <div style={{ padding: "16px 18px", background: cc, color: "#0E0805" }}>
              <Eyebrow color="rgba(14,8,5,.65)" size={9}>{topic.toUpperCase()} · {pointValue} PTS</Eyebrow>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{prompt}</div>
            </div>
          </div>

          <div style={{ padding: "14px 16px", borderRadius: 12, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>WHAT&apos;S ALLOWED</Eyebrow>
            <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 12, color: t.inkMid, lineHeight: 1.6 }}>
              <li>Real photos. JPG, PNG, WebP.</li>
              <li>Up to 10 MB each.</li>
              <li>Photos you own or can use freely.</li>
              <li>No AI-generated images — they read flat on the TV.</li>
            </ul>
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={() => selected && onChoose?.(selected)}
              disabled={!selected || isSaving}
              style={{
                background: t.accent, color: "#FFF",
                border: "none", borderRadius: 12, padding: "14px 0",
                fontSize: 14, fontWeight: 700, fontFamily: "var(--font-sans)",
                cursor: !selected || isSaving ? "not-allowed" : "pointer",
                opacity: !selected || isSaving ? 0.65 : 1,
              }}
            >
              {isSaving ? "Saving…" : "Use this image"}
            </button>
            <button
              type="button"
              onClick={onBack}
              style={{ background: "transparent", color: t.inkMute, border: "none", padding: "4px 0", fontSize: 12, fontWeight: 500, fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              ← Back without changes
            </button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
