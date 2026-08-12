# pylint: disable=protected-access
"""
Regression tests: tool_calls is a *list* (OpenAI-compatible responses), not a single dict.

Before the fix, the groq, ai21, together, and reka instrumentors set
``scope._tools`` to the full list of tool_calls the provider returned, then
called ``.get()`` on it as if it were a single dict.  Any response containing
a tool call therefore raised ``AttributeError: 'list' object has no attribute
'get'`` inside ``process_chat_response``, which was silently swallowed by the
outer ``except Exception`` handler so the LLM call still returned—but the span
was marked ERROR and every tool/token/cost attribute was dropped.

The together instrumentor had a second bug: the name retrieval was accidentally
chained onto the return value of ``span.set_attribute`` (which is ``None``),
so ``.get("name", "")`` raised ``AttributeError: 'NoneType' object has no
attribute 'get'`` unconditionally even with a single-dict ``scope._tools``.

These tests call the real ``process_chat_response`` functions with synthetic
payloads and assert that:
  * no exception is raised (the old code raised AttributeError),
  * ``gen_ai.tool.name`` / ``gen_ai.tool.call.id`` / ``gen_ai.tool.args`` are
    set and correct for both a single call and two parallel calls.

Fixes: https://github.com/openlit/openlit/issues/1438
"""

import time

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from openlit._config import OpenlitConfig
from openlit.semcov import SemanticConvention
from openlit.instrumentation.groq import utils as groq_utils
from openlit.instrumentation.ai21 import utils as ai21_utils
from openlit.instrumentation.together import utils as together_utils
from openlit.instrumentation.reka import utils as reka_utils


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _tracer_with_exporter():
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer(__name__), exporter


