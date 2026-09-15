# pylint: disable=missing-function-docstring
"""Regression tests: streamed tool-call deltas must populate scope._tools.

Groq, AI21, and Together only assigned scope._tools on the non-streaming path.
process_chunk ignored delta.tool_calls (and AI21/Together skipped tool-only
deltas that had no content), so common_chat_logic never emitted tool span
attributes. These tests drive the real process_chunk helpers with synthetic
OpenAI-compatible chunks.

Fixes: https://github.com/openlit/openlit/issues/1540
"""

from types import SimpleNamespace

import pytest

from openlit.instrumentation.ai21 import utils as ai21_utils
from openlit.instrumentation.groq import utils as groq_utils
from openlit.instrumentation.together import utils as together_utils

PROVIDERS = [groq_utils, ai21_utils, together_utils]


def _scope():
    return SimpleNamespace(
        _timestamps=[],
        _start_time=0,
        _llmresponse="",
        _tools=None,
    )


@pytest.mark.parametrize("utils", PROVIDERS)
def test_streaming_tool_calls_are_accumulated(utils):
    scope = _scope()

    utils.process_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "lookup",
                                    "arguments": '{"q":"',
                                },
                            }
                        ]
                    }
                }
            ]
        },
    )
    utils.process_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "function": {"arguments": "weather"},
                            }
                        ]
                    }
                }
            ]
        },
    )

    assert scope._tools == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "lookup", "arguments": '{"q":"weather'},
        }
    ]


@pytest.mark.parametrize("utils", PROVIDERS)
def test_streaming_tool_calls_tolerate_null_arguments(utils):
    """OpenAI-compatible SDKs often send arguments=None on the first delta."""
    scope = _scope()

    utils.process_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "lookup", "arguments": None},
                            }
                        ]
                    }
                }
            ]
        },
    )
    utils.process_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "function": {"arguments": '{"q":"weather"}'},
                            }
                        ]
                    }
                }
            ]
        },
    )

    assert scope._tools[0]["function"]["name"] == "lookup"
    assert scope._tools[0]["function"]["arguments"] == '{"q":"weather"}'


@pytest.mark.parametrize("utils", PROVIDERS)
def test_streaming_parallel_tool_calls_use_index(utils):
    scope = _scope()

    utils.process_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "get_weather",
                                    "arguments": None,
                                },
                            },
                            {
                                "index": 1,
                                "id": "call_2",
                                "type": "function",
                                "function": {"name": "get_time", "arguments": ""},
                            },
                        ]
                    }
                }
            ]
        },
    )
    utils.process_chunk(
        scope,
        {
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "function": {"arguments": '{"city":"nyc"}'},
                            },
                            {
                                "index": 1,
                                "function": {"arguments": '{"tz":"UTC"}'},
                            },
                        ]
                    }
                }
            ]
        },
    )

    assert [tool["id"] for tool in scope._tools] == ["call_1", "call_2"]
    assert [tool["function"]["name"] for tool in scope._tools] == [
        "get_weather",
        "get_time",
    ]
    assert [tool["function"]["arguments"] for tool in scope._tools] == [
        '{"city":"nyc"}',
        '{"tz":"UTC"}',
    ]
