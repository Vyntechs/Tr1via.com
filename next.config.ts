import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Public, non-secret build identity. Live requests echo these values so an
  // incident can distinguish an older browser tab from the server deployment
  // that received it. Never put tokens or other Vercel environment values here.
  env: {
    NEXT_PUBLIC_TR1VIA_RELEASE:
      process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    NEXT_PUBLIC_TR1VIA_DEPLOYMENT_ID:
      process.env.VERCEL_DEPLOYMENT_ID ?? "",
  },
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
