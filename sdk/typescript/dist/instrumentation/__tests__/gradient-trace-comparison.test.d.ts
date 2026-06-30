/**
 * Cross-Language Trace Comparison Tests for the DigitalOcean Gradient Integration
 *
 * These verify that the TypeScript Gradient instrumentation emits the same span
 * attributes / events as the Python SDK reference
 * (sdk/python/src/openlit/instrumentation/gradient). Gradient is OpenAI-shaped:
 * responses carry a `model` field, requests support seed / frequency_penalty /
 * presence_penalty, and streaming usage arrives on the final chunk as `usage`.
 * The provider name is `digitalocean` and chat is served from inference.do-ai.run.
 */
export {};
