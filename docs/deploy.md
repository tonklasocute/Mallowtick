# Deploy

A free way to run Mallowtick on a server that stays up when your PC is off: three containers
behind Caddy on an always-free cloud VM, with a free hostname and automatic HTTPS so the
iPhone PWA can be installed. No paid hosting, service or domain is needed. Before sharing the
address with anyone, read [Market-data terms still apply](#market-data-terms-still-apply).

| File | What it is |
|---|---|
| [`docker-compose.yml`](../docker-compose.yml) | `api`, `web` and `caddy`, a fixed-subnet network, volumes |
| [`services/api/Dockerfile`](../services/api/Dockerfile) | Static Go binary on `distroless/static` (non-root, CA certificates, tzdata) |
| [`apps/web/Dockerfile`](../apps/web/Dockerfile) | pnpm workspace build, Next.js standalone server (non-root) |
| [`.dockerignore`](../.dockerignore) | Keeps `.env` files, `node_modules`, `.next`, caches and `.git` out of builds |
| [`deploy/Caddyfile`](../deploy/Caddyfile) | Caddy in front of the web app; hostname from `SITE_ADDRESS` |
| [`deploy/compose.tunnel.yml`](../deploy/compose.tunnel.yml), [`deploy/Caddyfile.tunnel`](../deploy/Caddyfile.tunnel) | Opt-in: a temporary Cloudflare quick tunnel from your PC |

## What runs where

```text
internet ──:80/:443──► caddy ──► web:3000 ──/api/v1 proxy route──► api:8080 ──► Twelve Data, Finnhub
                     (TLS, the          (Next.js standalone)          (Go; volume api-cache:/data
                      client address)                                  holds CACHE_FILE)
```

| Service | Image | Published ports | State |
|---|---|---|---|
| `caddy` | `caddy:2.11.9-alpine` | `HTTP_PORT` (80), `HTTPS_PORT` (443, TCP and UDP) | `caddy-data` (certificates), `caddy-config` |
| `web` | built from `apps/web/Dockerfile` | none | none (resized logos in `.next/cache`, refetched after an update) |
| `api` | built from `services/api/Dockerfile` | none | `api-cache` volume: `CACHE_FILE=/data/market-cache.json` |

Only Caddy is reachable from outside. The browser only ever talks to the web app's origin; the
web app reaches the API at `API_ORIGIN=http://api:8080` on the compose network.

**One API instance only.** The API's caches and its per-client limits live in the process.
Never scale `api` to more than one replica: each replica would spend provider credits on its
own and split every client's limits (see [architecture.md](architecture.md#known-limitations)).

## Client addresses and the per-client limits

The API limits each client by address (`CLIENT_*` in `services/api/.env.example`). The
address has to survive the chain browser → Caddy → Next → API without letting a visitor pick
their own:

1. **Caddy** decides who the client is: the TCP peer. It trusts no proxy in front of it, so a
   client-supplied `X-Forwarded-For` is ignored, and `header_up X-Forwarded-For {client_ip}`
   sends exactly one address to the web app.
2. **Next** (`apps/web/src/app/api/v1/[...path]/route.ts`) forwards `X-Forwarded-For` to the
   API unchanged. Next only fills it in from the socket when it is missing, which never
   happens behind Caddy.
3. **The API** believes `X-Forwarded-For` only from `TRUSTED_PROXIES`. In
   `docker-compose.yml` that is `172.28.86.10`, the web container's fixed address on the
   project network (subnet `172.28.86.0/24`). From anyone else the API counts the TCP peer.

Why the web container's address and not the whole subnet: Caddy (and cloudflared, when the
tunnel is on) share that network, and only the web app's proxy route should be believed. If
something else ever talks to the API directly, all of its traffic counts as that one
container's address, a shared limit rather than one a visitor can choose. If `172.28.86.0/24`
overlaps another network on the machine, change the prefix in `docker-compose.yml` (subnet,
web address, `TRUSTED_PROXIES`), `deploy/compose.tunnel.yml` and `deploy/Caddyfile.tunnel`.

