/**
 * Cross-Language Trace Comparison Tests for local HuggingFace inference
 * (Transformers.js) instrumentation.
 *
 * Verifies that the TypeScript SDK produces traces consistent with the Python
 * `transformers` instrumentation and the OTel GenAI semantic conventions:
 *   - text-generation reports the `chat` operation (Python parity)
 *   - other local pipelines map to the closest OTel operation
 *   - token usage, cache tokens, timing, and package version are stamped
 */
export {};
