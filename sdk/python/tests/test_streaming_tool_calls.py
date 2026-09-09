from types import SimpleNamespace

import pytest

from openlit.instrumentation.ai21 import utils as ai21_utils
from openlit.instrumentation.groq import utils as groq_utils
from openlit.instrumentation.together import utils as together_utils


@pytest.mark.parametrize("utils", [groq_utils, ai21_utils, together_utils])
def test_streaming_tool_calls_are_accumulated(utils):
    scope = SimpleNamespace(
        _timestamps=[],
        _start_time=0,
        _llmresponse="",
        _tools=None,
    )

    utils.process_chunk(scope, {"choices": [{"delta": {
        "tool_calls": [{
            "index": 0,
            "id": "call_1",
            "type": "function",
            "function": {"name": "lookup", "arguments": '{"q":"'},
        }],
    }}]})
    utils.process_chunk(scope, {"choices": [{"delta": {
        "tool_calls": [{
            "index": 0,
            "function": {"arguments": "weather"},
        }],
    }}]})

    assert scope._tools == [{
        "id": "call_1",
        "type": "function",
        "function": {"name": "lookup", "arguments": '{"q":"weather'},
    }]
