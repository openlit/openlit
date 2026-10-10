"""Regression tests for request parameters the app never sent (Issue #1708).

OpenLIT used to record ``gen_ai.request.*`` attributes with defaults of its own
choosing (seed=0, temperature=1.0, top_p=1.0, penalties=0.0, user='', Anthropic
top_k=1.0, ...) when the caller did not set them. The provider applies its own
defaults, so those values misreported the request. A ``gen_ai.request.*``
attribute must be recorded only when the caller actually set the parameter.
"""

import time
from types import SimpleNamespace

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic import utils as anthropic_utils
from openlit.instrumentation.openai import utils as openai_utils
from openlit.semcov import SemanticConvention

REQUEST_ATTRS = (
    SemanticConvention.GEN_AI_REQUEST_SEED,
    SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
    SemanticConvention.GEN_AI_REQUEST_TOP_P,
    SemanticConvention.GEN_AI_REQUEST_TOP_K,
    SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
    SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
    SemanticConvention.GEN_AI_REQUEST_USER,
    SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
    SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
)


class _NotGiven:
    """Stands in for the OpenAI SDK's NotGiven sentinel (matched by class name)."""


_NotGiven.__name__ = "NotGiven"


def _tracer_and_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test-request-params"), exporter


def _scope(span, kwargs, **extra):
    fields = dict(
        _span=span,
        _llmresponse="Hello",
        _response_id="resp-1",
        _response_model="model-x",
        _finish_reason="stop",
        _input_tokens=3,
        _output_tokens=1,
        _system_fingerprint="",
        _service_tier=None,
        _tools=None,
        _response_tools=None,
        _tool_calls=None,
        _tool_calls_by_index={},
        _response_role="assistant",
        _operation_type="chat",
        _kwargs=kwargs,
        _start_time=time.time(),
        _end_time=None,
        _timestamps=[],
        _ttft=0,
        _tbt=0,
        _server_address="api.example.com",
        _server_port=443,
    )
    fields.update(extra)
    return SimpleNamespace(**fields)


def _common(**overrides):
    args = dict(
        pricing_info={},
        environment="test",
        application_name="test",
        metrics=None,
        capture_message_content=False,
        disable_metrics=True,
        version="1.0.0",
    )
    args.update(overrides)
    return args


def _openai_chat_attrs(kwargs):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("chat gpt-4o-mini") as span:
        scope = _scope(span, {"model": "gpt-4o-mini", **kwargs})
        openai_utils.process_streaming_chat_response(scope, **_common())
    return exporter.get_finished_spans()[0].attributes


def _openai_responses_attrs(kwargs):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("chat gpt-4o-mini") as span:
        scope = _scope(
            span,
            {"model": "gpt-4o-mini", "input": "hi", **kwargs},
            _operation_type="responses",
        )
        openai_utils.process_streaming_response_response(scope, **_common())
    return exporter.get_finished_spans()[0].attributes


def _anthropic_attrs(kwargs):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("chat claude-x") as span:
        scope = _scope(
            span,
            {
                "model": "claude-x",
                "messages": [{"role": "user", "content": "hi"}],
                **kwargs,
            },
            _cache_read_input_tokens=0,
            _cache_creation_input_tokens=0,
        )
        anthropic_utils.process_streaming_chat_response(scope, **_common())
    return exporter.get_finished_spans()[0].attributes


def test_openai_chat_unset_params_are_not_recorded():
    attrs = _openai_chat_attrs({})
    for key in REQUEST_ATTRS:
        assert key not in attrs, key


def test_openai_chat_notgiven_params_are_not_recorded():
    attrs = _openai_chat_attrs(
        {
            "seed": _NotGiven(),
            "temperature": _NotGiven(),
            "top_p": _NotGiven(),
            "user": _NotGiven(),
        }
    )
    for key in REQUEST_ATTRS:
        assert key not in attrs, key


def test_openai_chat_explicit_params_are_recorded():
    attrs = _openai_chat_attrs(
        {
            "seed": 0,
            "temperature": 0.0,
            "top_p": 0.5,
            "frequency_penalty": 0.0,
            "presence_penalty": 0.25,
            "user": "u-1",
            "max_tokens": 10,
        }
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_SEED] == 0
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] == 0.0
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_P] == 0.5
    assert attrs[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] == 0.0
    assert attrs[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] == 0.25
    assert attrs[SemanticConvention.GEN_AI_REQUEST_USER] == "u-1"
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] == 10