What Caddy sees as the peer depends on the machine:

- **Linux VM:** Docker forwards published IPv4 ports with NAT, so Caddy should see each
  visitor's real IPv4 address. Visitors arriving over IPv6 are relayed by Docker's userland
  proxy and would all appear as the network gateway (`172.28.86.1`), sharing one set of
  limits; a DuckDNS name with only an IPv4 address (the default) avoids that. Not tested on a
  VM yet: check `client_ip` in `docker compose logs caddy` after the first visits.
- **Docker Desktop (Windows, macOS):** connections to published ports reach Caddy from the
  gateway (`172.28.86.1`, seen on Windows), so every direct visitor shares one set of limits.
  That is fine for a local test.

## Secrets

- Provider keys live only in `services/api/.env` on the machine that runs the stack. It is
  gitignored, excluded from every build by `.dockerignore`, and read at start-up through
  `env_file`. The Dockerfiles copy only source code, so no image contains a key.
- `docker-compose.yml` overrides a few of its values for containers: `APP_ENV=production`,
  `API_ADDR=:8080`, `CACHE_FILE=/data/market-cache.json` and `TRUSTED_PROXIES`.
  `API_CORS_ORIGINS` doesn't matter here (the browser never calls the API directly).
- `docker compose config` prints the merged configuration **including the keys**. Use
  `docker compose config --quiet` to check the files, and don't paste the full output anywhere.
- If you create `.env` on Windows, make sure it has LF line endings (see CLAUDE.md, Known
  issues).

## Run it anywhere first (local test)

On any machine with Docker (Docker Desktop on Windows or macOS is fine):

```bash
cp services/api/.env.example services/api/.env   # then fill in the keys
HTTP_PORT=8088 HTTPS_PORT=8443 docker compose up -d --build
curl http://localhost:8088/api/v1/health
```

Open <http://localhost:8088>. `SITE_ADDRESS` defaults to `:80`, which serves plain HTTP on any
hostname, so the HTTPS port stays unused. In PowerShell set the ports first:
`$env:HTTP_PORT="8088"; $env:HTTPS_PORT="8443"; docker compose up -d --build`. To keep them
on this machine only, use `HTTP_PORT=127.0.0.1:8088`.

