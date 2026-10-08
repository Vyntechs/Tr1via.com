import type { NextConfig } from "next";

// Which build a browser is running, for the diagnostic log's device report
// (lib/diagnostics/reporter.ts). Public on purpose: both are visible to anyone
// who loads the site. Vercel sets them for the build; a local build has neither.
//   TR1VIA_RELEASE  the deployment id, the same value the server stamps on every
//                   diagnostic row (VERCEL_DEPLOYMENT_ID), so a device that is
//                   still on an older deployment shows up by comparison
//   TR1VIA_SHA      the first 12 characters of the git commit
const word = (value: string | undefined, max: number) =>
  (value ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, max);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_TR1VIA_RELEASE: word(process.env.VERCEL_DEPLOYMENT_ID, 40),
    NEXT_PUBLIC_TR1VIA_SHA: word(process.env.VERCEL_GIT_COMMIT_SHA, 12),
  },
  reactStrictMode: true,
  experimental: {
    // Server Actions enabled by default in Next 16
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
