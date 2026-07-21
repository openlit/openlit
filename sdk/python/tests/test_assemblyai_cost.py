# pylint: disable=missing-function-docstring, missing-class-docstring, too-few-public-methods, protected-access
"""
Unit tests for AssemblyAI transcription cost calculation.

AssemblyAI pricing is per second of audio, so the cost recorded by
``common_audio_logic`` must be derived from ``audio_duration`` and must not
vary with the length of the ``audio_url`` string.
"""

import pytest

from openlit import OpenlitConfig
from openlit.instrumentation.assemblyai.utils import common_audio_logic
from openlit.semcov import SemanticConvention


PRICING = {"audio": {"best": 0.00010277777, "nano": 3.333333e-05}}


@pytest.fixture(autouse=True)
def _reset_config():
    """common_audio_logic reads global config normally populated by openlit.init()."""
    OpenlitConfig.reset_to_defaults()


class _Span:
    def __init__(self):
        self.attributes = {}

    def set_attribute(self, key, value):
        self.attributes[key] = value

    def set_status(self, status):
        pass

    def add_event(self, *args, **kwargs):
        pass


class _Response:
    def __init__(self, audio_url, audio_duration):
        self.audio_url = audio_url
        self.audio_duration = audio_duration
        self.id = "transcript-id"
        self.text = "transcribed text"


def _run(audio_url, audio_duration, speech_model="best", capture_message_content=False):
    scope = type("GenericScope", (), {})()
    scope._span = _Span()
    scope._start_time = 0.0
    scope._end_time = 1.0
    scope._tbt = 0.0
    scope._ttft = 1.0
    scope._server_address, scope._server_port = "api.assemblyai.com", 443
    scope._kwargs = {"speech_model": speech_model}
    scope._response = _Response(audio_url, audio_duration)
    scope._response_model = speech_model

    common_audio_logic(
        scope,
        PRICING,
        "test-environment",
        "test-application",
        None,
        capture_message_content,
        True,
        "1.0.0",
        False,
    )
    return scope._span.attributes


def _cost(*args, **kwargs):
    return _run(*args, **kwargs)[SemanticConvention.GEN_AI_USAGE_COST]


class TestAssemblyAICost:
    def test_cost_derived_from_duration(self):
        cost = _cost("https://cdn.assemblyai.com/upload/abc", 7200)
        assert cost == pytest.approx(7200 * PRICING["audio"]["best"], rel=1e-9)

    def test_cost_independent_of_audio_url_length(self):
        short_url = _cost("https://a.co/x", 600)
        long_url = _cost("https://cdn.example.com/upload/" + "q" * 200, 600)
        assert short_url == long_url

    def test_nano_model_rate(self):
        cost = _cost("https://cdn.assemblyai.com/upload/abc", 600, speech_model="nano")
        assert cost == pytest.approx(600 * PRICING["audio"]["nano"], rel=1e-9)

    def test_unknown_model_returns_zero(self):
        assert (
            _cost("https://cdn.assemblyai.com/upload/abc", 600, speech_model="x") == 0
        )

    def test_audio_url_still_recorded_as_input_content(self):
        audio_url = "https://cdn.assemblyai.com/upload/abc"
        attributes = _run(audio_url, 600, capture_message_content=True)
        assert audio_url in attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]
        assert attributes[SemanticConvention.GEN_AI_USAGE_COST] == pytest.approx(
            600 * PRICING["audio"]["best"], rel=1e-9
        )
