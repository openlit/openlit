/**
 * Unit tests for cache-aware cost calculation in `OpenLitHelper.getChatModelCost`.
 *
 * Mirrors the Python `test_cache_pricing.py` coverage and validates the two
 * provider token-accounting conventions:
 *   - Anthropic native API -> promptTokens is exclusive of cache tokens.
 *   - OpenAI / LangChain -> promptTokens is inclusive of cache tokens.
 *
 * The same cached tokens must never be billed twice, and models without cache
 * pricing must produce exactly the legacy cost regardless of convention.
 */
export {};
