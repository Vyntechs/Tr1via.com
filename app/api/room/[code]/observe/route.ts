import { type NextRequest } from "next/server";
import { parseRoomCode, isValidRoomCode } from "@/lib/game/room-code";
import {
  parseObservationRevision,
  persistSurfaceObservation,
  resolvePlayerObservationContext,
} from "@/lib/api/gameDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function empty(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = parseRoomCode((await ctx.params).code);
  if (!isValidRoomCode(code)) return empty(404);
  let body: unknown;
  try { body = await req.json(); } catch { return empty(400); }
  const revision = parseObservationRevision(body);
  if (!revision) return empty(400);
  const resolved = await resolvePlayerObservationContext(code);
  if (!resolved.ok) return empty(resolved.status);
  if (JSON.stringify(revision) !== JSON.stringify(resolved.context.canonical)) return empty(409);
  const result = await persistSurfaceObservation(resolved.context, revision);
  if (result === "mismatch" || result === "stale") return empty(409);
  if (result === "error") return empty(500);
  return empty(204);
}
