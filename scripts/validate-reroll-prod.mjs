// Reroll validation driver. Proves Heather's "↻ Another 20" fix against prod,
// HTTP-only, no browser. Models a host who generates a category, "keeps" 3
// questions, then rerolls — and asserts the keep/swap/no-repeat contract.
//
// Asserts after the reroll:
//   1. the 3 kept ids still exist in `questions`
//   2. the prior UNPICKED ids are gone (swapped out, not piled on)
//   3. no new question repeats a prompt the host already saw (avoid-list works)
//   4. the pool is kept(3) + ~20 fresh — not the unbounded 40/60 of the old bug
//
// Usage:
//   node --env-file=.env.local scripts/validate-reroll-prod.mjs [topic]
//
// Exit 0 = green. Exit 1 = the reroll contract is broken; the printout names
// the failing assertion + DB state.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SMOKE_BASE_URL ?? "https://tr1via.com";
const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? "brandon@vyntechs.com";
const TOPIC = process.argv[2] ?? "Famous lighthouses of the world";
const GEN_TIMEOUT_MS = 100_000;
const POLL_MS = 2_000;

const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supaUrl || !supaKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(supaUrl, supaKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90 };
const c = (s, col) => `\x1b[${codes[col]}m${s}\x1b[0m`;
const pass = (s) => console.log(`  ${c("✓", "green")} ${s}`);
const step = (s) => console.log(`\n${c("▸", "cyan")} ${s}`);
const note = (s) => console.log(`  ${c("·", "gray")} ${s}`);

class Jar {
  constructor() {
    this.cookies = new Map();
  }
  apply(h) {
    if (!h) return;
    for (const p of h.split(/,(?=[^ ;]+=)/)) {
      const [pair] = p.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function call(jar, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: jar.header(), ...(init.headers ?? {}) },
  });
  jar.apply(res.headers.get("set-cookie"));
  return res;
}

