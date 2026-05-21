# @celiumsai/cognition

Persistent emotional memory for OpenClaw.

Full production stack: PostgreSQL 17 + pgvector, Qdrant, Valkey, and
OpenSearch 2.19 provisioned **automatically** via Docker compose. The
first boot also downloads the curated 10K-skills seed (into Postgres)
and the ethics-knowledge corpus (~1857 docs, 1024-dim embeddings, into
OpenSearch) — both SHA-256 verified. BGE-M3 embeddings by default;
bring your own embedding endpoint via `TEI_URL`.

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
- ~1.5 GB RAM headroom for the stack (postgres ~150 MB + qdrant ~100 MB
  + valkey ~50 MB + opensearch ~768 MB)
- Linux hosts: `vm.max_map_count >= 262144` for OpenSearch. `setup.ts`
  attempts to raise it via `sysctl -w` when run as root; otherwise set
  it manually: `echo 'vm.max_map_count=262144' | sudo tee -a /etc/sysctl.d/99-opensearch.conf && sudo sysctl --system`
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

Apache-2.0 © Celiums Solutions LLC.
