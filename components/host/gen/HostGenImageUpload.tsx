// HOST · GENERATE · 6b. IMAGE UPLOAD
// Drag-and-drop file picker. The route owns the file state and calls
// POST /api/images/upload via the onUpload handler. While the request is in
// flight we render the "uploading" treatment.
//
// Wired form: passes the current state ("idle"|"uploading"), an optional
// progress percentage + filename, and an onFileChosen callback that
// receives the File object from the input. All props are optional with
// demo defaults so the /_dev/host/gen gallery still renders.

"use client";

import { Fragment, useRef, type ChangeEvent } from "react";
import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { StockImage } from "./_shared";

export type HostGenImageUploadState = "idle" | "uploading";

export interface HostGenImageUploadProps {
  themeKey?: ThemeKey;
  state?: HostGenImageUploadState;
  /** Topic — drives the eyebrow color. */
  topic?: string;
  /** The question prompt — shown in the eyebrow. */
  prompt?: string;
  /** LaptopShell title. */
  shellTitle?: string;
  /** Recent personal uploads (for the right rail). */
  recent?: Array<{ id: string; seed: string; name: string; used: number; date: string }>;
  /** While uploading: filename + size to display. */
  uploadFilename?: string;
  /** While uploading: progress percentage (0..100). */
  uploadPercent?: number;
  /** Called when the user picks a file. */
  onFileChosen?: (file: File) => void;
  /** Called when the user taps "Back to library". */
  onBack?: () => void;
}

export function HostGenImageUpload(props: HostGenImageUploadProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenImageUploadInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenImageUploadInner {...rest} />;
}

const DEMO_RECENT = [
  { id: "u1", seed: "linda1", name: "Paris · Eiffel night", used: 3,  date: "Apr 9" },
  { id: "u2", seed: "linda2", name: "Café Hugo · table",    used: 1,  date: "Apr 9" },
  { id: "u3", seed: "linda3", name: "Soul Fire · sign",     used: 12, date: "Feb 15" },
];

function HostGenImageUploadInner({
  state = "idle",
  topic = "Pixar Movies",
  prompt = "Ratatouille is set in which city?",
  shellTitle = "upload · pixar movies · q6",
  recent = DEMO_RECENT,
  uploadFilename = "paris-eiffel-2024.jpg",
  uploadPercent = 68,
  onFileChosen,
  onBack,
}: Omit<HostGenImageUploadProps, "themeKey">) {
  const { t } = useTheme();
  const cc = categoryColor(topic, t.accent);
  void cc;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFileChosen?.(file);
  }

  return (
    <LaptopShell title={shellTitle}>
      <div style={{ padding: "24px 56px 0", flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 380px", gap: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Eyebrow color={t.pop} size={11}>IMAGE FOR · &quot;{prompt.toUpperCase()}&quot;</Eyebrow>
          <Display size={32} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            Use your own.
          </Display>
          <div style={{ marginTop: 6, fontSize: 13, color: t.inkMid, lineHeight: 1.4, maxWidth: 540 }}>
            When the library doesn&apos;t have the right thing — your venue photo, a press still, a personal shot — drop it here. It saves to <em style={{ fontStyle: "normal", fontWeight: 700, color: t.ink }}>My photos</em> for future questions.
          </div>

          <div style={{ marginTop: 22, display: "flex", gap: 4, padding: 4, borderRadius: 99, background: t.surface, alignSelf: "flex-start" }}>
            <span style={{ padding: "8px 16px", borderRadius: 99, color: t.inkMid, fontSize: 13, fontWeight: 600 }}>From the library</span>
            <span style={{ padding: "8px 16px", borderRadius: 99, color: t.inkMid, fontSize: 13, fontWeight: 600 }}>My photos</span>
            <span style={{ padding: "8px 16px", borderRadius: 99, background: t.ink, color: t.paper, fontSize: 13, fontWeight: 700 }}>Upload new</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={state === "uploading"}
            style={{
              marginTop: 22, flex: 1, minHeight: 320,
              borderRadius: 14,
              border: `2px ${state === "uploading" ? "solid" : "dashed"} ${state === "uploading" ? t.pop : t.line}`,
              background: state === "uploading" ? (t.dark ? `${t.pop}10` : `${t.pop}06`) : t.surface,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14,
              padding: 24, position: "relative", overflow: "hidden",
              cursor: state === "uploading" ? "default" : "pointer",
              color: t.ink, fontFamily: "inherit",
            }}
          >
            {state === "idle" && (
              <Fragment>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: t.dark ? "rgba(244,230,196,.08)" : "rgba(27,19,12,.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3V15M12 3L7 8M12 3L17 8M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17" stroke={t.inkMid} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div style={{ textAlign: "center" }}>
                  <Display size={26} color={t.ink}>Drop a photo here</Display>
                  <div style={{ marginTop: 6, fontSize: 13, color: t.inkMid }}>or <span style={{ color: t.accent, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 4 }}>click to browse</span> your computer</div>
                </div>
              </Fragment>
            )}
            {state === "uploading" && (
              <Fragment>
                <div style={{ width: "60%", maxWidth: 380 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span style={{ fontSize: 14, color: t.ink, fontWeight: 600 }}>{uploadFilename}</span>
                    <Numeric size={12} color={t.inkMid}>{Math.round(uploadPercent)}%</Numeric>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: t.line, overflow: "hidden", position: "relative" }}>
                    <div style={{ width: `${uploadPercent}%`, height: "100%", background: t.pop, transition: "width .4s ease-out" }} />
                    <div style={{
                      position: "absolute", inset: 0,
                      background: `linear-gradient(90deg, transparent, ${t.pop}66, transparent)`,
                      backgroundSize: "200% 100%",
                      animation: "tr1via-shimmer 1.4s linear infinite",
                    }} />
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: t.inkMid, textAlign: "center" }}>uploading and scanning · about 1 second</div>
                </div>
              </Fragment>
            )}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 24, overflow: "auto" }}>
          <Eyebrow color={t.inkMute} size={10}>RECENT · MY PHOTOS</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recent.map((p) => (
              <div key={p.id} style={{
                display: "grid", gridTemplateColumns: "52px 1fr", alignItems: "center", gap: 12,
                padding: 8, borderRadius: 10, background: t.surface,
              }}>
                <div style={{ width: 52, height: 52, borderRadius: 8, overflow: "hidden" }}>
                  <StockImage seed={p.seed} height="100%" radius="8px" />
                </div>
                <div>
                  <div style={{ fontSize: 13, color: t.ink, fontWeight: 600 }}>{p.name}</div>
                  <div style={{ marginTop: 2, fontSize: 11, color: t.inkMid }}>
                    used <Numeric size={11} weight={600} color={t.ink}>{p.used}</Numeric>×  ·  <span style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>{p.date}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 6, padding: "14px 16px", borderRadius: 12, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>WHAT MAKES A GOOD PHOTO</Eyebrow>
            <ul style={{ marginTop: 8, paddingLeft: 16, fontSize: 12, color: t.inkMid, lineHeight: 1.6 }}>
              <li>Real, not AI-generated — flat photos read poorly on the TV.</li>
              <li>Wide / landscape works better than tall.</li>
              <li>Direct subject in the frame (the thing the question is about).</li>
              <li>No watermarks, no logos in the corner.</li>
            </ul>
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={onBack}
              style={{ background: "transparent", color: t.inkMid, border: `1px solid ${t.line}`, borderRadius: 12, padding: "12px 0", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-sans)", cursor: "pointer" }}
            >
              ← Back to library
            </button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
