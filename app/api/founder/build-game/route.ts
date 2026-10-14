// POST /api/founder/build-game — founder-only validation tool. Builds a
// complete, REAL night (2 games × 6 categories × 7 questions) by driving the
// same endpoints a host walks: /api/nights → /api/categories →
// /api/categories/[id]/generate (with autoPick). The only automation is
// choosing realistic topics + keeping 7 of the 20 generated questions. Returns
// as soon as generation is kicked off; categories fill + auto-lock in the
// background (~1-2 min).

import { type NextRequest } from "next/server";
import { requireFounder } from "@/lib/api/auth";
import { forbidden, ok, serverError, unauthorized, conflict } from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { makeInternalFetch } from "@/lib/api/internalFetch";
import { pickRealTopics } from "@/lib/host/realTopicBank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAMES_PER_NIGHT = 2;
const CATEGORIES_PER_GAME = 6;
// A build adds its first topic within a second or two of making the night.
// A handed-back night still without topics after this long has no build on it.
const BUILD_STALE_MS = 30_000;

type ReusedDecision = "filling" | "wait" | "take_over";

async function reusedNightDecision(
  admin: ReturnType<typeof getSupabaseAdmin>,
  nightId: string,
  nowMs: number = Date.now(),
): Promise<ReusedDecision> {
  const { data: night } = await admin
    .from("nights")
    .select("created_at")
    .eq("id", nightId)
    .maybeSingle();
  const { data: games } = await admin.from("games").select("id").eq("night_id", nightId);
  const gameIds = ((games ?? []) as Array<{ id: string }>).map((g) => g.id);
  if (!night || gameIds.length === 0) return "wait";
  const { data: cats, error } = await admin
    .from("categories")
    .select("id")
    .in("game_id", gameIds)
    .limit(1);
  if (error) return "wait";
  if ((cats ?? []).length > 0) return "filling";
  const ageMs = nowMs - Date.parse((night as { created_at: string }).created_at);
  return ageMs > BUILD_STALE_MS ? "take_over" : "wait";
}

export async function POST(req: NextRequest) {
  const auth = await requireFounder();
  if (!auth.ok) {
    return auth.status === 401 ? unauthorized(auth.error) : forbidden(auth.error);
  }

  const call = makeInternalFetch(req);
  const admin = getSupabaseAdmin();

  // 1. Create the night (+ 2 game shells) via the real endpoint.
  const venueName = `Build Test · ${auth.host.display_name}`;
  const nightRes = await call("/api/nights", {
    method: "POST",
    body: JSON.stringify({ venueName }),
  });
  if (!nightRes.ok) {
    return serverError(
      `create night failed: ${nightRes.status} ${await nightRes.text()}`,
    );
  }
  const { nightId, roomCode, reused } = (await nightRes.json()) as {
    nightId: string;
    roomCode: string;
    reused?: boolean;
  };
  // /api/nights hands back a fresh empty night instead of making a twin.
  // Either another build is filling it right now (double tap), or an earlier
  // build made it and died before adding topics. Adding a second set of
  // topics to a night another build is filling would double every slot, so:
  //   - it already has topics: another build is filling it; open that one;
  //   - no topics and it is young: that build may be about to add them; stop;
  //   - no topics and older than BUILD_STALE_MS: that build died; fill it.
  if (reused) {
    const decision = await reusedNightDecision(admin, nightId);
    if (decision === "filling") {
      return ok({ nightId, roomCode, categoryIds: [], generating: 0, failedKicks: [], alreadyBuilding: true });
    }
    if (decision === "wait") {
      return conflict(
        "A build for this night just started. Wait a few seconds, then open it from the dashboard.",
      );
    }
  }

  // 2. Look up the two game shells /api/nights just created.
  const { data: games, error: gamesError } = await admin
    .from("games")
    .select("id, game_no")
    .eq("night_id", nightId)
    .order("game_no");
  if (gamesError || !games || games.length !== GAMES_PER_NIGHT) {
    await admin.from("nights").delete().eq("id", nightId);
    return serverError(gamesError?.message ?? "games lookup failed");
  }

  // 3. Distinct realistic topics for the whole night; create all categories
  //    via the real endpoint (draft state).
  const topics = pickRealTopics(nightId, GAMES_PER_NIGHT * CATEGORIES_PER_GAME);
  const categoryIds: string[] = [];
  try {
    let t = 0;
    for (const game of games) {
      for (let position = 1; position <= CATEGORIES_PER_GAME; position++) {
        const topic = topics[t++];
        const catRes = await call("/api/categories", {
          method: "POST",
          body: JSON.stringify({
            gameId: game.id,
            name: topic.name,
            topic: topic.topic,
            position,
          }),
        });
        if (!catRes.ok) {
          throw new Error(
            `create category ${topic.name}: ${catRes.status} ${await catRes.text()}`,
          );
        }
        const { category } = (await catRes.json()) as { category: { id: string } };
        categoryIds.push(category.id);
      }
    }
  } catch (e) {
    // Best-effort cleanup; the cascade removes games → categories.
    await admin.from("nights").delete().eq("id", nightId);
    return serverError(e instanceof Error ? e.message : String(e));
  }

  // 4. Fire REAL generation on all 12 categories in parallel. Each returns 202
  //    immediately and runs its own background job (Claude + Pexels photos),
  //    then auto-picks 7 + flips to 'ready' (autoPick:true). We await only the
  //    202s, not generation completion.
  const kicks = await Promise.all(
    categoryIds.map(async (categoryId) => {
      const res = await call(`/api/categories/${categoryId}/generate`, {
        method: "POST",
        body: JSON.stringify({ autoPick: true }),
      });
      return { categoryId, ok: res.ok, status: res.status };
    }),
  );
  const failedKicks = kicks.filter((k) => !k.ok);

  return ok({
    nightId,
    roomCode,
    categoryIds,
    generating: kicks.length - failedKicks.length,
    failedKicks,
  });
}
