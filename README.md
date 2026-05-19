# Celiums Cognition

> Add persistent emotional memory to your OpenClaw agent in 30 seconds.

A native [OpenClaw](https://github.com/openclaw/openclaw) plugin that brings the
full Celiums Memory cognitive engine — emotional PAD + circadian model,
SHA-chained journal, ethics engine, hybrid retrieval, and 60+ memory tools —
into any OpenClaw agent. Standalone: no SaaS, no remote VPS, no required keys.

> **Status:** pre-1.0, under active construction. This README is a placeholder;
> the adoption README (comparison table, install commands, 30-second quickstart)
> lands in a later milestone.

## Two editions, one engine

| | `@celiumsai/cognition` (Hard) | `@celiumsai/cognition-lite` (Lite) |
|---|---|---|
| Storage | PostgreSQL + Qdrant + Valkey (Docker) | pglite + pgvector (embedded) |
| Embeddings | BGE-M3 (configurable, BYOK) | ONNX `@xenova/transformers` |
| External infra | Docker required | None |
| Engine (ethics, journal, PAD, retrieval) | identical | identical |

Lite is **not** a feature-reduced edition — same engine, embedded storage
(HANDOFF §6.7).

## Monorepo layout

```
packages/engine   @celiumsai/cognition-engine  (private — vendored Celiums Memory)
packages/shared   @celiumsai/cognition-shared  (private — plugin adapter)
packages/hard     @celiumsai/cognition         (publishable — Hard edition)
packages/lite     @celiumsai/cognition-lite    (publishable — Lite edition)
```

## License

Apache-2.0 © Celiums Solutions LLC. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
