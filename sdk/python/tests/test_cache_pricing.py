# pylint: disable=missing-function-docstring, missing-class-docstring, too-few-public-methods
"""
Unit tests for cache-aware cost calculation in ``get_chat_model_cost``.

These cover the two token-accounting conventions used by the instrumentations
that forward cache token counts:

* Anthropic native API / Bedrock -> ``prompt_tokens`` is *exclusive* of cache tokens.
* LangChain / LiteLLM / OpenAI-style -> ``prompt_tokens`` is *inclusive* of cache
  tokens (sum of all input token types).

The same cached tokens must never be billed twice, and models without cache
pricing must produce exactly the legacy cost regardless of convention.
"""

import pytest

from openlit.__helpers import get_chat_model_cost
from openlit.instrumentation.litellm.utils import _extract_litellm_cache_tokens


PRICING_WITH_CACHE = {
    "chat": {
        "claude-3-5-sonnet-20241022": {
            "promptPrice": 0.003,
            "completionPrice": 0.015,
            "cacheReadPrice": 0.0003,
            "cacheCreationPrice": 0.00375,
        },
        # A model that supports caching but has no cache pricing configured.
        "model-no-cache-price": {
            "promptPrice": 0.003,
            "completionPrice": 0.015,
        },
    }
}

MODEL = "claude-3-5-sonnet-20241022"


def _approx(value):
    return pytest.approx(value, rel=1e-9)


class TestNoCacheTokens:
    def test_matches_legacy_formula_without_cache(self):
        cost = get_chat_model_cost(MODEL, PRICING_WITH_CACHE, 1000, 500)
        assert cost == _approx((1000 / 1000) * 0.003 + (500 / 1000) * 0.015)

    def test_unknown_model_returns_zero(self):
        assert get_chat_model_cost("does-not-exist", PRICING_WITH_CACHE, 10, 10) == 0


class TestAnthropicConvention:
    """prompt_tokens is exclusive of cache tokens (default behaviour)."""

    def test_cache_added_on_top(self):
        # 800 uncached input + 100 cache read + 100 cache creation, 500 output
        cost = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=800,
            completion_tokens=500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
        )
        expected = (
            (800 / 1000) * 0.003
            + (500 / 1000) * 0.015
            + (100 / 1000) * 0.0003
            + (100 / 1000) * 0.00375
        )
        assert cost == _approx(expected)

    def test_no_cache_price_leaves_prompt_untouched(self):
        # Without cache pricing the cache tokens contribute nothing and the
        # prompt base is not reduced (legacy behaviour preserved).
        cost = get_chat_model_cost(
            "model-no-cache-price",
            PRICING_WITH_CACHE,
            prompt_tokens=800,
            completion_tokens=500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
        )
        assert cost == _approx((800 / 1000) * 0.003 + (500 / 1000) * 0.015)

    def test_bedrock_style_exclusive_cache_fields(self):
        # Bedrock Converse: inputTokens exclusive; cacheReadInputTokens /
        # cacheWriteInputTokens passed as read / creation with include=False.
        cost = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=800,
            completion_tokens=200,
            cache_read_tokens=150,
            cache_creation_tokens=50,
            prompt_tokens_include_cache=False,
        )
        expected = (
            (800 / 1000) * 0.003
            + (200 / 1000) * 0.015
            + (150 / 1000) * 0.0003
            + (50 / 1000) * 0.00375
        )
        assert cost == _approx(expected)


