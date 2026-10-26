.PHONY: install dev-api dev-web test test-api test-web lint lint-api lint-web build build-api build-web icons

API_DIR := services/api
WEB_DIR := apps/web

install:
	pnpm install
	cd $(API_DIR) && go mod download

# Loads services/api/.env when present.
dev-api:
	cd $(API_DIR) && set -a && { [ ! -f .env ] || . ./.env; } && set +a && go run ./cmd/api

dev-web:
	pnpm --filter @mallowtick/web dev

test: test-api test-web

test-api:
	cd $(API_DIR) && go test -race ./...

test-web:
	pnpm --filter @mallowtick/web test

lint: lint-api lint-web

lint-api:
	cd $(API_DIR) && go vet ./... && golangci-lint run ./...

lint-web:
	pnpm --filter @mallowtick/web lint
	pnpm --filter @mallowtick/web typecheck
	pnpm --filter @mallowtick/web format:check

build: build-api build-web

build-api:
	cd $(API_DIR) && go build -o bin/api ./cmd/api

build-web:
	pnpm --filter @mallowtick/web build

icons:
	pnpm --filter @mallowtick/web icons
