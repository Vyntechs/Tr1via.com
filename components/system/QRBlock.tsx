// Real QR code rendering using the `qrcode` package's synchronous matrix API.
// Generates an inline SVG that scales crisply from a phone preview to a venue
// TV. Client component so it can subscribe to the active theme (which dictates
// the dark/light contrast of the QR card).
//
// Usage:
//   <QRBlock url="https://tr1via.com/join/K9PR4M" size={300}/>
//   <QRBlock url={...} light/>   // force white card (TV-friendly)

"use client";

import QRCode from "qrcode";
import { useMemo } from "react";
import { useTheme } from "./ThemeProvider";

export interface QRBlockProps {
  url: string;
  /** Pixel size as a number, or any CSS length string (e.g. `"clamp(180px, 25vh, 300px)"`)
   *  for callers that need the QR to respond to viewport. Padding scales
   *  proportionally via CSS `calc()` when a string is passed. */
  size?: number | string;
  /** Force a white card with dark code — for use on the venue TV where
   *  contrast against the room matters more than theme harmony. */
  light?: boolean;
}

export function QRBlock({ url, size = 220, light = false }: QRBlockProps) {
  const { t } = useTheme();

  const matrix = useMemo(() => {
    // QRCode.create() returns a QRCode object with .modules.{size,data}
    // synchronously. `data` is a Uint8Array of N*N cells (1 = on, 0 = off).
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    return { n: qr.modules.size, data: qr.modules.data };
  }, [url]);

  const bg = light ? "#FFFFFF" : t.dark ? t.ink : "#FFFFFF";
  const fg = light ? "#0E0805" : t.dark ? t.paper : t.ink;

  // Padding scales with size — 4.5% of the box keeps the quiet zone
  // proportional whether `size` is a pixel number or a clamp() expression.
  const padding = typeof size === "number" ? size * 0.045 : `calc(${size} * 0.045)`;

  return (
    <div
      style={{
        width: size,
        height: size,
        background: bg,
        borderRadius: 14,
        padding,
        boxSizing: "border-box",
      }}
    >
      <svg viewBox={`0 0 ${matrix.n} ${matrix.n}`} width="100%" height="100%" aria-label={`QR code: ${url}`}>
        {Array.from(matrix.data).map((cell, idx) => {
          if (!cell) return null;
          const x = idx % matrix.n;
          const y = Math.floor(idx / matrix.n);
          return <rect key={idx} x={x} y={y} width="1" height="1" fill={fg} />;
        })}
      </svg>
    </div>
  );
}
