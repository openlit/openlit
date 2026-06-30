/**
 * Cross-Language Trace Comparison Tests for the mem0 Integration
 *
 * These verify that the TypeScript mem0 instrumentation emits the same spans /
 * attributes as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/mem0). mem0 is a memory layer, not an LLM
 * provider: each operation (add / search / get / getAll / update / delete /
 * deleteAll / history) becomes one CLIENT span named `memory <op>` carrying
 * `gen_ai.*` attributes. There are no tokens, model, cost, or metrics. The same
 * wrapper serves both the hosted `MemoryClient` and the OSS `Memory` clients, whose
 * method surfaces are identical.
 */
export {};
