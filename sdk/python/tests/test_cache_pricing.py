# pylint: disable=missing-function-docstring, missing-class-docstring, too-few-public-methods
"""
Unit tests for cache-aware cost calculation in ``get_chat_model_cost``.

These cover the two token-accounting conventions used by the instrumentations
that forward cache token counts:

* Anthropic native API -> ``prompt_tokens`` is *exclusive* of cache tokens.
* LangChain ``usage_metadata`` -> ``prompt_tokens`` is *inclusive* of cache
  tokens (sum of all input token types).

The same cached tokens must never be billed twice, and models without cache
pricing must produce exactly the legacy cost regardless of convention.
"""

import pytest

from openlit.__helpers import get_chat_model_cost


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


# 200 uncached input + 5000 cache-read + 1000 cache-creation + 300 output.
_RAW_INPUT, _CACHE_READ, _CACHE_CREATION, _OUTPUT = 200, 5000, 1000, 300
_INCLUSIVE_INPUT = _RAW_INPUT + _CACHE_READ + _CACHE_CREATION  # 6200


def _ground_truth():
    return (
        (_RAW_INPUT / 1000) * 0.003
        + (_OUTPUT / 1000) * 0.015
        + (_CACHE_READ / 1000) * 0.0003
        + (_CACHE_CREATION / 1000) * 0.00375
    )


class TestClaudeAgentSDKAdapter:
    """The claude_agent_sdk adapter builds an inclusive input total in
    ``extract_usage`` (uncached + cache-read + cache-creation) and must re-price
    the cache tokens at their cache rates instead of the full prompt rate."""

    USAGE = {
        "input_tokens": _RAW_INPUT,
        "cache_read_input_tokens": _CACHE_READ,
        "cache_creation_input_tokens": _CACHE_CREATION,
        "output_tokens": _OUTPUT,
    }

    def test_extract_usage_total_is_inclusive(self):
        from openlit.instrumentation.claude_agent_sdk.utils import extract_usage
        from openlit.semcov import SemanticConvention as SC

        attrs = extract_usage(self.USAGE)
        assert attrs[SC.GEN_AI_USAGE_INPUT_TOKENS] == _INCLUSIVE_INPUT
        assert attrs[SC.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] == _CACHE_READ
        assert attrs[SC.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] == _CACHE_CREATION

    def test_cost_reprices_cache_tokens(self):
        from openlit.instrumentation.claude_agent_sdk.utils import (
            extract_usage,
            _calculate_cost,
        )
        from openlit.semcov import SemanticConvention as SC

        attrs = extract_usage(self.USAGE)
        cost = _calculate_cost(
            MODEL,
            PRICING_WITH_CACHE,
            attrs[SC.GEN_AI_USAGE_INPUT_TOKENS],
            attrs[SC.GEN_AI_USAGE_OUTPUT_TOKENS],
            attrs[SC.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
            attrs[SC.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
        )
        assert cost == _approx(_ground_truth())

    def test_billing_inclusive_total_at_prompt_price_overcharges(self):
        # Documents the pre-fix behaviour: billing the inclusive total at prompt
        # price charges cache-read tokens ~10x their real rate.
        overcharged = get_chat_model_cost(
            MODEL, PRICING_WITH_CACHE, _INCLUSIVE_INPUT, _OUTPUT
        )
        assert overcharged == _approx(
            (_INCLUSIVE_INPUT / 1000) * 0.003 + (_OUTPUT / 1000) * 0.015
        )
        assert overcharged > _ground_truth()


class TestLiteLLMAdapter:
    """litellm normalizes ``prompt_tokens`` to include cache tokens and reports
    both cache counts under ``prompt_tokens_details``. The adapter must read
    cache-creation from there (not the never-populated
    ``completion_tokens_details.cached_tokens``) and forward the cache counts to
    the cost helper."""

    # Shape of ``response["usage"]`` as litellm emits it (litellm 1.92.0).
    USAGE = {
        "prompt_tokens": _INCLUSIVE_INPUT,
        "completion_tokens": _OUTPUT,
        "prompt_tokens_details": {
            "cached_tokens": _CACHE_READ,
            "cache_creation_tokens": _CACHE_CREATION,
            "text_tokens": _RAW_INPUT,
        },
        # litellm never sets a cache count here; the old code read it anyway.
        "completion_tokens_details": {"text_tokens": _OUTPUT, "reasoning_tokens": 0},
    }

    def test_extract_cache_tokens_reads_prompt_tokens_details(self):
        from openlit.instrumentation.litellm.utils import _extract_cache_tokens

        cache_read, cache_creation = _extract_cache_tokens(self.USAGE)
        assert cache_read == _CACHE_READ
        # Was always 0 when read from completion_tokens_details.cached_tokens.
        assert cache_creation == _CACHE_CREATION

    def test_dead_field_source_yields_zero(self):
        # Confirms why the old source was wrong: litellm puts no cache count in
        # completion_tokens_details, so the previous read was always 0.
        assert (self.USAGE.get("completion_tokens_details") or {}).get(
            "cached_tokens", 0
        ) == 0

    def test_cost_prices_cache_tokens_at_cache_rate(self):
        cache_read, cache_creation = (_CACHE_READ, _CACHE_CREATION)
        cost = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            self.USAGE["prompt_tokens"],
            self.USAGE["completion_tokens"],
            cache_read_tokens=cache_read,
            cache_creation_tokens=cache_creation,
            prompt_tokens_include_cache=True,
        )
        assert cost == _approx(_ground_truth())

    def test_missing_cache_forward_overcharges(self):
        # Pre-fix: the whole inclusive prompt total is billed at prompt price.
        buggy = get_chat_model_cost(
            MODEL,
            PRICING_WITH_CACHE,
            self.USAGE["prompt_tokens"],
            self.USAGE["completion_tokens"],
        )
        assert buggy > _ground_truth()
