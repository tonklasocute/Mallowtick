/** Brand metadata shared by the manifest and document metadata. */
export const BRAND = {
  name: "Mallowtick",
  tagline: "Small charts. Big dreams.",
  description:
    "A friendly US stock analysis app with real market data, charts, and support/resistance levels.",
  // Must match --color-cream in src/styles/globals.css (metadata can't read CSS variables).
  themeColor: "#fff9f0",
} as const;
