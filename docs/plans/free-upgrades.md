# Plan: free upgrades after the speed work

Status: A–E done on branch `feat/free-upgrades` (2026-11-07). Deployment follows the
user's choice of an always-free VM (no PC left on); the VM path itself is still unverified.

Rule for everything here: **free**. No paid plan, service or domain. The repo is public, so
GitHub Actions minutes are free. Extra provider use must stay inside the free plans
(docs/market-data.md#credit-budget-on-the-free-plan).

## Work (in parallel, one agent each, disjoint files)

### A. CI on GitHub Actions
`.github/workflows/ci.yml` on pull requests and pushes to `main`: Go (`go vet`,
golangci-lint, `go test -race`) and web (`lint`, `typecheck`, `format:check`, `test`,
`build`). Linux runners check out LF, so the Windows CRLF workarounds aren't needed there.

### B. Free deployment kit
Dockerfiles for the API and the web app (Next `output: "standalone"`), `docker-compose.yml`
with Caddy in front, `TRUSTED_PROXIES` set to the web container's network, the cache file on
a volume, and `docs/deploy.md` with free ways to put it online: the PC itself with a
Cloudflare quick tunnel (free, no domain, random URL), or an always-free VM. Secrets come from
`services/api/.env`, never the image.

### C. News on Stock Detail
`GET /stocks/{symbol}/news` from Finnhub `/company-news` (free; English headlines), cached so a
symbol costs about one call per 30 minutes, and a "ข่าวล่าสุด" card on Stock Detail with the
headline, source and time, linking out. Text only (article images come from many hosts).

### D. Sparklines on Discover
The design shows sparklines on every benchmark card and popular row; they were left out
because each cost credits (2026-10-26). With the shared daily series a 1M sparkline costs
about 2 Twelve Data credits per symbol a day (7 symbols ≈ 14 of 800), so add them, from the
same `range=1m` data the watchlist uses. The hero keeps its 1D line.

### E. Polish
- `TWELVEDATA_MAX_WAIT` 10 s → 3 s, so a chart waiting for credits says "รอโควตา" instead
  of hanging.
- Thai names for Finnhub's industries (English stays the fallback).
- App icons and favicon from the current mascot (`components/brand/mascot.tsx`).

## Not in this round

- SEC EDGAR statements: free, but every request must carry a User-Agent naming a real
  contact email. Needs the user's decision on what to send.
- Price alerts: need server-side storage and Web Push. A bigger, separate piece.
- Sync across devices: needs accounts and a database.
- A fallback candle vendor: only Yahoo is free, without a licence.
- Checking the rebuilt daily bar and the after-close volume during a real session
  (CLAUDE.md, Known issues): manual, on a weekday evening.