_COMMON_KWARGS = dict(
    request_model="test-model",
    pricing_info={},
    server_port=443,
    server_address="api.example.com",
    environment="test",
    application_name="regression-test",
    metrics=None,
    start_time=time.time(),
    capture_message_content=False,
    disable_metrics=True,
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# OpenAI-compatible response helpers (groq, ai21, together)
# ---------------------------------------------------------------------------

def _openai_response(tool_calls):
    """Build a minimal OpenAI-schema response with the given tool_calls list."""
    return {
        "id": "resp-1",
        "model": "test-model",
        "choices": [
            {
                "message": {
                    "content": "",
                    "tool_calls": tool_calls,
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 3},
    }


_SINGLE_TOOL_CALL = [
    {"id": "call_1", "function": {"name": "get_weather", "arguments": '{"city": "nyc"}'}}
]

_PARALLEL_TOOL_CALLS = [
    {"id": "call_1", "function": {"name": "get_weather", "arguments": '{"city": "nyc"}'}},
    {"id": "call_2", "function": {"name": "get_weather", "arguments": '{"city": "sf"}'}},
]


def _run_openai_compat(utils_module, tool_calls, **extra_kwargs):
    tracer, exporter = _tracer_with_exporter()
    response = _openai_response(tool_calls)
    with tracer.start_as_current_span("llm.chat") as span:
        utils_module.process_chat_response(
            response=response,
            span=span,
            tools=[{"type": "function"}],
            messages=[{"role": "user", "content": "test"}],
            **_COMMON_KWARGS,
            **extra_kwargs,
        )
    return exporter.get_finished_spans()[0]


# ---------------------------------------------------------------------------
# Reka response helper
# ---------------------------------------------------------------------------

def _reka_response(tool_calls):
    """Build a minimal Reka-schema response with the given tool_calls list."""
    return {
        "id": "resp-r1",
        "model": "reka-core",
        "responses": [
            {
                "message": {
                    "content": "",
                    "tool_calls": tool_calls,
                },
                "finish_reason": "tool_calls",
            }
        ],
        "usage": {"input_tokens": 5, "output_tokens": 3},
    }


_REKA_SINGLE_TOOL_CALL = [
    {"id": "rcall_1", "name": "get_weather", "parameters": '{"city": "nyc"}'}
]

_REKA_PARALLEL_TOOL_CALLS = [
    {"id": "rcall_1", "name": "get_weather", "parameters": '{"city": "nyc"}'},
    {"id": "rcall_2", "name": "get_time", "parameters": '{"tz": "UTC"}'},
]


def _run_reka(tool_calls):
    tracer, exporter = _tracer_with_exporter()
    response = _reka_response(tool_calls)
    with tracer.start_as_current_span("reka.chat") as span:
        reka_utils.process_chat_response(
            response=response,
            span=span,
            tools=[{"type": "function"}],
            messages=[{"role": "user", "content": "test"}],
            **_COMMON_KWARGS,
        )
    return exporter.get_finished_spans()[0]


# ===========================================================================
# groq tests
# ===========================================================================

def test_groq_single_tool_call_does_not_raise():
    """A single tool call must not cause AttributeError (was: list.get() fails)."""
    span = _run_openai_compat(groq_utils, _SINGLE_TOOL_CALL)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "nyc"}'


def test_groq_parallel_tool_calls_are_joined():
    """Two parallel tool calls must both be captured as comma-joined attributes."""
    span = _run_openai_compat(groq_utils, _PARALLEL_TOOL_CALLS)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1, call_2"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == (
        '{"city": "nyc"}, {"city": "sf"}'
    )


def test_groq_no_tool_calls_skips_tool_attrs():
    """When no tools are passed, tool span attributes must be absent."""
    tracer, exporter = _tracer_with_exporter()
    response = _openai_response([])
    response["choices"][0]["message"]["tool_calls"] = None
    response["choices"][0]["finish_reason"] = "stop"
    with tracer.start_as_current_span("groq.chat") as span:
        groq_utils.process_chat_response(
            response=response,
            span=span,
            messages=[{"role": "user", "content": "test"}],
            **_COMMON_KWARGS,
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert SemanticConvention.GEN_AI_TOOL_NAME not in attrs


# ===========================================================================
# ai21 tests
# ===========================================================================

def test_ai21_single_tool_call_does_not_raise():
    """ai21: single tool call must not raise AttributeError."""
    span = _run_openai_compat(ai21_utils, _SINGLE_TOOL_CALL)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "nyc"}'


def test_ai21_parallel_tool_calls_are_joined():
    """ai21: parallel tool calls are comma-joined in span attributes."""
    span = _run_openai_compat(ai21_utils, _PARALLEL_TOOL_CALLS)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1, call_2"


# ===========================================================================
# together tests
# ===========================================================================

def test_together_single_tool_call_does_not_raise():
    """together: single tool call must not raise (had two bugs: list.get + None.get)."""
    span = _run_openai_compat(together_utils, _SINGLE_TOOL_CALL)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "nyc"}'


def test_together_parallel_tool_calls_are_joined():
    """together: parallel tool calls are captured and comma-joined."""
    span = _run_openai_compat(together_utils, _PARALLEL_TOOL_CALLS)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "call_1, call_2"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == (
        '{"city": "nyc"}, {"city": "sf"}'
    )


# ===========================================================================
# reka tests
# ===========================================================================

def test_reka_single_tool_call_does_not_raise():
    """reka: single tool call must not raise (Reka uses name/id/parameters fields)."""
    span = _run_reka(_REKA_SINGLE_TOOL_CALL)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "rcall_1"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == '{"city": "nyc"}'


def test_reka_parallel_tool_calls_are_joined():
    """reka: parallel tool calls (different names) are comma-joined."""
    span = _run_reka(_REKA_PARALLEL_TOOL_CALLS)
    attrs = span.attributes
    assert attrs[SemanticConvention.GEN_AI_TOOL_NAME] == "get_weather, get_time"
    assert attrs[SemanticConvention.GEN_AI_TOOL_CALL_ID] == "rcall_1, rcall_2"
    assert attrs[SemanticConvention.GEN_AI_TOOL_ARGS] == (
        '{"city": "nyc"}, {"tz": "UTC"}'
    )
