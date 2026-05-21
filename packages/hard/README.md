# @celiumsai/cognition (Hard)

Persistent emotional memory for OpenClaw — **Hard edition**.

Full production stack: PostgreSQL 17 + pgvector, Qdrant, and Valkey
provisioned **automatically** via Docker compose. BGE-M3 embeddings by
default; bring your own embedding endpoint via `TEI_URL`.

## Install

```
openclaw plugins install clawhub:@celiumsai/cognition
```

That's it. The first time the plugin starts inside the gateway, it
detects the local stack is not running, generates a unique 256-bit
Postgres password into `~/.celiums-cognition/credentials.env` (chmod
600), and brings the stack up with `docker compose --env-file`. Each
container binds to `127.0.0.1` only — Docker bypasses the kernel
firewall, so loopback binding is the safe default.

Requirements:
- Docker (with `docker compose` v2)
- ~2 GB RAM headroom for the stack
- The host user that runs the gateway must be able to talk to the
  Docker socket

## Configuration

Override any of the following via env (the plugin reads them at start):

| Env | Default | Purpose |
|---|---|---|
| `CELIUMS_DATABASE_URL` | derived from `credentials.env` | Postgres URL |
| `CELIUMS_QDRANT_URL` | `http://localhost:6333` | Qdrant HTTP |
| `CELIUMS_VALKEY_URL` | `redis://localhost:6379` | Valkey/Redis |
| `TEI_URL` | `http://localhost:8080` | Text-Embeddings-Inference |
| `CELIUMS_EMBEDDING_DIM` | `1024` | Must match TEI output |
| `CELIUMS_TRUST_PROXY_HEADERS` | unset | Set `true` only when the gateway sits behind a reverse proxy you control |

## Manual setup (escape hatch)

The auto-bootstrap covers > 99% of cases. If you need to run the
provisioning step explicitly — e.g. to inspect the generated
credentials before exposing the host — invoke:

```
node node_modules/@celiumsai/cognition/dist/setup.js
```

This is the same code path the gateway runs internally; it is
idempotent.

## Editions

Same engine as [`@celiumsai/cognition-lite`](../lite) — only the
storage backend differs. Hard targets production hosts (single-tenant
operator dashboards, dedicated VPS, on-prem). Lite uses embedded
pglite + WASM and ships with zero infra requirements.

Apache-2.0 © Celiums Solutions LLC.
