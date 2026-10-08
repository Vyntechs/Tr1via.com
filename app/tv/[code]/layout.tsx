// Layout for the venue TV surface. Hides every scroll bar / browser chrome
// the host's browser might otherwise show — the TV runs in fullscreen on
// the venue display via the host's laptop, so we lock the body to a single
// non-scrolling viewport. The page handles the 16:9 stage scaling itself.

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { DiagTvPass } from "@/components/diagnostics/DiagTvPass";
import { diagnosticsEnabled } from "@/lib/diagnostics/config";

export const metadata: Metadata = {
  title: "TR1VIA · TV",
  // The TV is a public, anonymous read-only surface — no need for the
  // browser to crawl it.
  robots: { index: false, follow: false },
};

export default function TVLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  return (
    <>
      {/* Diagnostic logging only: gives this TV page the signed pass its
          reports need. Left out entirely unless DIAGNOSTIC_LOGGING is on, and
          wrapped so the TV never waits for it. Draws nothing. */}
      {diagnosticsEnabled() ? (
        <Suspense fallback={null}>
          <DiagTvPass params={params} />
        </Suspense>
      ) : null}
      {/* Reset body padding + lock the viewport to non-scrolling so the
          TV stage owns the whole screen. Scoped to this route only via the
          layout — does not affect player or host surfaces. */}
      <style>{`
        html, body {
          margin: 0;
          padding: 0;
          height: 100%;
          overflow: hidden;
          background: #000;
        }
      `}</style>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#000",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </>
  );
}
