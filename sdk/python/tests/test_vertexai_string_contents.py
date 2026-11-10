# pylint: disable=too-few-public-methods
"""Vertex AI telemetry must handle every documented form of ``contents``.

``GenerativeModel.generate_content("prompt")`` takes a plain string, a list
of strings, or ``Content`` objects whose ``Part`` exposes only some fields
(``vertexai.generative_models.Part`` has no ``video_metadata``, for example).
Formatting the request for the span must not raise on any of them, or the
span is marked as an error and loses its tokens and messages even though the
call succeeded.
"""

import asyncio

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from openlit._config import OpenlitConfig
from openlit.instrumentation.vertexai import async_vertexai as async_mod
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


class FakeFilePart:
    """Like ``Part.from_uri``: only ``file_data`` is set."""

    def __init__(self, uri):
        self.file_data = {"file_uri": uri}


class Image:
    """Stands in for vertexai's Image, which has none of Part's fields."""


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


class FakeResponse:
    """Shaped like a non-streaming GenerationResponse."""

    text = "Blue"
    usage_metadata = FakeUsageMetadata()
    candidates = []


class FakeInstance:
    """Minimal instance so extract_vertexai_details() resolves a model name."""

    _location = "us-central1"
    _model_name = (
        "projects/p/locations/us-central1/publishers/google/models/gemini-1.5-flash"
    )


def test_format_content_accepts_strings_and_partial_parts():
    """Strings and Parts without every field are formatted instead of raising."""
    assert vertexai_utils.format_content("Why is the sky blue?") == (
        "user: text: Why is the sky blue?"
    )
    # Consecutive strings are one user message, as in build_input_messages
    assert vertexai_utils.format_content(["Why?", "Because."]) == (
        "user: text: Why?, text: Because."
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


def test_loose_parts_and_images_form_one_user_message():
    """``[Part, Image, "question"]`` is one user message, as the SDK sends it."""
    contents = [
        FakeFilePart("gs://bucket/cat.png"),
        Image(),
        FakePart("What is in these?"),
        "Answer briefly.",
    ]
    assert vertexai_utils.build_input_messages(contents) == [
        {
            "role": "user",
            "parts": [
                {"type": "text", "content": "[file_data]"},
                {"type": "text", "content": "[Image]"},
                {"type": "text", "content": "What is in these?"},
                {"type": "text", "content": "Answer briefly."},
            ],
        }
    ]
    assert vertexai_utils.format_content(contents) == (
        "user: file_data: {'file_uri': 'gs://bucket/cat.png'}, [Image], "
        "text: What is in these?, text: Answer briefly."
    )


def test_dict_contents_are_read_like_content_objects():
    """Content and Part given as dicts are read, not dropped."""
    contents = [
        {"role": "user", "parts": [{"text": "Hi"}]},
        {"role": "model", "parts": [{"text": "Hello"}]},
    ]
    assert vertexai_utils.format_content(contents) == (
        "user: text: Hi\nmodel: text: Hello"
    )
    assert vertexai_utils.build_input_messages(contents) == [
        {"role": "user", "parts": [{"type": "text", "content": "Hi"}]},
        {"role": "model", "parts": [{"type": "text", "content": "Hello"}]},
    ]


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _wrapper(factory, tracer):
    return factory(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=True,
        metrics=None,
        disable_metrics=True,
    )


def _assert_prompt_recorded(exporter):
    span = exporter.get_finished_spans()[0]
    assert span.status.status_code == StatusCode.OK
    assert span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 4
    assert "Why is the sky blue?" in span.attributes[
        SemanticConvention.GEN_AI_INPUT_MESSAGES
    ]


def test_non_streaming_positional_prompt_is_recorded():
    """``generate_content("prompt")`` without ``stream`` keeps its input message."""
    tracer, exporter = _tracer_and_exporter()
    response = _wrapper(sync_mod.send_message, tracer)(
        lambda *_args, **_kwargs: FakeResponse(),
        FakeInstance(),
        ("Why is the sky blue?",),
        {},
    )
    assert response.text == "Blue"
    _assert_prompt_recorded(exporter)


def test_async_non_streaming_positional_prompt_is_recorded():
    """Async twin of the non-streaming positional prompt test."""
    tracer, exporter = _tracer_and_exporter()

    async def fake_generate(*_args, **_kwargs):
        return FakeResponse()

    response = asyncio.run(
        _wrapper(async_mod.async_send_message, tracer)(
            fake_generate,
            FakeInstance(),
            ("Why is the sky blue?",),
            {},
        )
    )
    assert response.text == "Blue"
    _assert_prompt_recorded(exporter)
