/**
 * Cross-Language Trace Comparison Tests for the AI21 Conversational RAG path.
 *
 * Verifies that the TypeScript AI21 RAG instrumentation emits the same span
 * attributes as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/ai21: chat_rag / common_chat_rag_logic).
 * The RAG response shape differs from chat: the answer lives at
 * `choices[i].content` (not `choices[i].message.content`), there is no `model`
 * field (falls back to the request model), no usage token counts (counted
 * locally), and the path is never streamed. It additionally emits six
 * `gen_ai.rag.*` attributes mirrored from the Python implementation.
 */
export {};
