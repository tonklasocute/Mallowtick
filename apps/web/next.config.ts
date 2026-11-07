import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // For the Docker image (apps/web/Dockerfile): a self-contained server.js with only the
  // traced node_modules. Next infers the pnpm workspace root as the tracing root, so the
  // output mirrors the repo (.next/standalone/apps/web/server.js). Locally, `next start`
  // still serves the build, after a warning that it "does not work" with standalone.
  output: "standalone",
  images: {
    // Company logos come from Finnhub's static hosts (the API only forwards https URLs).
    // next/image shrinks the 1000x1000 originals to avatar size and caches them here; the
    // redirect from static2 to another static host is followed without matching again.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.finnhub.io",
        pathname: "/file/publicdatany/finnhubimage/stock_logo/**",
        search: "",
      },
    ],
    // Logos rarely change and the originals are only cached for 3 hours upstream.
    minimumCacheTTL: 86400,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // The service worker must be revalidated on every load so updates ship promptly.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
