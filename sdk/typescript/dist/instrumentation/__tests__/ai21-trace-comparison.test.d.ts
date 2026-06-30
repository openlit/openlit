/**
 * Cross-Language Trace Comparison Tests for the AI21 Integration
 *
 * These verify that the TypeScript AI21 instrumentation emits the same span
 * attributes / events as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/ai21). AI21's request surface has no
 * seed / frequency_penalty / presence_penalty, and its responses carry no
 * `model` field, so the response model falls back to the request model.
 */
export {};
