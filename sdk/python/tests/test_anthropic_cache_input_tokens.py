# pylint: disable=protected-access, missing-function-docstring, too-few-public-methods
"""Regression test: Anthropic span `gen_ai.usage.input_tokens` must include
prompt-cache read and creation tokens.

Anthropic reports `usage.input_tokens` exclusive of cached tokens. The OTel
GenAI semantic conventions require `gen_ai.usage.input_tokens` to be
`input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; the
cache attributes themselves stay separate and the cost calculation keeps its
own raw/cache split, so only the reported input count changes.

`common_chat_logic` is the shared finalizer for both the streaming and
non-streaming Anthropic paths, so driving it covers both.
"""

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic.utils import common_chat_logic
from openlit.semcov import SemanticConvention


class _FakeSpan:
    def __init__(self):
        self.attrs = {}

    def set_attribute(self, key, value):
        self.attrs[key] = value

    def set_status(self, _status):
        pass


class _FakeEventProvider:
    def __init__(self) -> None:
        self.emitted: list = []

    def emit(self, event) -> None:
        self.emitted.append(event)


class _Scope:
    def __init__(self):
        self._timestamps = []
        self._start_time = 0.0
        self._end_time = 0.0
        self._tbt = 0
        self._ttft = 0
        self._server_address = "api.anthropic.com"
        self._server_port = 443
        self._response_model = "claude-3-5-sonnet-latest"
        self._response_id = ""
        self._finish_reason = "end_turn"
        self._llmresponse = "hello"
        self._kwargs = {"messages": [{"role": "user", "content": "hi"}],
                        "model": "claude-3-5-sonnet-latest"}
        self._input_tokens = 0
        self._output_tokens = 0
        self._cache_read_input_tokens = 0
        self._cache_creation_input_tokens = 0


def _finalize(scope, span):
    OpenlitConfig.reset_to_defaults()
    scope._span = span
    common_chat_logic(
        scope,
        pricing_info={},
        environment=None,
        application_name="",
        metrics=None,
        capture_message_content=False,
        disable_metrics=True,
        version="",
        is_stream=False,
        event_provider=None,
    )


def test_input_tokens_include_cache_read_and_creation():
    scope = _Scope()
    scope._input_tokens = 128
    scope._output_tokens = 10
    scope._cache_read_input_tokens = 64
    scope._cache_creation_input_tokens = 32
    span = _FakeSpan()

    _finalize(scope, span)

    assert span.attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 224
    assert span.attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 234
    # Cache attributes stay reported on their own, unchanged.
    assert span.attrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] == 64
    assert span.attrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] == 32


def test_no_cache_stays_on_raw_input_tokens():
    scope = _Scope()
    scope._input_tokens = 128
    scope._output_tokens = 10
    span = _FakeSpan()

    _finalize(scope, span)

    assert span.attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 128
    assert span.attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 138


def test_event_input_tokens_match_span_cache_inclusive_total():
    """The inference event must agree with the span on gen_ai.usage.input_tokens."""
    scope = _Scope()
    scope._input_tokens = 128
    scope._output_tokens = 10
    scope._cache_read_input_tokens = 64
    scope._cache_creation_input_tokens = 32
    span = _FakeSpan()
    provider = _FakeEventProvider()

    OpenlitConfig.reset_to_defaults()
    scope._span = span
    common_chat_logic(
        scope,
        pricing_info={},
        environment=None,
        application_name="",
        metrics=None,
        capture_message_content=False,
        disable_metrics=True,
        version="",
        is_stream=False,
        event_provider=provider,
    )

    assert len(provider.emitted) == 1
    event = provider.emitted[0]
    assert event.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 224
    assert event.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 10
    # Raw count stays recoverable from the separate cache keys.
    assert event.attributes[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] == 64
    assert event.attributes[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] == 32
