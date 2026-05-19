# @celiumsai/cognition (Hard)

Persistent emotional memory for OpenClaw — **Hard edition**.

Full production stack: PostgreSQL 17 + pgvector, Qdrant, and Valkey provisioned
locally via Docker compose. BGE-M3 embeddings (configurable, BYOK optional).

> Placeholder README. The adoption README (install, `setup` flow, config
> reference) lands in Fase 5 (HANDOFF §5).

```
openclaw plugins install clawhub:celiums-cognition
pnpm celiums-cognition setup   # provisions local Postgres + Qdrant + Valkey
```

Same engine as [`@celiumsai/cognition-lite`](../lite) — only the storage
backend differs (HANDOFF §6.7).

Apache-2.0 © Celiums Solutions LLC.
