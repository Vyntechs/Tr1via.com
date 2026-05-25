// One-off: mint a /auth/grant URL on the current PR #28 preview deploy
// for a specific host. Lets Brandon validate the founder-grant flow
// end-to-end before merging anything to prod.
//
// Run: node scripts/grant-on-preview.mjs <email> <preview-host>

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const email = process.argv[2] ?? "heatherhmoore@yahoo.com";
const previewHost = process.argv[3]
  ?? "https://tr1via-1pjf2wm06-brandon-nichols-projects-f7e6d2a9.vercel.app";

const envLocal = readFileSync(".env.local", "utf8");
const env = Object.fromEntries(
  envLocal
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
if (error || !data.properties?.hashed_token) {
  console.error("generateLink failed:", error?.message ?? "no hashed_token");
  process.exit(1);
}

const url = `${previewHost}/auth/grant?t=${encodeURIComponent(
  data.properties.hashed_token,
)}`;

console.log("");
console.log("=".repeat(72));
console.log(`SIGN-IN AS ${email} ON PREVIEW`);
console.log("=".repeat(72));
console.log("");
console.log(url);
console.log("");
console.log("Open this in Safari. The preview's /auth/grant route will do");
console.log("the OTP exchange server-side and you'll land on /host signed in");
console.log("as that account. Single-use, ~1hr expiry.");
console.log("");
