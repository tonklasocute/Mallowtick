import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
