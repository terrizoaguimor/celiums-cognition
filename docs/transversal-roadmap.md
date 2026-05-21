# Roadmap transversal — Celiums Cognition × OpenClaw SDK

**Tema:** Hoy el plugin vive en su propia isla (tools + UI + auth). El SDK
de OpenClaw expone ~50 seams que permitirían a Cognition hilarse en
CADA paso del ciclo de vida del gateway. Este documento inventaría los
seams disponibles, compara contra lo que ya usamos, y propone un plan
de adopción priorizado.

Verificado contra `/Volumes/My Book/Documents/openclaw-study` (OpenClaw
2026.5.18+), commit `78d226bb`.

---

## Lo que ya usamos (8 seams)

| Seam | Para qué | Estado |
|---|---|---|
| `registerTool` | 61 herramientas MCP (curated 8 + all) | sólido |
| `registerHttpRoute` | UI SPA + REST API `/api/celiums-cognition/*` | sólido |
| `registerCli` | comando `openclaw celiums-cognition status` | mínimo |
| `registerService` | bootstrap stack + migrations + seed | sólido |
| `registerMemoryPromptSupplement` | system-prompt teaching (Tanda Mario 2026-05-21) | sólido |
| `api.on("before_prompt_build")` | `turnContext` + identity preamble | sólido |
| `api.on("agent_end")` × 2 | auto-capture + auto-journal | sólido |
| `api.on("before_agent_run")` + `before_tool_call` | ethics gate | sólido |

**Diagnóstico:** el plugin observa el ciclo de vida del agente Y le
inyecta memoria, pero no participa en otras capas — continuity,
subagent lifecycle, channel mensajería, session boundaries, audit
global, autonomous heartbeats — todas pasan sin que Cognition vea
nada.

---

## Oportunidades transversales — priorizadas

### 🔴 Fase A — Continuidad sobre límite de contexto

**Pieza:** `registerCompactionProvider` + `api.on("before_compaction")`
+ `api.on("after_compaction")`.

**Qué pasa hoy:** cuando el contexto del LLM llega al límite, OpenClaw
compacta (resume + descarta historia vieja). Nuestro plugin NO ve esto.
Lo que tu agente "olvidó" durante la compactación se pierde a menos
que coincidencialmente alguien hubiera llamado `remember()` justo
antes.

**Qué proponemos:**

1. Implementar un `CompactionProvider` con id `celiums-cognition`. La
   firma es:
   ```ts
   summarize({ messages, compressionRatio, previousSummary }) => Promise<string>
   ```
   Nuestro provider podría usar `journal_arc` (que el engine ya tiene
   — synthesis narrativa con embeddings) y devolver un summary
   conciso. NO es slot exclusivo (verificado: el registry mapea por
   `id`, soporta varios providers).

2. **Antes de compactar**, hook `before_compaction`:
   - Dump del state limbic + circadian al journal (entry tipo
     `arc`, tags `["pre-compaction"]`)
   - Extraer los facts más importantes del contexto y persistirlos
     como memorias (importance ≥ 0.7) si aún no están

3. **Después de compactar**, hook `after_compaction`:
   - Escribir un journal entry tipo `reflection` con el resumen +
     el delta de qué se perdió
   - Próximo `turnContext` puede leer ese resumen como prior

**Resultado:** el plugin se vuelve el **motor de continuity del
gateway**. Un agente nunca "pierde" información significativa al
compactar — la memoria persistente la captura ANTES de la pérdida.

**Costo:** ~300 líneas. Riesgo: medio (toca path crítico, hay que
testear que el provider no rompe agentes que ya usan memory-core).

---

### 🔴 Fase B — Agentes y subagentes

**Pieza:** hooks `subagent_spawning`, `subagent_spawned`, `subagent_ended`.

**Qué pasa hoy:** cuando OpenClaw spawnea un subagent (para una tarea
narrow), el subagent llega sin saber NADA de lo que el parent agent
estaba pensando. Sus journal entries quedan aisladas en su propio
`agent_id`. Cuando termina, su trabajo se pierde a menos que el parent
lo capture manualmente.

Verifiqué el payload del SDK:
```ts
PluginHookSubagentSpawnBase = {
  childSessionKey: string;
  agentId: string;       // el nombre del subagent
  label?: string;
  mode: "run" | "session";
  requester?: { channel, accountId, to, threadId };
  threadRequested: boolean;
}
```

