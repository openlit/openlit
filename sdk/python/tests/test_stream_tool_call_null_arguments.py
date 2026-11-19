# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: an OpenAI-compatible stream can send a tool call delta
whose ``arguments`` is null (the name arrives first, or a later delta carries
only an id). ``process_chunk`` must keep the call instead of raising
``TypeError`` into the caller's own ``for chunk in stream`` loop.
"""

import time
from types import SimpleNamespace

import pytest

from openlit.instrumentation.azure_ai_inference import utils as azure_utils
from openlit.instrumentation.litellm import utils as litellm_utils
from openlit.instrumentation.mistral import utils as mistral_utils


def _scope():
    return SimpleNamespace(
        _timestamps=[],
        _start_time=time.time(),
        _llmresponse="",
        _tools=None,
        _input_tokens=0,
        _output_tokens=0,
        _response_id="",
        _response_model="",
        _finish_reason="",
        _end_time=None,
        _reasoning_content="",
        _reasoning="",
        _response_service_tier="",
        _response_system_fingerprint="",
    )


def _chunk(tool_calls, wrap):
    body = {
        "id": "chunk-1",
        "model": "m",
        "choices": [{"index": 0, "delta": {"content": None, "tool_calls": tool_calls}}],
    }
    return {"data": body} if wrap else body


MODULES = [
    pytest.param(azure_utils, False, id="azure_ai_inference"),
    pytest.param(litellm_utils, False, id="litellm"),
    pytest.param(mistral_utils, True, id="mistral"),
]


@pytest.mark.parametrize("utils,wrap", MODULES)
def test_null_arguments_on_first_delta_are_joined_with_later_ones(utils, wrap):
    scope = _scope()
    first = [{"index": 0, "id": "call_1", "function": {"name": "f", "arguments": None}}]
    second = [{"index": 0, "function": {"arguments": '{"a": 1}'}}]

    utils.process_chunk(scope, _chunk(first, wrap))
    utils.process_chunk(scope, _chunk(second, wrap))

    assert scope._tools == [
        {"id": "call_1", "function": {"name": "f", "arguments": '{"a": 1}'}, "type": "function"}
    ]


@pytest.mark.parametrize("utils,wrap", MODULES)
def test_null_arguments_on_continuation_delta_are_ignored(utils, wrap):
    scope = _scope()
    first = [{"index": 0, "id": "call_1", "function": {"name": "f", "arguments": '{"a"'}}]
    second = [{"index": 0, "function": {"arguments": None}}]
    third = [{"index": 0, "function": {"arguments": ": 1}"}}]

    for delta in (first, second, third):
        utils.process_chunk(scope, _chunk(delta, wrap))

    assert scope._tools[0]["function"]["arguments"] == '{"a": 1}'
