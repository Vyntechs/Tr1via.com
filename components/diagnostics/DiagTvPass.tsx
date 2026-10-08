// Server side of the venue TV's diagnostic pass (see lib/diagnostics/tvPass.ts).
// Rendered inside <Suspense> by app/tv/[code]/layout.tsx, so the TV screen
// never waits for it: the page paints at once and the pass arrives a moment
// later. Draws nothing.

import { issueTvPassForRoom } from "@/lib/diagnostics/tvPass";
import { DiagTvPassSetter } from "./DiagTvPassSetter";

export async function DiagTvPass({ params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const pass = await issueTvPassForRoom(decodeURIComponent(code));
    return pass ? <DiagTvPassSetter pass={pass} /> : null;
  } catch {
    return null;
  }
}
