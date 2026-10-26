# Mallowtick

US stock analysis app (PWA, iOS add-to-home-screen). Tagline: "Small Charts. Big dreams."

## Design reference — read before any UI work

Before creating or changing any UI (screens, components, styles, icons, colors), open
[docs/design-reference.png](docs/design-reference.png) with the Read tool and look at it.
Do not rely on the notes below alone; the image is the source of truth.

Quick notes from the reference (verify against the image):

- Palette: Mint `#A7E3C2`, Sky `#BFE8FF`, Cream `#FFF9F0`, Soft Blue `#E6F4FF`,
  Gray `#6B7280`, Accent `#FFB6C1`
- Mascot: a cream marshmallow with a sprout on top; logo wordmark "Mallowtick" with an up-trend arrow on the "k"
- Screens (V1): Discover (search, S&P 500 / Nasdaq / Dow cards, popular stocks),
  Stock Detail (price header, Overview/Chart/News/Financials tabs, candlestick chart with
  support/resistance lines, key levels, stats, technicals), Watchlist (category chips,
  rows with sparkline, price, % change)
- Bottom tab bar: Discover, Watchlist, Portfolio, More
- Style: soft rounded cards, light cream background, green for up / red for down