**Qué proponemos:**

1. **`subagent_spawning`** (antes de que el child arranque):
   - Emitir journal entry en el chain del parent: tipo `decision`,
     tags `["spawned-subagent"]`, content `"Spawning subagent <X>
     for task <Y>"`. `conversation_id` compartido entre parent y child.
   - Pre-cargar las últimas N entries del journal del parent como
     **identity preamble adicional** para el child — el child ve "Yo
     soy subagent <X> al servicio de <Y>; el agente parent recientemente
     decidió Z, dudó sobre W..."

2. **`subagent_spawned`** (child está listo):
   - Vincular `child_agent_id ↔ parent_agent_id` en una tabla
     `agent_lineage(parent, child, spawned_at, task_label)`. Eso
     habilita auditorías como "todos los subagents de main durante
     mayo".

3. **`subagent_ended`** (child termina):
   - El child cierra su propio journal (tipo `arc`, summary del trabajo)
   - El parent recibe un nuevo journal entry: `lesson` o `reflection`
     según éxito, con tags `["from-subagent:<X>"]`, contenido = resumen
     del child + verdict
   - El trabajo del child que importa para el operator se persiste
     como memorias (auto-capture filtrado por importance del child)

**Resultado:** la flota de agentes tiene **memoria compartida + voces
separadas + lineage trazable**. Vos abrís el Journal tab → filtras por
`main` → ves "spawned 3 subagents during this session" + click para
ir al chain de cada uno.

**Costo:** ~400 líneas + 1 migración (tabla `agent_lineage`).

---

### 🟡 Fase C — Session lifecycle

**Pieza:** `api.on("session_start")` + `api.on("session_end")`.

**Qué pasa hoy:** no detectamos cuándo arranca una conversación nueva
ni cuándo termina. El `conversation_id` que pasamos al journal viene
del `sessionId` del SDK, que está OK, pero no marcamos los boundaries
explícitamente en el journal.

**Qué proponemos:**

1. `session_start` → journal entry tipo `reflection`, tags
   `["session-start"]`, content `"New session opened via channel <X>
   from <accountId>"`. Esto sirve de **ancla** cuando el operador
   pagina semanas hacia atrás.

2. `session_end` → journal entry `arc`, tags `["session-end"]`,
   content = mini-resumen de los temas vistos (puede llamar
   `journal_arc(query=this_session_id)` internamente).

**Resultado:** el Journal tab puede mostrar "sesiones" como agrupación
natural, no solo flujo continuo.

**Costo:** ~80 líneas.

---

### 🟡 Fase D — Operator UX en el shell nativo

**Pieza:** `registerSessionAction` + `registerControlUiDescriptor`.

**Qué pasa hoy:** para grabar una memoria o ver el limbic state, el
operador tiene que abrir el dashboard (otra pestaña). En la conversación
con el agente no hay forma de hacerlo inline.

**Qué proponemos:**

1. `registerSessionAction`: declara acciones que el operator puede
   invocar como slash-commands o botones del shell:
   - `/celiums-remember <text>` → llama `remember()` con importancia
     alta sin abrir el dashboard
   - `/celiums-recall <query>` → muestra top 5 inline
   - `/celiums-limbic` → muestra el current PAD + circadian inline
   - `/celiums-compact` → fuerza una compaction pass

2. `registerControlUiDescriptor`: declara un widget para el panel
   nativo de OpenClaw que muestra el limbic state + last journal entry
   + memory count, siempre visible en el shell. Datos via los endpoints
   `/api/celiums-cognition/limbic-state` que ya tenemos.

**Resultado:** Cognition deja de ser "el otro tab" y se vuelve parte
del shell.

**Costo:** ~250 líneas.

---

### 🟡 Fase E — Tooling extras

**Pieza:** `registerToolMetadata` + `registerSecurityAuditCollector` +
`registerNodeInvokePolicy`.

**Qué proponemos:**

1. `registerToolMetadata` — taggear nuestros 61 tools en grupos
   (`memory`, `journal`, `ethics`, `cognitive`, `atlas`,
   `research`, `write`). El shell del operator puede agruparlos
   visualmente; el agente puede filtrar por categoría al llamar.

2. `registerSecurityAuditCollector` — alimentar el sistema de audit
   GLOBAL del gateway desde nuestra `ethics_audit` table. Cada
   `final_decision: block` se replica al log central de OpenClaw para
   correlacionar con eventos de canales / autenticación / etc.

