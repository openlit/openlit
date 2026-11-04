"""Tests that the Sarvam text-to-speech span records the request language.

``TextToSpeechClient.convert`` takes ``language_code`` since sarvamai 0.1.29
(earlier releases took ``target_language_code``). Both spellings must end up in
``gen_ai.request.tts.target_language_code``.
"""

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.sarvam.sarvam import text_to_speech_convert
from openlit.semcov import SemanticConvention


class _TtsResponse:  # pylint: disable=too-few-public-methods
    """Minimal stand-in for sarvamai's TextToSpeechResponse."""

    request_id = "req-1"
    audios = ["UklGRg=="]

    def model_dump(self):
        return {"request_id": self.request_id, "audios": self.audios}


def _span_for(**kwargs):
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    wrapper = text_to_speech_convert(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=provider.get_tracer("test-sarvam-tts"),
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )
    wrapper(lambda *a, **k: _TtsResponse(), None, (), {"text": "नमस्ते", **kwargs})
    (span,) = exporter.get_finished_spans()
    return span


@pytest.mark.parametrize("key", ["language_code", "target_language_code"])
def test_tts_span_records_request_language(key):
    """Both the current and the pre-0.1.29 keyword are recorded."""
    span = _span_for(**{key: "hi-IN"})
    assert (
        span.attributes[SemanticConvention.GEN_AI_REQUEST_TTS_TARGET_LANGUAGE_CODE]
        == "hi-IN"
    )
