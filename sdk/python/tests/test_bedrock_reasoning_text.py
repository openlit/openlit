# pylint: disable=protected-access, missing-function-docstring, too-few-public-methods
"""Regression tests: a non-streaming Bedrock `converse` response that starts
with a `reasoningContent` block must still record the answer text.

`process_chat_response` read only `output.message.content[0].text`. Reasoning
models on Bedrock (OpenAI GPT-6 Sol/Luna, gpt-oss, Claude with extended
thinking) return the reasoning block first and the answer in the next block,
so the span recorded an empty output. These tests drive the real `converse`
wrapper factory with a fake bedrock-runtime client and assert the text parts
in `gen_ai.output.messages`, mirroring how the Anthropic instrumentation joins
every text block.
"""

import json

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.bedrock.bedrock import converse

REDACTED = {"reasoningContent": {"redactedContent": b"rsn_abc"}}
REASONING_TEXT = {"reasoningContent": {"reasoningText": {"text": "thinking"}}}


class FakeClient:
    """Stands in for a boto3 bedrock-runtime client."""

    def __init__(self, content):
        self._content = content

    def converse(self, **_):
        return {
            "output": {"message": {"role": "assistant", "content": self._content}},
            "stopReason": "end_turn",
            "usage": {"inputTokens": 13, "outputTokens": 17, "totalTokens": 30},
        }


def _output_text_parts(content):
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    wrapper = converse(
        version="test",
        environment="test",
        application_name="test",
        tracer=provider.get_tracer(__name__),
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )
    client = wrapper(
        lambda *a, **k: FakeClient(content), None, (), {"service_name": "bedrock-runtime"}
    )
    client.converse(
        modelId="us.openai.gpt-6-luna",
        messages=[{"role": "user", "content": [{"text": "hi"}]}],
    )
    (span,) = exporter.get_finished_spans()
    output = json.loads(span.attributes["gen_ai.output.messages"])
    return [part["content"] for part in output[0]["parts"] if part["type"] == "text"]


@pytest.mark.parametrize(
    "content, expected",
    [
        ([{"text": "pong"}], ["pong"]),
        ([REDACTED, {"text": "pong"}], ["pong"]),
        ([REASONING_TEXT, {"text": "pong"}], ["pong"]),
        ([REDACTED], []),
    ],
    ids=["text-only", "redacted-reasoning", "reasoning-text", "reasoning-only"],
)
def test_converse_records_text_after_reasoning_block(content, expected):
    assert _output_text_parts(content) == expected
