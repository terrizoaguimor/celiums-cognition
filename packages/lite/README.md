# @celiumsai/cognition-lite (Lite)

Persistent emotional memory for OpenClaw — **Lite edition**.

Fully embedded: pglite (PostgreSQL compiled to WASM) + pgvector, ONNX
embeddings via `@xenova/transformers`. Zero external services, zero Docker,
zero manual setup.

> Placeholder README. The adoption README (install, config reference,
> lite → hard migration) lands in Fase 5 (HANDOFF §5).

```
openclaw plugins install clawhub:celiums-cognition-lite
# postinstall fetches the ethics corpus; first tool call lazy-loads the
# embedding model. No manual command.
```

**Not** a feature-reduced edition — identical ethics, journal, PAD, and
retrieval logic as [`@celiumsai/cognition`](../hard); only storage is embedded
(HANDOFF §6.7).

Apache-2.0 © Celiums Solutions LLC.
