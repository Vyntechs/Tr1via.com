// Server side of the venue TV's diagnostic pass (see lib/diagnostics/tvPass.ts).
// Rendered inside <Suspense> by app/tv/[code]/layout.tsx, so the TV screen
// never waits for it: the page paints at once and the pass arrives a moment
// later. Draws nothing.

import { issueTvPassForRoom } from "@/lib/diagnostics/tvPass";
import { DiagTvPassSetter } from "./DiagTvPassSetter";

async function passFor(params: Promise<{ code: string }>): Promise<string | null> {
  try {
    const { code } = await params;
    return await issueTvPassForRoom(decodeURIComponent(code));
  } catch {
    return null;
  }
}

export async function DiagTvPass({ params }: { params: Promise<{ code: string }> }) {
  const pass = await passFor(params);
  return pass ? <DiagTvPassSetter pass={pass} /> : null;
}
