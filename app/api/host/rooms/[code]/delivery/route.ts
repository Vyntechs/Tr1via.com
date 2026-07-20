import { type NextRequest } from "next/server";
import { parseRoomCode, isValidRoomCode } from "@/lib/game/room-code";
import { readOwnedDeliveryReceipt } from "@/lib/api/gameDelivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function empty(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const code = parseRoomCode((await ctx.params).code);
  if (!isValidRoomCode(code)) return empty(404);
  const result = await readOwnedDeliveryReceipt(code);
  if (!result.ok) return empty(result.status);
  return Response.json(result.body, { headers: { "Cache-Control": "no-store" } });
}