3. `registerNodeInvokePolicy` — registrar ethics como un POLICY
   explícito, no solo un hook. Algunas tools peligrosas pasan por
   "approval" en OpenClaw; queremos que ese path consulte nuestro
   ethics pipeline como segunda opinión.

**Resultado:** Cognition integra con la infrastructure de gobernanza
de OpenClaw, no solo la suya.

**Costo:** ~200 líneas.

---

### 🟢 Fase F — Autonomous loops + canales

**Pieza:** `heartbeat_prompt_contribution` + `tool_result_persist` +
`message_received` / `message_sent`.

**Qué proponemos:**

1. `heartbeat_prompt_contribution` — para agents autónomos (cron-like
   loops), inyectar un mini-`turnContext` adaptado al heartbeat (más
   corto, solo limbic + 3 memories más relevantes).

2. `tool_result_persist` — captura selectiva de tool results como
   memories. Filtro: `file_read` largos, `web_search` con muchos
   resultados, `recall_remote` exitosos. Skip: list-dirs, no-op grep.

3. `message_received` / `message_sent` — para canales (Telegram,
   WhatsApp, Discord, Signal). Journal entries con channel metadata.
   Esto hace que el Journal tab muestre **"main agent · via telegram
   · 14:32"** en cada entry, no solo timestamps.

**Resultado:** Cognition observa el gateway completo, no solo
las invocations directas del agente.

**Costo:** ~300 líneas.

---

## Resumen ejecutivo

| Fase | Impact | Costo | Pieza clave |
|---|---|---|---|
| A. Continuity | 🔴 alto | ~300 ln | `registerCompactionProvider` |
| B. Subagents | 🔴 alto | ~400 ln + 1 migración | `subagent_*` hooks |
| C. Session lifecycle | 🟡 medio | ~80 ln | `session_start/end` |
| D. Operator UX | 🟡 medio | ~250 ln | `registerSessionAction` + Control UI |
| E. Governance | 🟡 medio | ~200 ln | toolMetadata + audit + policy |
| F. Autonomy + canales | 🟢 bajo | ~300 ln | heartbeat + persist + channel hooks |

**Recomendación de orden:** A → B → C → E → D → F.

- A primero porque resuelve el problema más grande hoy (memoria que se
  pierde al compactar).
- B después porque Mario explícitamente pidió robustez per-agent y eso
  es donde el plugin se vuelve la columna vertebral de fleets de
  agentes.
- C es barato y pone orden al journal (precondición útil para D y F).
- E es trabajo de infraestructura que el operator no nota
  inmediatamente pero importa para production trust.
- D es UX puro — agradable pero no transformacional.
- F sólo cuando arranquemos a meter canales en serio o autonomy
  modes.

---

## Lo que no vamos a implementar y por qué

- `registerProvider` / `registerSpeechProvider` / `registerImageGenerationProvider`
  etc. — somos un plugin de cognición, no un proveedor de modelos.
- `registerChannel` — somos memoria, no un canal de mensajería.
- `registerContextEngine` — slot exclusivo; memory-core probablemente
  lo tiene. Pelear por él no aporta vs. `registerCompactionProvider`
  que no es exclusivo.
- `registerTrustedToolPolicy` — bundled-only (CLAUDE.md §2b confirmed).
  External plugins no pueden registrarlo.
- `registerCodexAppServerExtensionFactory` — bundled-only.
- `registerAgentHarness` — somos memoria, no un harness.
- `registerMigrationProvider` — solo aplica a sistemas con migraciones
  custom; nuestras migrations son SQL puras y el engine las corre.

---

## Verificación

- `registerCompactionProvider` shape verificado en
  `openclaw-study/src/plugins/compaction-provider.ts:CompactionProvider`.
- Subagent payload verificado en
  `openclaw-study/src/plugins/hook-types.ts:PluginHookSubagentSpawnBase`.
- Lista de hooks completa en
  `openclaw-study/src/plugins/hook-types.ts:PLUGIN_HOOK_NAMES`.
- Lista de register* completa en
  `openclaw-study/src/plugins/types.ts:2492-2860`.

Próximo paso: Mario aprueba el orden A→B→C→… (o reordena), y arranco la
implementación por fase. Cada fase es 1-2 commits + audit pass + doc
update.
