# pylint: disable=protected-access, missing-function-docstring
"""Regression tests: a streamed Anthropic response must keep the prompt-cache
counts reported at `message_start`.

`process_chunk` read `cache_creation_input_tokens` and `cache_read_input_tokens`
from `message_start`, then reassigned both at `message_delta` with a `0`
default. The comment above that line said "when present"; the code assigned
unconditionally, so a `message_delta` carrying only `output_tokens` — which is
what the Anthropic API sends — reset both counters to zero. Every streamed call
therefore reported no cache reads and no cache writes, and the cost calculation
lost the cache discount with them.

The Go SDK in this repository already does it the other way:
`sdk/go/instrumentation/anthropic/streaming.go` takes the cache counts at
`message_start` and its `message_delta` case reads only `StopReason` and
`OutputTokens` (#1462, merged 2026-08-16).

These tests drive the real `process_chunk` with anthropic-shaped events.
"""

from openlit.instrumentation.anthropic.utils import process_chunk


# pylint: disable=too-many-instance-attributes, too-few-public-methods
class _Scope:
    """Minimal stand-in for the streaming wrapper's scope object.

    It mirrors the attributes `process_chunk` reads and writes, so the count
    is the wrapper's, not this test's.
    """

    def __init__(self):
        self._timestamps = []
        self._start_time = 0.0
        self._ttft = 0
        self._response_id = ""
        self._response_model = ""
        self._response_role = ""
        self._input_tokens = 0
        self._output_tokens = 0
        self._cache_creation_input_tokens = 0
        self._cache_read_input_tokens = 0
        self._finish_reason = ""
        self._llmresponse = ""
        self._tool_calls_by_index = None


MESSAGE_START = {
    "type": "message_start",
    "message": {
        "id": "msg_01",
        "model": "claude-3-5-sonnet-latest",
        "role": "assistant",
        "usage": {
            "input_tokens": 10,
            "cache_creation_input_tokens": 1024,
            "cache_read_input_tokens": 2048,
        },
    },
}

# What the API actually sends: final usage with output_tokens and no cache keys.
MESSAGE_DELTA_WITHOUT_CACHE = {
    "type": "message_delta",
    "delta": {"stop_reason": "end_turn"},
    "usage": {"output_tokens": 25},
}


def test_a_delta_without_cache_keys_keeps_the_message_start_counts():
    scope = _Scope()
    process_chunk(scope, MESSAGE_START)
    assert scope._cache_creation_input_tokens == 1024
    assert scope._cache_read_input_tokens == 2048

    process_chunk(scope, MESSAGE_DELTA_WITHOUT_CACHE)

    # Before the fix both fell to zero here and the cache discount was lost.
    assert scope._cache_creation_input_tokens == 1024
    assert scope._cache_read_input_tokens == 2048
    # The fields message_delta does own must still be taken from it.
    assert scope._output_tokens == 25
    assert scope._finish_reason == "end_turn"


def test_a_delta_that_does_report_cache_counts_still_wins():
    """`is not None` must not become "ignore the delta"."""
    scope = _Scope()
    process_chunk(scope, MESSAGE_START)

    process_chunk(
        scope,
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn"},
            "usage": {
                "output_tokens": 25,
                "cache_creation_input_tokens": 4096,
                "cache_read_input_tokens": 8192,
            },
        },
    )

    assert scope._cache_creation_input_tokens == 4096
    assert scope._cache_read_input_tokens == 8192


def test_an_explicit_zero_in_the_delta_is_honoured():
    """A reported zero is a value, not an absence."""
    scope = _Scope()
    process_chunk(scope, MESSAGE_START)

    process_chunk(
        scope,
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn"},
            "usage": {
                "output_tokens": 25,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
        },
    )

    assert scope._cache_creation_input_tokens == 0
    assert scope._cache_read_input_tokens == 0


def test_no_cache_anywhere_stays_zero():
    scope = _Scope()
    process_chunk(
        scope,
        {
            "type": "message_start",
            "message": {
                "id": "msg_02",
                "model": "claude-3-5-sonnet-latest",
                "role": "assistant",
                "usage": {"input_tokens": 10},
            },
        },
    )
    process_chunk(scope, MESSAGE_DELTA_WITHOUT_CACHE)

    assert scope._cache_creation_input_tokens == 0
    assert scope._cache_read_input_tokens == 0
