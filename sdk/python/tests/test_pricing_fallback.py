# pylint: disable=missing-function-docstring, missing-class-docstring, too-few-public-methods
"""
Unit tests for the offline pricing fallback in ``get_chat_model_cost``.

``fetch_pricing_info`` returns ``{}`` when the pricing file cannot be
downloaded (air-gapped hosts, proxies, GitHub outages), and models that the
pricing file does not list (dated snapshot ids, new releases) used to cost 0.
Both cases are now priced from the bundled ``llm-prices`` table, while entries
in ``pricing_info`` keep taking precedence.
"""

import json
import os

import llm_prices
import pytest

from openlit.__helpers import get_chat_model_cost


PRICING_JSON = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "assets", "pricing.json"
)

# Anthropic's pinned snapshot id: $3 / $15 per 1M tokens, cache read $0.30,
# 5-minute cache write $3.75.
SONNET_4_5 = "claude-sonnet-4-5-20250929"


def _approx(value):
    return pytest.approx(value, rel=1e-9)


def _shipped_pricing():
    with open(PRICING_JSON, encoding="utf-8") as f:
        return json.load(f)


def _expected(model, prompt_tokens, completion_tokens):
    price = llm_prices.lookup(model)
    return (prompt_tokens * price.input + completion_tokens * price.output) / 1e6


class TestPricingFileUnavailable:
    """``fetch_pricing_info`` failed and returned ``{}``."""

    @pytest.mark.parametrize("pricing_info", [{}, None, {"chat": {}}])
    def test_known_model_is_priced(self, pricing_info):
        cost = get_chat_model_cost(SONNET_4_5, pricing_info, 1000, 500)
        assert cost == _approx(1000 / 1e6 * 3.0 + 500 / 1e6 * 15.0)

    def test_cache_tokens_added_on_top(self):
        # Anthropic convention: prompt_tokens excludes cache tokens.
        cost = get_chat_model_cost(
            SONNET_4_5,
            {},
            800,
            500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
        )
        expected = (800 * 3.0 + 500 * 15.0 + 100 * 0.3 + 100 * 3.75) / 1e6
        assert cost == _approx(expected)

    def test_inclusive_prompt_tokens_not_billed_twice(self):
        # LangChain convention: prompt_tokens already includes cache tokens.
        cost = get_chat_model_cost(
            SONNET_4_5,
            {},
            1000,
            500,
            cache_read_tokens=100,
            cache_creation_tokens=100,
            prompt_tokens_include_cache=True,
        )
        expected = (800 * 3.0 + 500 * 15.0 + 100 * 0.3 + 100 * 3.75) / 1e6
        assert cost == _approx(expected)

    def test_provider_prefixed_and_bedrock_ids(self):
        expected = 1000 / 1e6 * 3.0 + 500 / 1e6 * 15.0
        for model in (
            "anthropic/claude-sonnet-4-5-20250929",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        ):
            assert get_chat_model_cost(model, {}, 1000, 500) == _approx(expected)


class TestModelsMissingFromPricingFile:
    """Models absent from the shipped ``assets/pricing.json`` no longer cost 0."""

    @pytest.mark.parametrize(
        "model",
        [
            SONNET_4_5,
            "claude-sonnet-4-20250514",
            "claude-sonnet-5",
            "o1",
            "o3-pro",
            "gpt-6-sol",
            "gemini-3.8-flash",
            "grok-4.7",
            "deepseek-v4-pro",
        ],
    )
    def test_priced_with_shipped_pricing_file(self, model):
        cost = get_chat_model_cost(model, _shipped_pricing(), 1000, 500)
        assert cost > 0
        if model not in _shipped_pricing()["chat"]:
            assert cost == _approx(_expected(model, 1000, 500))


class TestPricingInfoTakesPrecedence:
    def test_custom_entry_wins_over_fallback(self):
        pricing = {
            "chat": {SONNET_4_5: {"promptPrice": 0.001, "completionPrice": 0.002}}
        }
        cost = get_chat_model_cost(SONNET_4_5, pricing, 1000, 500)
        assert cost == _approx(0.001 + 0.001)

    def test_shipped_entry_unchanged(self):
        pricing = _shipped_pricing()
        entry = pricing["chat"]["gpt-4o"]
        cost = get_chat_model_cost("gpt-4o", pricing, 1000, 500)
        assert cost == _approx(entry["promptPrice"] + 0.5 * entry["completionPrice"])


class TestStillZero:
    @pytest.mark.parametrize(
        "model",
        [
            "does-not-exist",
            "llama3",
            "gpt-oss:20b",
            # Listed by llm-prices only as a Groq row; a self-hosted vLLM
            # deployment uses the same id and must not be billed Groq's rate.
            "openai/gpt-oss-120b",
        ],
    )
    def test_unknown_or_self_hosted_model_costs_zero(self, model):
        assert get_chat_model_cost(model, {}, 1000, 500) == 0
