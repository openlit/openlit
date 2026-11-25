# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: a streamed Gradient chat completion must keep
`delta.reasoning_content`.

`process_chunk` read `delta.content` and `delta.tool_calls` but had no branch
for `delta.reasoning_content`, so `scope._reasoning_text` was only ever filled
from Responses-API `reasoning_text.delta` events. The output-message builder
already renders `scope._reasoning_text` as a reasoning part, so a streamed chat
call on a reasoning model always produced an empty one. The sibling `pydo`
instrumentation handles the same chat-completions delta.

These tests drive the real `process_chunk`, `process_chat_response` and
`process_streaming_chat_response` with chat-completions shaped chunks.
"""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from openlit._config import OpenlitConfig
from openlit.instrumentation.gradient.async_gradient import (
    async_agent_chat_completions,
)
from openlit.instrumentation.gradient.gradient import agent_chat_completions
from openlit.instrumentation.gradient.utils import (
    _new_scope,
    build_output_messages,
    process_chat_response,
    process_chunk,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention


# pylint: disable=too-many-instance-attributes, too-few-public-methods
class _Scope:
    """Minimal stand-in for the streaming wrapper's scope object.

    It mirrors the attributes `process_chunk` reads and writes.
    """

    def __init__(self):
        self._timestamps = []
        self._start_time = 0.0
        self._ttft = 0
        self._llmresponse = ""
        self._reasoning_text = ""
        self._response_id = ""
        self._response_model = ""
        self._finish_reason = ""
        self._input_tokens = 0
        self._output_tokens = 0
        self._tools = []


@pytest.fixture(autouse=True)
def _default_config():
    OpenlitConfig.reset_to_defaults()


def _chunk(**delta):
    return {
        "id": "chatcmpl-1",
        "model": "deepseek-r1",
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }


def _output_messages(span):
    for call in span.set_attribute.call_args_list:
        if call.args[0] == SemanticConvention.GEN_AI_OUTPUT_MESSAGES:
            return json.loads(call.args[1])
    raise AssertionError("gen_ai.output.messages was not set")


def _finalize(scope):
    process_streaming_chat_response(
        scope,
        pricing_info={},
        environment="test",
        application_name="test",
        metrics=None,
        capture_message_content=True,
        disable_metrics=True,
        version="0",
    )


def test_reasoning_content_deltas_accumulate_alongside_content():
    scope = _Scope()
    process_chunk(scope, _chunk(reasoning_content="step "))
    process_chunk(scope, _chunk(reasoning_content="one"))
    process_chunk(scope, _chunk(content="The "))
    process_chunk(scope, _chunk(content="answer"))

    assert scope._reasoning_text == "step one"
    assert scope._llmresponse == "The answer"


def test_reasoning_and_content_in_the_same_delta_are_both_kept():
    scope = _Scope()
    process_chunk(scope, _chunk(reasoning_content="think", content="say"))

    assert scope._reasoning_text == "think"
    assert scope._llmresponse == "say"


def test_a_null_or_missing_reasoning_content_is_ignored():
    scope = _Scope()
    process_chunk(scope, _chunk(reasoning_content="step "))
    process_chunk(scope, _chunk(reasoning_content=None, content="a"))
    process_chunk(scope, _chunk(content="b"))
    process_chunk(scope, _chunk(reasoning_content="", content="c"))
    process_chunk(scope, _chunk(reasoning_content="one"))

    assert scope._reasoning_text == "step one"
    assert scope._llmresponse == "abc"


def test_a_model_without_reasoning_keeps_an_empty_reasoning_text():
    scope = _Scope()
    process_chunk(scope, _chunk(content="plain"))

    assert scope._reasoning_text == ""
    assert scope._llmresponse == "plain"


def test_tool_call_assembly_is_unaffected_by_reasoning_deltas():
    scope = _Scope()
    process_chunk(scope, _chunk(reasoning_content="need a tool"))
    process_chunk(
        scope,
        _chunk(
            tool_calls=[
                {
                    "index": 0,
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "lookup", "arguments": '{"q":'},
                }
            ]
        ),
    )
    process_chunk(
        scope,
        _chunk(tool_calls=[{"index": 0, "function": {"arguments": ' "x"}'}}]),
    )

    assert scope._reasoning_text == "need a tool"
    assert scope._tools[0]["function"]["name"] == "lookup"
    assert scope._tools[0]["function"]["arguments"] == '{"q": "x"}'


def test_output_messages_put_the_reasoning_part_before_the_text_part():
    scope = _Scope()
    process_chunk(scope, _chunk(reasoning_content="step "))
    process_chunk(scope, _chunk(reasoning_content="one"))
    process_chunk(scope, _chunk(content="The answer"))

    messages = build_output_messages(
        scope._llmresponse,
        "stop",
        tool_calls=scope._tools,
        reasoning=scope._reasoning_text,
    )

    assert messages[0]["parts"] == [
        {"type": "reasoning", "content": "step one"},
        {"type": "text", "content": "The answer"},
    ]


def test_a_streamed_span_carries_the_reasoning_part():
    span = MagicMock()
    scope = _new_scope({"model": "deepseek-r1", "messages": []}, span, 0.0, "h", 443)
    process_chunk(scope, _chunk(reasoning_content="step "))
    process_chunk(scope, _chunk(reasoning_content="one"))
    process_chunk(scope, _chunk(content="The answer"))

    _finalize(scope)

    assert _output_messages(span)[0]["parts"] == [
        {"type": "reasoning", "content": "step one"},
        {"type": "text", "content": "The answer"},
    ]


def test_a_non_streamed_span_carries_the_reasoning_part():
    span = MagicMock()
    response = {
        "id": "chatcmpl-1",
        "model": "deepseek-r1",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "The answer",
                    "reasoning_content": "step one",
                },
            }
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5},
    }

    process_chat_response(
        response,
        {"model": "deepseek-r1", "messages": []},
        {},
        "h",
        443,
        "test",
        "test",
        None,
        0.0,
        span,
        True,
        True,
        "0",
    )

    assert _output_messages(span)[0]["parts"] == [
        {"type": "reasoning", "content": "step one"},
        {"type": "text", "content": "The answer"},
    ]


_NON_STRING_REASONING = [
    pytest.param({"text": "x"}, id="dict"),
    pytest.param(["x"], id="list"),
    pytest.param(5, id="int"),
    pytest.param(True, id="bool"),
]


@pytest.mark.parametrize("bad", _NON_STRING_REASONING)
def test_a_non_string_streamed_reasoning_content_is_ignored(bad):
    scope = _Scope()
    process_chunk(scope, _chunk(reasoning_content="step "))
    process_chunk(scope, _chunk(reasoning_content=bad, content="a"))
    process_chunk(scope, _chunk(reasoning_content="one", content="b"))

    assert scope._reasoning_text == "step one"
    assert scope._llmresponse == "ab"


def _chat_response(reasoning):
    return {
        "id": "chatcmpl-1",
        "model": "deepseek-r1",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "The answer",
                    "reasoning_content": reasoning,
                },
            }
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5},
    }


@pytest.mark.parametrize("bad", _NON_STRING_REASONING)
def test_a_non_string_non_streamed_reasoning_content_is_ignored(bad):
    span = MagicMock()

    process_chat_response(
        _chat_response(bad),
        {"model": "deepseek-r1", "messages": []},
        {},
        "h",
        443,
        "test",
        "test",
        None,
        0.0,
        span,
        True,
        True,
        "0",
    )

    assert _output_messages(span)[0]["parts"] == [
        {"type": "text", "content": "The answer"},
    ]


def _agent_wrapper(factory):
    tracer = MagicMock()
    span = tracer.start_as_current_span.return_value.__enter__.return_value
    wrapper = factory(
        "0",
        "test",
        "test",
        tracer,
        {},
        True,
        None,
        True,
    )
    return wrapper, span


def _expected_agent_parts(reasoning):
    parts = [{"type": "text", "content": "The answer"}]
    if reasoning:
        parts.insert(0, {"type": "reasoning", "content": reasoning})
    return parts


@pytest.mark.parametrize(
    "reasoning",
    ["step one", None, 5, {"text": "x"}],
    ids=["string", "missing", "int", "dict"],
)
def test_the_sync_agent_span_carries_the_reasoning_part(reasoning):
    wrapper, span = _agent_wrapper(agent_chat_completions)
    response = _chat_response(reasoning)

    result = wrapper(
        lambda *args, **kwargs: response,
        SimpleNamespace(),
        (),
        {"model": "deepseek-r1", "messages": []},
    )

    assert result is response
    assert _output_messages(span)[0]["parts"] == _expected_agent_parts(
        reasoning if isinstance(reasoning, str) else None
    )


@pytest.mark.parametrize(
    "reasoning",
    ["step one", None, 5, {"text": "x"}],
    ids=["string", "missing", "int", "dict"],
)
def test_the_async_agent_span_carries_the_reasoning_part(reasoning):
    wrapper, span = _agent_wrapper(async_agent_chat_completions)
    response = _chat_response(reasoning)

    async def wrapped(*args, **kwargs):
        return response

    result = asyncio.run(
        wrapper(
            wrapped,
            SimpleNamespace(),
            (),
            {"model": "deepseek-r1", "messages": []},
        )
    )

    assert result is response
    assert _output_messages(span)[0]["parts"] == _expected_agent_parts(
        reasoning if isinstance(reasoning, str) else None
    )