def test_openai_responses_unset_params_are_not_recorded():
    attrs = _openai_responses_attrs({})
    for key in REQUEST_ATTRS:
        assert key not in attrs, key


def test_openai_responses_explicit_params_are_recorded():
    attrs = _openai_responses_attrs(
        {"temperature": 0.2, "top_p": 0.9, "max_output_tokens": 64}
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] == 0.2
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_P] == 0.9
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] == 64


def test_anthropic_unset_params_are_not_recorded():
    attrs = _anthropic_attrs({})
    for key in REQUEST_ATTRS:
        assert key not in attrs, key


def test_anthropic_only_max_tokens_set():
    attrs = _anthropic_attrs({"max_tokens": 50})
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] == 50
    for key in REQUEST_ATTRS:
        if key != SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS:
            assert key not in attrs, key


def test_anthropic_explicit_params_are_recorded():
    attrs = _anthropic_attrs(
        {
            "max_tokens": 50,
            "temperature": 0.0,
            "top_p": 0.8,
            "top_k": 5,
            "stop_sequences": ["END"],
        }
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] == 0.0
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_P] == 0.8
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_K] == 5
    assert tuple(attrs[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES]) == ("END",)


def test_openai_chat_explicit_empty_user_and_stop_are_recorded():
    attrs = _openai_chat_attrs({"user": "", "stop": []})
    assert attrs[SemanticConvention.GEN_AI_REQUEST_USER] == ""
    assert tuple(attrs[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES]) == ()


def _embedding_attrs(kwargs):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("embeddings text-embedding-3-small") as span:
        openai_utils.process_embedding_response(
            {"data": [{"embedding": [0.1, 0.2]}], "usage": {"prompt_tokens": 2}},
            request_model="text-embedding-3-small",
            server_port=443,
            server_address="api.openai.com",
            start_time=time.time(),
            span=span,
            **_common(),
            **kwargs,
        )
    return exporter.get_finished_spans()[0].attributes


def _image_attrs(kwargs):
    tracer, exporter = _tracer_and_exporter()
    with tracer.start_as_current_span("image dall-e-3") as span:
        openai_utils.process_image_response(
            {"data": [{"url": "http://x/y.png"}], "created": 1},
            request_model="dall-e-3",
            server_port=443,
            server_address="api.openai.com",
            start_time=time.time(),
            end_time=time.time(),
            span=span,
            **_common(),
            **kwargs,
        )
    return exporter.get_finished_spans()[0].attributes


def test_openai_embedding_unset_params_are_not_recorded():
    attrs = _embedding_attrs({"input": "hi"})
    assert SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS not in attrs
    assert SemanticConvention.GEN_AI_REQUEST_USER not in attrs


def test_openai_embedding_explicit_params_are_recorded():
    attrs = _embedding_attrs(
        {"input": "hi", "encoding_format": "base64", "user": ""}
    )
    assert tuple(attrs[SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS]) == (
        "base64",
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_USER] == ""


def test_openai_image_unset_params_are_not_recorded():
    attrs = _image_attrs({"prompt": "a cat"})
    assert SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE not in attrs
    assert SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY not in attrs
    assert SemanticConvention.GEN_AI_REQUEST_USER not in attrs


def test_openai_image_explicit_params_are_recorded():
    attrs = _image_attrs({"prompt": "a cat", "size": "512x512", "quality": "hd"})
    assert attrs[SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE] == "512x512"
    assert attrs[SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY] == "hd"


def _hash(attrs):
    return attrs["openlit.agent.version_hash"]


def test_openai_version_hash_ignores_unset_but_tracks_explicit_params():
    unset = _openai_chat_attrs({})
    sentinel = _openai_chat_attrs(
        {"temperature": _NotGiven(), "top_p": _NotGiven(), "max_tokens": _NotGiven()}
    )
    explicit = _openai_chat_attrs({"temperature": 1.0, "top_p": 1.0})
    assert _hash(unset) == _hash(sentinel)
    assert _hash(unset) != _hash(explicit)


def test_anthropic_sentinels_are_dropped_from_events_and_hash():
    assert anthropic_utils._given({"top_k": _NotGiven()}, "top_k") is None
    assert anthropic_utils._given({"top_k": None}, "top_k") is None
    assert anthropic_utils._given({"top_k": 0}, "top_k") == 0
    assert _hash(_anthropic_attrs({"max_tokens": 5})) == _hash(
        _anthropic_attrs({"max_tokens": 5, "temperature": _NotGiven()})
    )
