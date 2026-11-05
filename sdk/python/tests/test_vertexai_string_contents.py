# pylint: disable=too-few-public-methods
"""Vertex AI telemetry must handle every documented form of ``contents``.

``GenerativeModel.generate_content("prompt")`` takes a plain string, a list
of strings, or ``Content`` objects whose ``Part`` exposes only some fields
(``vertexai.generative_models.Part`` has no ``video_metadata``, for example).
Formatting the request for the span must not raise on any of them, or the
span is marked as an error and loses its tokens and messages even though the
call succeeded.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.vertexai import utils as vertexai_utils
from openlit.instrumentation.vertexai import vertexai as sync_mod
from openlit.semcov import SemanticConvention


class FakePart:
    """Like vertexai's Part: only ``text`` exists, other fields raise AttributeError."""

    def __init__(self, text):
        self.text = text


class FakeContent:
    """Shaped like vertexai.generative_models.Content."""

    def __init__(self, role, parts):
        self.role = role
        self.parts = parts


class FakeUsageMetadata:
    """Shaped like GenerationResponse.usage_metadata."""

    prompt_token_count = 4
    candidates_token_count = 1
    thoughts_token_count = 0
    cached_content_token_count = 0
    cache_creation_input_tokens = 0


class FakeChunk:
    """Shaped like a Vertex streaming chunk."""

    text = "Blue"
    usage_metadata = FakeUsageMetadata()


class FakeInstance:
    """Minimal instance so extract_vertexai_details() resolves a model name."""

    _location = "us-central1"
    _model_name = (
        "projects/p/locations/us-central1/publishers/google/models/gemini-1.5-flash"
    )


def test_format_content_accepts_strings_and_partial_parts():
    """Strings and Parts without every field are formatted instead of raising."""
    assert vertexai_utils.format_content("Why is the sky blue?") == (
        "user: Why is the sky blue?"
    )
    assert vertexai_utils.format_content(["Why?", "Because."]) == (
        "user: Why?\nuser: Because."
    )
    content = FakeContent("user", [FakePart("Why is the sky blue?")])
    assert vertexai_utils.format_content([content]) == (
        "user: text: Why is the sky blue?"
    )
    assert vertexai_utils.format_content(content) == "user: text: Why is the sky blue?"


def test_build_input_messages_accepts_strings_and_single_contents():
    """Strings become user text, consecutive ones in one message as the SDK sends them."""
    assert vertexai_utils.build_input_messages("Why is the sky blue?") == [
        {"role": "user", "parts": [{"type": "text", "content": "Why is the sky blue?"}]}
    ]
    assert vertexai_utils.build_input_messages(["Why?", "Because."]) == [
        {
            "role": "user",
            "parts": [
                {"type": "text", "content": "Why?"},
                {"type": "text", "content": "Because."},
            ],
        }
    ]
    content = FakeContent("user", [FakePart("Why is the sky blue?")])
    assert vertexai_utils.build_input_messages(content) == [
        {"role": "user", "parts": [{"type": "text", "content": "Why is the sky blue?"}]}
    ]


def test_streaming_string_prompt_keeps_the_span_ok():
    """``generate_content("prompt", stream=True)`` records tokens and messages."""
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    wrapper = sync_mod.send_message(
        version="test",
        environment="test",
        application_name="test",
        tracer=provider.get_tracer(__name__),
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )

    stream = wrapper(
        lambda *_args, **_kwargs: iter([FakeChunk()]),
        FakeInstance(),
        ("Why is the sky blue?",),
        {"stream": True},
    )
    assert "".join(chunk.text for chunk in stream) == "Blue"

    span = exporter.get_finished_spans()[0]
    assert span.status.status_code == StatusCode.OK
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 4
    assert "Why is the sky blue?" in span.attributes[
        SemanticConvention.GEN_AI_INPUT_MESSAGES
    ]
