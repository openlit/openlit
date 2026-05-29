# pylint: disable=missing-function-docstring
"""Provider-coverage matrix test for ``openlit.agent.version_hash``.

Every Python LLM provider instrumentation MUST stamp the agent version hash
on its chat span (see ``apply_agent_version_attributes`` in
``openlit.__helpers``). This lets the unified Agents page filter by
``openlit.agent.version_hash`` directly instead of falling back to the
materialized version time window, which is both slower and imprecise.

This test guards against regression: if someone adds a new chat-LLM
provider but forgets to wire ``apply_agent_version_attributes``, this test
fails. Coverage is asserted statically (reading the provider's ``utils.py``
once) so we do not have to mount full mock provider clients for each one.

For ``strands``, the equivalent stamping lives in
``instrumentation/strands/processor.py`` (a span processor, not a wrapper);
it is checked alongside ``utils.py`` for that provider.
"""

from __future__ import annotations

from pathlib import Path

import pytest


PROVIDERS_DIR = (
    Path(__file__).resolve().parents[1] / "src" / "openlit" / "instrumentation"
)

# Providers that wrap a chat-LLM call and therefore MUST stamp the hash.
# Keeping the list explicit (rather than auto-discovering every utils.py)
# avoids false positives on RAG/agent/vector/etc. instrumentations that
# don't have a chat span to stamp.
LLM_PROVIDERS_WITH_UTILS = (
    "ai21",
    "anthropic",
    "azure_ai_inference",
    "bedrock",
    "cohere",
    "gpt4all",
    "gradient",
    "groq",
    "litellm",
    "mistral",
    "ollama",
    "openai",
    "premai",
    "pydo",
    "reka",
    "sarvam",
    "together",
    "transformers",
    "vertexai",
    "vllm",
)

# Providers that stamp via a span processor instead of a wrapper utils.py.
PROCESSOR_PROVIDERS = ("strands",)


@pytest.mark.parametrize("provider", LLM_PROVIDERS_WITH_UTILS)
def test_provider_utils_stamps_version_hash(provider: str) -> None:
    utils_path = PROVIDERS_DIR / provider / "utils.py"
    assert utils_path.is_file(), f"missing utils.py for provider '{provider}'"
    source = utils_path.read_text(encoding="utf-8")
    assert "apply_agent_version_attributes" in source, (
        f"provider '{provider}' missing apply_agent_version_attributes; "
        "every chat-LLM provider must stamp openlit.agent.version_hash "
        "on its chat span"
    )


@pytest.mark.parametrize("provider", PROCESSOR_PROVIDERS)
def test_processor_provider_stamps_version_hash(provider: str) -> None:
    processor_path = PROVIDERS_DIR / provider / "processor.py"
    utils_path = PROVIDERS_DIR / provider / "utils.py"

    sources = []
    if processor_path.is_file():
        sources.append(processor_path.read_text(encoding="utf-8"))
    if utils_path.is_file():
        sources.append(utils_path.read_text(encoding="utf-8"))

    assert sources, f"provider '{provider}' has neither processor.py nor utils.py"
    combined = "\n".join(sources)
    assert (
        "apply_agent_version_attributes" in combined
        or "OPENLIT_AGENT_VERSION_HASH" in combined
    ), (
        f"provider '{provider}' (processor-based) must stamp "
        "openlit.agent.version_hash on its chat span"
    )
