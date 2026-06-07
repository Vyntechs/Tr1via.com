// POST /api/founder/build-game — founder-only validation tool. Builds a
// complete, REAL night (2 games × 6 categories × 7 questions) by driving the
// same endpoints a host walks: /api/nights → /api/categories →
// /api/categories/[id]/generate (with autoPick). The only automation is
// choosing realistic topics + keeping 7 of the 20 generated questions. Returns
// as soon as generation is kicked off; categories fill + auto-lock in the
// background (~1-2 min).

import { type NextRequest } from "next/server";
import { requireFounder } from "@/lib/api/auth";
import { forbidden, ok, serverError, unauthorized } from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { makeInternalFetch } from "@/lib/api/internalFetch";
import { pickRealTopics } from "@/lib/host/realTopicBank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GAMES_PER_NIGHT = 2;
const CATEGORIES_PER_GAME = 6;

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
  const { nightId, roomCode } = (await nightRes.json()) as {
    nightId: string;
    roomCode: string;
  };

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