Stop it with `docker compose down`. `docker compose down -v` also deletes the volumes (the
market cache and Caddy's certificates).

## Put it online: an always-free VM

This is the main path: the app keeps running when your PC is off, and the hostname stays the
same. Free plans change; check each provider's current page before you rely on it. The facts
below were read from the providers' docs in November 2026.

### 1. Create the VM

**Oracle Cloud Always Free** (main example,
[Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)):

- Shapes: Ampere A1 (`VM.Standard.A1.Flex`, arm64), whose Always Free allowance Oracle states as
  "equivalent to 2 OCPUs and 12 GB of memory", or up to two `VM.Standard.E2.1.Micro`
  (amd64, 1/8 OCPU, 1 GB memory). Prefer A1: the web image's `next build` is unlikely to fit
  in 1 GB without swap. Every base image used here is published for arm64 too, and the
  lockfile has the arm64 builds of Next's compiler and sharp (not built on arm64 yet).
- Always Free instances must be created in your home region, and creation can fail with "out
  of host capacity"; try again later or another availability domain.
- Signup asks for a credit or debit card as a payment verification method. Oracle's signup
  page says there may be a small temporary verification hold, and that the card "won't be
  charged unless you elect to upgrade your cloud account".
- **Idle instances may be reclaimed.** Oracle counts an Always Free instance as idle when,
  over 7 days, its 95th-percentile CPU use, network use and (A1 only) memory use are all
  below 20%. A small personal app can look idle. See "Keeping it running" below.
- Pick Ubuntu (24.04 LTS or newer) as the image and add your SSH public key.

**Alternative: Google Cloud free tier**
([free features](https://docs.cloud.google.com/free/docs/free-cloud-features)): one
non-preemptible `e2-micro` (1 GB memory) a month in `us-west1`, `us-central1` or `us-east1`,
30 GB of standard persistent disk and 1 GB of outbound data a month from North America. It
needs a billing account with a payment method. Not verified here: whether the VM's external
IPv4 address is free, and whether 1 GB of outbound data a month is enough for your users (a
first page load downloads the app's scripts). The VM is far from Thailand, and with 1 GB of
memory you need the swap file from step 3.

### 2. Open ports 80 and 443

Caddy needs both from the whole internet: 80 for the certificate challenge and the redirect,
443 for the app.

- **Oracle:** add ingress rules for TCP 80 and TCP 443 from `0.0.0.0/0` to the subnet's
  security list (or a network security group on the VM). UDP 443 (HTTP/3) is optional.
- **Google Cloud:** allow HTTP and HTTPS traffic on the VM (firewall rules for TCP 80 and 443).
- **The VM's own firewall:** Oracle's platform images also run a host firewall. If the site
  doesn't answer after the cloud rules are open, list it with `sudo iptables -L INPUT -n
  --line-numbers` and allow 80 and 443 before any `REJECT` rule (on Ubuntu, saved rules live
  in `/etc/iptables/rules.v4`). Not verified here for the current images.

### 3. Install Docker

SSH in (`ssh ubuntu@<public IP>`) and install Docker Engine from Docker's apt repository,
following <https://docs.docker.com/engine/install/ubuntu/>. That installs
`docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`, so
`docker compose` works. Docker's convenience script is meant for testing, not servers.

```bash
sudo usermod -aG docker $USER   # then log out and back in; this is root-equivalent access
```

On Ubuntu the Docker service starts on boot by default.

On a 1 GB VM, add swap before the first build:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4. Get the code and the keys onto the VM

```bash
git clone https://github.com/tonklasocute/Mallowtick.git mallowtick
cd mallowtick
cp services/api/.env.example services/api/.env
nano services/api/.env          # TWELVEDATA_API_KEY, FINNHUB_API_KEY, QUOTE_CACHE_TTL=60s, ...
chmod 600 services/api/.env
```

Or copy your PC's file over SSH: `scp services/api/.env ubuntu@<public IP>:mallowtick/services/api/.env`.
The file never goes into git. Keep a copy somewhere safe off the VM (a password manager), so
you can rebuild the server if it disappears.

### 5. A free hostname: DuckDNS

HTTPS needs a hostname, and the iPhone PWA needs HTTPS. [DuckDNS](https://www.duckdns.org/) is
free dynamic DNS:

1. Sign in, create a subdomain, e.g. `mallowtick-yourname.duckdns.org`.
2. Set its IP to the VM's **public** IP (the page fills in your browser's IP; replace it).
   If the VM's IP ever changes, update it there, or from the VM with DuckDNS's update URL
   (`https://www.duckdns.org/update?domains=<subname>&token=<token>&ip=<ip>`; the token is a
   secret, so keep it out of git and shell history).

`duckdns.org` is on the Public Suffix List, so Let's Encrypt should count each DuckDNS name as
its own registered domain for its rate limits (50 certificates per registered domain every 7
days). Caddy needs only one certificate and renews it itself.

### 6. Start it with automatic HTTPS

Tell compose the hostname in a `.env` file at the repository root (gitignored; compose reads
it for `${...}` values):

```bash
echo 'SITE_ADDRESS=mallowtick-yourname.duckdns.org' > .env
docker compose up -d --build
docker compose logs -f caddy     # "certificate obtained successfully", then Ctrl+C
```

With a hostname as `SITE_ADDRESS`, Caddy listens on 443, gets a certificate from a public CA
(Let's Encrypt by default), renews it, and redirects HTTP to HTTPS. Then check:

```bash
curl https://mallowtick-yourname.duckdns.org/api/v1/health
```

On the iPhone, open the address in Safari, then Share → Add to Home Screen. The service
worker is active because the image is a production build.

## Try it from your PC for a moment: Cloudflare quick tunnel

For a quick look from a phone while your PC is on, without a VM or a domain: Cloudflare's
[quick tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) need no
account and give a random `https://<words>.trycloudflare.com` address. HTTPS comes from
Cloudflare, so the PWA can be installed for testing.

```bash
docker compose -f docker-compose.yml -f deploy/compose.tunnel.yml up -d --build
docker compose -f docker-compose.yml -f deploy/compose.tunnel.yml logs tunnel   # the URL
```

- It is temporary: the address changes every time the tunnel starts and stops working when
  the PC sleeps or the container stops, so an installed PWA breaks. Cloudflare says quick
  tunnels "are for testing and development", with no uptime guarantee and at most 200
  in-flight requests.
- Anyone with the address can use the app (and spend your provider credits within the limits).
- Every visitor reaches Caddy through the `tunnel` container, so `deploy/Caddyfile.tunnel`
  trusts `CF-Connecting-IP` (the visitor's address, set by Cloudflare) from that container's
  fixed address `172.28.86.20` only, and still sends one address on to the web app. From any
  other peer the header is ignored. This was checked with a stand-in container on that
  address, not a live tunnel: the first time, check that `client_ip` in
  `docker compose logs caddy` shows visitors' public addresses, not `172.28.86.20`.
- Stop it with `docker compose -f docker-compose.yml -f deploy/compose.tunnel.yml down`.

## Keeping it running

- **Restarts:** every service has `restart: unless-stopped`, and Docker starts on boot, so the
  stack comes back after a crash or a VM reboot. `docker compose stop` keeps it stopped.
- **Status and logs:** `docker compose ps`, `docker compose logs -f api` (also `web`,
  `caddy`). Logs rotate at 3 × 10 MB per container. Caddy's access log includes each request's
  `client_ip`. For provider calls and credits, set `LOG_LEVEL=debug` in `services/api/.env` and
  `docker compose up -d`.
- **Updating:** `git pull && docker compose up -d --build`, then `docker image prune -f` to
  free the old images' disk space. The market cache and the certificate survive (they are
  volumes). After changing only `.env` files, `docker compose up -d` is enough.
- **Base images:** the Dockerfiles and compose pin Go, Node, Caddy and cloudflared versions.
  Bump them now and then; `docker compose build --pull` also refreshes the distroless base.
- **OS security updates:** Ubuntu installs security updates daily through
  `unattended-upgrades`, enabled by default. It doesn't reboot on its own; when
  `/var/run/reboot-required` exists, run `sudo reboot` (the stack comes back by itself).
- **Health:** `curl https://<hostname>/api/v1/health` shows which vendor serves each kind of
  data and whether a key is missing (`provider not configured`).
- **If the VM is reclaimed or deleted:** create a new one and repeat steps 1 to 6 with your
  saved `services/api/.env`, then point the DuckDNS name at the new IP. Nothing else needs
  saving: the market cache refills and Caddy gets a new certificate.
- **If a free plan changes:** recheck the provider pages linked above (Oracle, Google Cloud,
  DuckDNS, Cloudflare, Let's Encrypt), and the market-data plans' limits in
  [market-data.md](market-data.md). If Oracle stops being free for you, the same compose file
  runs on any Linux VM with Docker.

## Market-data terms still apply

The Twelve Data and Finnhub free plans are personal plans. As
[market-data.md](market-data.md) says, they don't grant redistribution or public display:
running Mallowtick for yourself is in scope, serving it to other people needs a commercial
licence from the provider. Hosting it on a VM doesn't change that, so keep the address private
and decide for yourself before sharing it. The per-client limits keep one visitor from using
up the shared free budgets; they don't make sharing permitted.
