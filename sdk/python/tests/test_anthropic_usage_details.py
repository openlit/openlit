# pylint: disable=protected-access
"""
Server tool use and fallback models on Anthropic spans. These attributes must
match the TypeScript SDK. The tests drive the real `process_chunk` and
`process_chat_response` functions with synthetic API payloads, so they need no
credentials.
"""

import time
from types import SimpleNamespace

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit import with_tags, using_attributes
from openlit.__helpers import get_custom_attributes
from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic import utils as anthropic_utils
from openlit.semcov import SemanticConvention

REQUEST_KWARGS = {
    "model": "claude-requested",
    "messages": [{"role": "user", "content": "hi"}],
}
PRICING = {
    "chat": {
        "claude-requested": {"promptPrice": 1, "completionPrice": 2},
        "claude-fallback": {"promptPrice": 10, "completionPrice": 20},
    }
}
RESPONSE = {
    "id": "msg_01",
    "model": "claude-requested",
    "role": "assistant",
    "content": [{"type": "text", "text": "hello"}],
    "stop_reason": "end_turn",
}


def run_response(usage):
    """Finish a span through the non-streaming path and return its attributes."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    OpenlitConfig.disable_events = True
    OpenlitConfig.custom_span_attributes = None

    with provider.get_tracer(__name__).start_as_current_span("chat") as span:
        anthropic_utils.process_chat_response(
            response={**RESPONSE, "usage": usage},
            request_model="claude-requested",
            pricing_info=PRICING,
            server_port=443,
            server_address="api.anthropic.com",
            environment="test",
            application_name="app",
            metrics=None,
            start_time=time.time(),
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
            event_provider=None,
            **REQUEST_KWARGS,
        )
    return dict(exporter.get_finished_spans()[0].attributes)


def test_server_tool_use_is_recorded():
    """Web search and fetch counts land on the span."""
    attributes = run_response(
        {
            "input_tokens": 10,
            "output_tokens": 5,
            "server_tool_use": {"web_search_requests": 2, "web_fetch_requests": 1},
        }
    )

    assert attributes[SemanticConvention.ANTHROPIC_USAGE_WEB_SEARCH_REQUESTS] == 2
    assert attributes[SemanticConvention.ANTHROPIC_USAGE_WEB_FETCH_REQUESTS] == 1


def test_no_attributes_without_server_tools_or_fallback():
    """Absent details add no attributes."""
    attributes = run_response({"input_tokens": 10, "output_tokens": 5})

    assert SemanticConvention.ANTHROPIC_USAGE_WEB_SEARCH_REQUESTS not in attributes
    assert SemanticConvention.ANTHROPIC_RESPONSE_FALLBACK_MODEL not in attributes


def test_fallback_model_is_reported_and_priced():
    """The fallback that answered sets the model and the price."""
    attributes = run_response(
        {
            "input_tokens": 10,
            "output_tokens": 5,
            "iterations": [{"type": "fallback_message", "model": "claude-fallback"}],
        }
    )

    assert (
        attributes[SemanticConvention.ANTHROPIC_RESPONSE_FALLBACK_MODEL]
        == "claude-fallback"
    )
    assert attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] == "claude-fallback"
    assert attributes[SemanticConvention.GEN_AI_USAGE_COST] == (10 * 10 + 5 * 20) / 1000


def test_fallback_model_ignores_other_iterations():
    """Only `fallback_message` entries count."""
    usage = {"iterations": [{"type": "message", "model": "claude-other"}]}

    assert anthropic_utils.fallback_model(usage) is None
    assert anthropic_utils.fallback_model({}) is None


def test_streaming_captures_details_from_message_delta():
    """Streams report these in the closing `message_delta`."""
    scope = SimpleNamespace(_timestamps=[], _start_time=time.time(), _ttft=0)

    anthropic_utils.process_chunk(
        scope,
        {
            "type": "message_start",
            "message": {"id": "m", "model": "x", "role": "assistant", "usage": {}},
        },
    )
    anthropic_utils.process_chunk(
        scope,
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn"},
            "usage": {
                "output_tokens": 5,
                "server_tool_use": {"web_search_requests": 3},
                "iterations": [{"type": "fallback_message", "model": "claude-fallback"}],
            },
        },
    )

    assert scope._server_tool_use == {"web_search_requests": 3}
    assert scope._fallback_model == "claude-fallback"


def test_with_tags_sets_purpose_and_route():
    """Tags apply inside the block and are gone after it."""
    with with_tags(purpose="classification", route="gateway"):
        attributes = get_custom_attributes()

    assert attributes[SemanticConvention.OPENLIT_REQUEST_PURPOSE] == "classification"
    assert attributes[SemanticConvention.OPENLIT_ROUTE] == "gateway"
    assert get_custom_attributes() is None


def test_with_tags_keeps_enclosing_attributes():
    """An enclosing `using_attributes` survives, and is restored."""
    with using_attributes({"team": "ml"}):
        with with_tags(purpose="x"):
            attributes = get_custom_attributes()
        assert get_custom_attributes() == {"team": "ml"}

    assert attributes["team"] == "ml"
    assert attributes[SemanticConvention.OPENLIT_REQUEST_PURPOSE] == "x"
