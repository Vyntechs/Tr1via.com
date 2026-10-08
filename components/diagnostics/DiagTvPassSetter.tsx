// Hands the signed TV pass (lib/diagnostics/tvPass.ts) to the device reporter.
// Draws nothing. Rendered only on the venue TV page, and only when the server
// issued a pass (logging on and a real room).

"use client";

import { useEffect } from "react";
import { setDiagTvPass } from "@/lib/diagnostics/client";

export function DiagTvPassSetter({ pass }: { pass: string }) {
  useEffect(() => {
    setDiagTvPass(pass);
    return () => setDiagTvPass(null);
  }, [pass]);
  return null;
}