// Poll until the category is back in `review` with at least `minQuestions`
// rows, then return all rows (id, prompt, is_picked).
async function waitForReview(categoryId, minQuestions, label) {
  const deadline = Date.now() + GEN_TIMEOUT_MS;
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() < deadline) {
    const { data: cat } = await admin
      .from("categories")
      .select("state")
      .eq("id", categoryId)
      .maybeSingle();
    if (cat?.state !== lastState) {
      note(`(${label}) state=${cat?.state} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
      lastState = cat?.state;
    }
    if (cat?.state === "draft") throw new Error(`(${label}) rolled back to draft`);
    if (cat?.state === "review" || cat?.state === "ready") {
      const { data: qs } = await admin
        .from("questions")
        .select("id, prompt, is_picked")
        .eq("category_id", categoryId);
      if ((qs?.length ?? 0) >= minQuestions) return qs;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`(${label}) timed out waiting for review with >=${minQuestions} questions`);
}

let nightId = null;
let failed = false;
const founderJar = new Jar();

try {
  console.log(`\n${c("═══ TR1VIA reroll validation ═══", "cyan")}`);
  console.log(`  base : ${BASE}`);
  console.log(`  topic: ${TOPIC}`);

  step("1. founder login");
  {
    const res = await call(founderJar, "/api/auth/founder-login", {
      method: "POST",
      body: JSON.stringify({ email: FOUNDER_EMAIL }),
    });
    if (!res.ok) throw new Error(`login: ${res.status} ${await res.text()}`);
    if (founderJar.cookies.size === 0) throw new Error("no auth cookies");
    pass(`logged in (${founderJar.cookies.size} cookies)`);
  }

  step("2. create night + resolve game 1");
  let game1Id = null;
  {
    const res = await call(founderJar, "/api/nights", {
      method: "POST",
      body: JSON.stringify({ venueName: "Reroll Validator" }),
    });
    if (!res.ok) throw new Error(`create night: ${res.status} ${await res.text()}`);
    nightId = (await res.json()).nightId;
    const { data: games } = await admin
      .from("games")
      .select("id, game_no")
      .eq("night_id", nightId)
      .order("game_no");
    game1Id = games?.find((g) => g.game_no === 1)?.id;
    if (!game1Id) throw new Error("no game 1");
    pass(`night ${nightId.slice(0, 8)}… game1 ${game1Id.slice(0, 8)}…`);
  }

  step("3. create category + first generation");
  let categoryId = null;
  let batch1 = [];
  {
    const createRes = await call(founderJar, "/api/categories", {
      method: "POST",
      body: JSON.stringify({ gameId: game1Id, name: `Reroll ${TOPIC}`, topic: TOPIC, position: 1 }),
    });
    if (!createRes.ok) throw new Error(`create category: ${createRes.status} ${await createRes.text()}`);
    categoryId = (await createRes.json()).category.id;

    const genRes = await call(founderJar, `/api/categories/${categoryId}/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (genRes.status !== 202) throw new Error(`generate: ${genRes.status} ${await genRes.text()}`);

    batch1 = await waitForReview(categoryId, 7, "batch1");
    pass(`batch 1 generated: ${batch1.length} questions`);
  }

  const keptIds = batch1.slice(0, 3).map((q) => q.id);
  const keptIdSet = new Set(keptIds);
  const batch1Prompts = new Set(batch1.map((q) => q.prompt.trim()));
  const oldUnpickedIds = batch1.filter((q) => !keptIdSet.has(q.id)).map((q) => q.id);
  note(`keeping 3 ids: ${keptIds.map((id) => id.slice(0, 8)).join(", ")}`);

  step("4. reroll with keptIds (↻ Another 20)");
  {
    const res = await call(founderJar, `/api/categories/${categoryId}/generate`, {
      method: "POST",
      body: JSON.stringify({ keptIds }),
    });
    if (res.status !== 202) throw new Error(`reroll: ${res.status} ${await res.text()}`);

    // Wait until the swap has fully landed: kept present, old unpicked gone.
    const deadline = Date.now() + GEN_TIMEOUT_MS;
    let current = [];
    while (Date.now() < deadline) {
      current = await waitForReview(categoryId, 3, "reroll");
      const ids = new Set(current.map((q) => q.id));
      const keptPresent = keptIds.every((id) => ids.has(id));
      const oldGone = oldUnpickedIds.every((id) => !ids.has(id));
      const hasFresh = current.filter((q) => !keptIdSet.has(q.id)).length >= 10;
      if (keptPresent && oldGone && hasFresh) break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    pass(`reroll landed: ${current.length} questions in pool`);

    // ── Assertions ────────────────────────────────────────────────────
    step("5. assertions");
    const ids = new Set(current.map((q) => q.id));

    const keptStillThere = keptIds.filter((id) => ids.has(id)).length;
    if (keptStillThere !== 3) throw new Error(`kept survived: expected 3, got ${keptStillThere}`);
    pass(`all 3 kept questions survived`);

    const oldStillThere = oldUnpickedIds.filter((id) => ids.has(id));
    if (oldStillThere.length !== 0) {
      throw new Error(`unpicked NOT swapped out: ${oldStillThere.length} old rows remain (pile bug)`);
    }
    pass(`all ${oldUnpickedIds.length} unpicked questions swapped out (no pile)`);

    const fresh = current.filter((q) => !keptIdSet.has(q.id));
    const repeats = fresh.filter((q) => batch1Prompts.has(q.prompt.trim()));
    if (repeats.length !== 0) {
      throw new Error(`avoid-list failed: ${repeats.length} new questions repeat an already-seen prompt`);
    }
    pass(`no repeats — all ${fresh.length} fresh questions are new`);

    if (current.length >= 40) {
      throw new Error(`pool ballooned to ${current.length} (pile bug not fixed)`);
    }
    pass(`pool size ${current.length} (kept 3 + ${fresh.length} fresh, not a growing pile)`);
  }

  console.log(`\n${c("✓ REROLL VALIDATION GREEN", "green")}\n`);
} catch (err) {
  failed = true;
  console.error(`\n${c("✗ REROLL VALIDATION FAILED", "red")}: ${err.message}\n`);
} finally {
  if (nightId) {
    const { error } = await admin.from("nights").delete().eq("id", nightId);
    if (error) console.error(`  cleanup: failed to delete night: ${error.message}`);
    else note(`cleaned up night ${nightId.slice(0, 8)}…`);
  }
}

process.exit(failed ? 1 : 0);
