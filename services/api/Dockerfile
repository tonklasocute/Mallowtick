# syntax=docker/dockerfile:1

# Mallowtick API: a static Go binary on a distroless, non-root base.
# Build from the repository root (docker-compose.yml does):
#   docker build -f services/api/Dockerfile -t mallowtick-api .
# Settings come from the environment at run time (docker-compose.yml loads
# services/api/.env); no secret is ever copied into the image.

# go.mod asks for go 1.27.2; any later 1.27 patch builds it.
ARG GO_VERSION=1.27.3

# The build stage runs on the builder's own platform and cross-compiles, so an
# arm64 image (e.g. for an Ampere VM) builds quickly on an amd64 PC too.
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine3.24 AS build
WORKDIR /src
COPY services/api/go.mod services/api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
# Only the Go sources: never .env, .cache or bin, even if .dockerignore is missing.
COPY services/api/cmd ./cmd
COPY services/api/internal ./internal
ARG TARGETOS
ARG TARGETARCH
# CGO off gives a static binary. Exchange time zones are embedded (time/tzdata in cmd/api).
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
 && mkdir -p /out/data

# Distroless static: CA certificates and tzdata, no shell, runs as uid 65532.
FROM gcr.io/distroless/static-debian13:nonroot
COPY --from=build /out/api /usr/local/bin/api
# CACHE_FILE lives here. A named volume mounted on /data starts with this owner,
# so the non-root process can write the cache file.
COPY --from=build --chown=nonroot:nonroot /out/data /data
ENV APP_ENV=production \
    API_ADDR=:8080 \
    CACHE_FILE=/data/market-cache.json
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
