// scripts/validate-build-full-game.mjs
//
// Drives the founder "Build a full game" endpoint against a running build,
// waits for all 12 categories to auto-generate + lock, and asserts the night
// is a complete, real 2-game board. Cleans up the night afterward.
//
// Run: SMOKE_BASE_URL=http://localhost:3050 \
//   node --env-file=.env.local scripts/validate-build-full-game.mjs
//
// Requires: a running app with Anthropic + Pexels keys, and the founder
// account (SMOKE_FOUNDER_EMAIL) present in public.hosts.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3050";
const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? "brandon@vyntechs.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const jar = new Map();
function ingestSetCookie(raw) {
  if (!raw) return;
  for (const part of raw.split(/,(?=[^ ;]+=)/)) {
    const [pair] = part.split(";");
    const eq = pair?.indexOf("=") ?? -1;
    if (eq === -1) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
      ...(init.headers ?? {}),
    },
  });
  ingestSetCookie(res.headers.get("set-cookie"));
  return res;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  pass++;
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log(`build-full-game validation @ ${BASE}`);

  // 1. Founder login.
  const login = await call("/api/auth/founder-login", {
    method: "POST",
    body: JSON.stringify({ email: FOUNDER_EMAIL }),
  });
  assert(login.ok, `founder-login ok (${login.status})`);

  // 2. Build.
  const buildRes = await call("/api/founder/build-game", { method: "POST" });
  assert(buildRes.ok, `build-game accepted (${buildRes.status})`);
  const { nightId, categoryIds, generating } = await buildRes.json();
  assert(!!nightId, "returned a nightId");
  assert(categoryIds.length === 12, `created 12 categories (got ${categoryIds.length})`);
  assert(generating === 12, `kicked 12 generations (got ${generating})`);

  try {
    // 3. Poll until all 12 categories reach 'ready' (or timeout ~5 min).
    const deadline = Date.now() + 300_000;
    let ready = 0;
    while (Date.now() < deadline) {
      const { data: cats } = await admin
        .from("categories")
        .select("id, state")
        .in("id", categoryIds);
      ready = (cats ?? []).filter((c) => c.state === "ready").length;
      console.log(`  … ${ready}/12 ready`);
      if (ready === 12) break;
      await sleep(5000);
    }
    assert(ready === 12, `all 12 categories reached 'ready' (got ${ready})`);

    // 4. Structure: 2 games, each 6 categories, each 7 picked questions.
    const { data: games } = await admin
      .from("games")
      .select("id, game_no")
      .eq("night_id", nightId);
    assert(games.length === 2, `night has 2 games (got ${games.length})`);

    let imageCount = 0;
    let questionCount = 0;
    for (const catId of categoryIds) {
      const { data: qs } = await admin
        .from("questions")
        .select("id, is_picked, point_value, image_url, prompt, options, correct_index")
        .eq("category_id", catId)
        .eq("is_picked", true);
      assert(qs.length === 7, `category ${catId.slice(0, 8)} has 7 picked (got ${qs.length})`);
      const pvs = qs.map((q) => q.point_value).sort((a, b) => a - b);
      assert(
        JSON.stringify(pvs) === JSON.stringify([100, 200, 300, 400, 500, 600, 700]),
        `category ${catId.slice(0, 8)} point values are 100..700`,
      );
      for (const q of qs) {
        questionCount++;
        if (q.image_url) imageCount++;
        assert(typeof q.prompt === "string" && q.prompt.length > 0, "question has a prompt");
        assert(Array.isArray(q.options) && q.options.length === 4, "question has 4 options");
        assert(q.correct_index >= 0 && q.correct_index <= 3, "question has a valid correct_index");
      }
    }
    assert(questionCount === 84, `84 picked questions total (got ${questionCount})`);
    // Pexels free-tier may rate-limit a 12-cat burst; require a strong majority.
    assert(imageCount >= 60, `most questions got a real photo (${imageCount}/84)`);
    console.log(`  ℹ ${imageCount}/84 questions have a Pexels image`);
  } finally {
    // 5. Cleanup (cascade removes games → categories → questions).
    await admin.from("nights").delete().eq("id", nightId);
    console.log("  ✓ cleaned up the test night");
  }

  console.log(`\nALL GREEN — ${pass} assertions passed.`);
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
});
