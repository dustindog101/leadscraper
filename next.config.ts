import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Patchright (Playwright fork) has transitive deps (chromium-bidi) that
  // Turbopack/webpack can't bundle. Mark them as external so they're
  // resolved at runtime from node_modules instead of bundled.
  serverExternalPackages: [
    "patchright",
    "patchright-core",
    "playwright",
    "playwright-core",
    "chromium-bidi",
  ],
};

export default nextConfig;
