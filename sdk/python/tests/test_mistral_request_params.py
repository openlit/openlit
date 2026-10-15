# pylint: disable=protected-access, duplicate-code, missing-function-docstring
"""Regression tests: Mistral request parameters must be read from the names
the mistralai SDK actually accepts.

`chat.complete` / `chat.stream` take `top_p`, `stop` and `random_seed`, but
the instrumentation read Cohere's `p`, `stop_sequences` and `seed`, so a
request sent with `top_p=0.2, stop=["END"], random_seed=42` was recorded as
`top_p=1.0`, no stop sequences and an empty seed, plus a `top_k=1.0` that
Mistral has no parameter for. `top_p` also feeds the agent version hash, so
changing it never produced a new agent version.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral import mistral as sync_mod
from openlit.instrumentation.mistral.utils import process_chat_response
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "mistral-large-latest",
    "messages": [{"role": "user", "content": "Monitor LLM Applications"}],
    "top_p": 0.2,
    "stop": ["END"],
    "random_seed": 42,
}

RESPONSE = {
    "id": "cmpl-1",
    "model": "mistral-large-2411",
    "choices": [
        {"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
    ],
    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
}

CHUNKS = [
    {"data": {"choices": [{"delta": {"content": "o"}, "finish_reason": None}]}},
    {
        "data": {
            "id": "cmpl-1",
            "model": "mistral-large-2411",
            "choices": [{"delta": {"content": "k"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
    },
]


def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


def _complete_span_attributes(**overrides):
    tracer, exporter = _tracer_with_exporter()
    kwargs = {**REQUEST_KWARGS, **overrides}
    with tracer.start_as_current_span("chat") as span:
        process_chat_response(
            response=RESPONSE,
            request_model=kwargs["model"],
            pricing_info={},
            server_port=443,
            server_address="api.mistral.ai",
            environment="test",
            application_name="test",
            metrics=None,
            start_time=0.0,
            span=span,
            disable_metrics=True,
            **kwargs,
        )
    (finished,) = exporter.get_finished_spans()
    return finished.attributes


def _assert_request_params(attrs):
    assert attrs[SemanticConvention.GEN_AI_REQUEST_TOP_P] == 0.2
    assert tuple(attrs[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES]) == ("END",)
    assert attrs[SemanticConvention.GEN_AI_REQUEST_SEED] == 42
    assert SemanticConvention.GEN_AI_REQUEST_TOP_K not in attrs


def test_complete_records_mistral_request_params():
    _assert_request_params(_complete_span_attributes())


def test_stream_records_mistral_request_params():
    tracer, exporter = _tracer_with_exporter()
    wrapper = sync_mod.stream(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
        event_provider=None,
    )

    stream = wrapper(lambda *a, **k: iter(CHUNKS), None, (), dict(REQUEST_KWARGS))
    for _ in stream:
        pass

    (finished,) = exporter.get_finished_spans()
    _assert_request_params(finished.attributes)


def test_single_stop_string_is_recorded_as_one_sequence():
    attrs = _complete_span_attributes(stop="END")
    assert tuple(attrs[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES]) == ("END",)


def test_top_p_changes_agent_version_hash():
    low = _complete_span_attributes(top_p=0.2)
    high = _complete_span_attributes(top_p=0.9)
    assert (
        low[SemanticConvention.OPENLIT_AGENT_VERSION_HASH]
        != high[SemanticConvention.OPENLIT_AGENT_VERSION_HASH]
    )