class TestLangChainConvention:
    """prompt_tokens already includes cache tokens (sum of all input types)."""

    def test_cache_tokens_not_billed_twice(self):
        # 1000 total input = 800 uncached + 100 cache read + 100 cache creation
        cost = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=1000,
            completion_tokens=500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
            prompt_tokens_include_cache=True,
        )
        expected = (
            (800 / 1000) * 0.003  # only the uncached remainder at prompt price
            + (500 / 1000) * 0.015
            + (100 / 1000) * 0.0003
            + (100 / 1000) * 0.00375
        )
        assert cost == _approx(expected)

    def test_inclusive_matches_exclusive_for_same_call(self):
        # Inclusive(1000) and exclusive(800) describe the same request and must
        # yield identical cost.
        inclusive = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=1000,
            completion_tokens=500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
            prompt_tokens_include_cache=True,
        )
        exclusive = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=800,
            completion_tokens=500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
        )
        assert inclusive == _approx(exclusive)

    def test_no_cache_price_matches_legacy_total(self):
        # When no cache pricing exists, an inclusive caller must get exactly the
        # legacy cost (full input billed at prompt price), i.e. no regression.
        cost = get_chat_model_cost(
            "model-no-cache-price",
            PRICING_WITH_CACHE,
            prompt_tokens=1000,
            completion_tokens=500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
            prompt_tokens_include_cache=True,
        )
        assert cost == _approx((1000 / 1000) * 0.003 + (500 / 1000) * 0.015)

    def test_openai_style_cache_read_only(self):
        # OpenAI reports prompt_tokens inclusive of cached_tokens and has no
        # cache-creation charge.
        pricing = {
            "chat": {
                "gpt-cache": {
                    "promptPrice": 0.0025,
                    "completionPrice": 0.01,
                    "cacheReadPrice": 0.00125,
                }
            }
        }
        cost = get_chat_model_cost(
            "gpt-cache",
            pricing,
            prompt_tokens=1000,
            completion_tokens=200,
            cache_read_tokens=400,
            cache_creation_tokens=0,
            prompt_tokens_include_cache=True,
        )
        expected = (600 / 1000) * 0.0025 + (200 / 1000) * 0.01 + (400 / 1000) * 0.00125
        assert cost == _approx(expected)

    def test_litellm_style_inclusive_with_creation(self):
        # LiteLLM-normalized Anthropic/OpenAI usage: prompt_tokens already
        # include cache buckets; creation comes from cache_creation_input_tokens
        # / prompt_tokens_details.cache_write_tokens (never completion details).
        cost = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=1200,
            completion_tokens=100,
            cache_read_tokens=200,
            cache_creation_tokens=200,
            prompt_tokens_include_cache=True,
        )
        expected = (
            (800 / 1000) * 0.003
            + (100 / 1000) * 0.015
            + (200 / 1000) * 0.0003
            + (200 / 1000) * 0.00375
        )
        assert cost == _approx(expected)

    def test_cache_exceeding_prompt_does_not_go_negative(self):
        # Defensive: malformed data where cache tokens exceed reported input.
        cost = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            prompt_tokens=100,
            completion_tokens=0,
            cache_read_tokens=200,
            cache_creation_tokens=200,
            prompt_tokens_include_cache=True,
        )
        # billable prompt clamps to 0; only cache costs remain.
        expected = (200 / 1000) * 0.0003 + (200 / 1000) * 0.00375
        assert cost == _approx(expected)


class TestLiteLLMCacheExtraction:
    def test_prefers_cache_creation_input_tokens(self):
        read, creation = _extract_litellm_cache_tokens(
            {
                "prompt_tokens_details": {
                    "cached_tokens": 10,
                    "cache_write_tokens": 99,
                },
                "cache_creation_input_tokens": 42,
                "completion_tokens_details": {"cached_tokens": 999},
            }
        )
        assert read == 10
        assert creation == 42

    def test_falls_back_to_prompt_details_write_tokens(self):
        read, creation = _extract_litellm_cache_tokens(
            {
                "prompt_tokens_details": {
                    "cached_tokens": 5,
                    "cache_write_tokens": 7,
                },
                "completion_tokens_details": {"cached_tokens": 999},
            }
        )
        assert read == 5
        assert creation == 7

    def test_anthropic_top_level_fields(self):
        read, creation = _extract_litellm_cache_tokens(
            {
                "cache_read_input_tokens": 11,
                "cache_creation_input_tokens": 13,
            }
        )
        assert read == 11
        assert creation == 13

    def test_ignores_completion_tokens_details_cached_tokens(self):
        read, creation = _extract_litellm_cache_tokens(
            {"completion_tokens_details": {"cached_tokens": 999}}
        )
        assert read == 0
        assert creation == 0


class TestBundledPricingFile:
    """Sanity-check the cache fields actually shipped in assets/pricing.json."""

    def test_claude_cache_rates_present_and_consistent(self):
        import json
        import os

        pricing_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "..",
            "assets",
            "pricing.json",
        )
        if not os.path.exists(pricing_path):
            pytest.skip("bundled pricing.json not available in this checkout")

        with open(pricing_path, "r", encoding="utf-8") as handle:
            pricing = json.load(handle)

        entry = pricing["chat"]["claude-3-5-sonnet-20241022"]
        assert entry["cacheReadPrice"] == _approx(0.0003)
        assert entry["cacheCreationPrice"] == _approx(0.00375)
        # cache read should be cheaper than prompt; cache write pricier.
        assert entry["cacheReadPrice"] < entry["promptPrice"]
        assert entry["cacheCreationPrice"] > entry["promptPrice"]
