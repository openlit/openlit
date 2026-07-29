# pylint: disable=missing-function-docstring, protected-access
"""
Unit tests for parallel ``function_call`` handling in the Gemini instrumentation.

Gemini returns one part per function call, so a turn with parallel calls arrives
as sibling ``function_call`` parts, optionally split across streamed chunks.
Both paths used to read ``parts[0]`` only:

* non-streaming -- a second or third ``function_call`` part was never read.
* streaming -- the ``parts[0]`` read was assigned straight into ``scope._tools``
  on every chunk, so a later chunk overwrote the calls collected before it.

These tests need no API key: they drive ``process_chunk`` and
``build_output_messages`` directly, the same way the report for issue #1400 did.
"""

import json

from openlit.instrumentation.google_ai_studio import utils


class _Scope:  # pylint: disable=too-few-public-methods
    """Minimal stand-in for the streaming scope ``process_chunk`` mutates."""

    def __init__(self):
        self._timestamps = []
        self._start_time = 0
        self._llmresponse = ""
        self._tools = None
        self._response_model = None
        self._finish_reason = ""

    def collected(self):
        return list(self._tools or [])


def _fc_chunk(*cities):
    return {
        "model_version": "gemini-2.0-flash",
        "candidates": [
            {
                "finish_reason": "STOP",
                "content": {
                    "parts": [
                        {"function_call": {"name": "get_weather", "args": {"city": city}}}
                        for city in cities
                    ]
                },
            }
        ],
    }


def test_non_streaming_reads_every_function_call_part():
    parts = _fc_chunk("nyc", "sf")["candidates"][0]["content"]["parts"]

    calls = utils._function_calls(parts)

    assert [call["args"]["city"] for call in calls] == ["nyc", "sf"]


def test_streaming_accumulates_calls_split_across_chunks():
    scope = _Scope()

    utils.process_chunk(scope, _fc_chunk("nyc"))
    utils.process_chunk(scope, _fc_chunk("sf"))

    assert [call["args"]["city"] for call in scope.collected()] == ["nyc", "sf"]


def test_streaming_keeps_parallel_calls_within_one_chunk():
    scope = _Scope()

    utils.process_chunk(scope, _fc_chunk("nyc", "sf"))

    assert [call["args"]["city"] for call in scope.collected()] == ["nyc", "sf"]


def test_streaming_text_chunk_does_not_clobber_collected_calls():
    scope = _Scope()

    utils.process_chunk(scope, _fc_chunk("nyc"))
    utils.process_chunk(
        scope, {"candidates": [{"content": {"parts": [{"text": "done"}]}}]}
    )

    assert [call["args"]["city"] for call in scope.collected()] == ["nyc"]


def test_output_messages_carry_one_part_per_call():
    calls = utils._function_calls(_fc_chunk("nyc", "sf")["candidates"][0]["content"]["parts"])

    parts = utils.build_output_messages("", "STOP", calls)[0]["parts"]
    tool_calls = [part for part in parts if part["type"] == "tool_call"]

    assert [part["arguments"] for part in tool_calls] == [{"city": "nyc"}, {"city": "sf"}]
    assert json.dumps(tool_calls)  # parts stay JSON-serialisable


def test_output_messages_accepts_a_single_dict():
    # The pre-existing shape must keep working for any caller still passing one call.
    parts = utils.build_output_messages("hi", "STOP", {"name": "n", "args": {"a": 1}})[0][
        "parts"
    ]

    assert [part["type"] for part in parts] == ["text", "tool_call"]
    assert parts[1]["name"] == "n"


def test_function_calls_handles_object_shaped_parts():
    class _Part:  # pylint: disable=too-few-public-methods
        def __init__(self, call):
            self.function_call = call

    calls = utils._function_calls([_Part({"name": "n", "args": {}}), _Part(None)])

    assert calls == [{"name": "n", "args": {}}]
