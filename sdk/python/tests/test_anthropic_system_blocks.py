# pylint: disable=missing-function-docstring, protected-access
"""Regression tests: a one-shot `system` iterable must not fail the span (#1764).

The Anthropic SDK accepts `system` as a string or any iterable of text
blocks. A generator is consumed by the SDK during the request, so by the
time telemetry is processed it can no longer be serialized and the span was
wrongly marked ERROR. The wrappers now materialize a non-reiterable `system`
into a list before calling the SDK, so the request payload is identical and
telemetry stays serializable.
"""

import json

import pytest
from anthropic.types import Message, TextBlock, Usage
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic import anthropic as sync_mod
from openlit.instrumentation.anthropic import async_anthropic as async_mod
from openlit.instrumentation.anthropic.utils import normalize_system_blocks
from openlit.semcov import SemanticConvention

SYSTEM_BLOCKS = [{"type": "text", "text": "be kind"}]

REQUEST_KWARGS = {
    "model": "claude-3-5-sonnet-latest",
    "max_tokens": 8,
    "messages": [{"role": "user", "content": "hi"}],
}

RESPONSE = Message(
    id="msg_01",
    type="message",
    role="assistant",
    model="claude-3-5-sonnet-latest",
    content=[TextBlock(type="text", text="Hello")],
    stop_reason="end_turn",
    stop_sequence=None,
    usage=Usage(input_tokens=3, output_tokens=1),
)


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _system_generator():
    return (block for block in SYSTEM_BLOCKS)


def test_normalize_system_blocks_materializes_one_shot_iterables():
    kwargs = {"system": _system_generator()}
    normalize_system_blocks(kwargs)
    assert kwargs["system"] == SYSTEM_BLOCKS
    assert isinstance(kwargs["system"], list)


def test_normalize_system_blocks_leaves_reiterables_untouched():
    for value in ("be kind", SYSTEM_BLOCKS, tuple(SYSTEM_BLOCKS), None):
        kwargs = {} if value is None else {"system": value}
        normalize_system_blocks(kwargs)
        assert kwargs.get("system") == value


def test_sync_create_with_generator_system_succeeds():
    """messages.create with a generator `system` exports a non-ERROR span."""
    tracer, exporter = _tracer_with_exporter()
    factory = sync_mod.messages(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )

    received = {}

    def fake_create(*args, **kwargs):
        received.update(kwargs)
        return RESPONSE

    kwargs = {**REQUEST_KWARGS, "system": _system_generator()}
    response = factory(fake_create, None, (), kwargs)

    assert response is RESPONSE
    assert isinstance(received["system"], list), (
        "the SDK must receive a materialized list, not the one-shot generator"
    )
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code != StatusCode.ERROR
    system_attr = spans[0].attributes.get(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS)
    assert system_attr is not None and json.loads(system_attr)


@pytest.mark.asyncio
async def test_async_create_with_generator_system_succeeds():
    """AsyncMessages.create with a generator `system` exports a non-ERROR span."""
    tracer, exporter = _tracer_with_exporter()
    factory = async_mod.async_messages(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )

    received = {}

    async def fake_create(*args, **kwargs):
        received.update(kwargs)
        return RESPONSE

    kwargs = {**REQUEST_KWARGS, "system": _system_generator()}
    response = await factory(fake_create, None, (), kwargs)

    assert response is RESPONSE
    assert isinstance(received["system"], list)
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code != StatusCode.ERROR
    system_attr = spans[0].attributes.get(SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS)
    assert system_attr is not None and json.loads(system_attr)
