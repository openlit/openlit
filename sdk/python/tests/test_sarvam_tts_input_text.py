"""Tests that the Sarvam text-to-speech span uses the request text.

``TextToSpeechClient.convert`` takes the text to speak as ``text`` (keyword-only,
in every sarvamai release). It must end up in the span's input messages and in
the character-based cost.
"""

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from openlit._config import OpenlitConfig
from openlit.instrumentation.sarvam import utils as sarvam_utils
from openlit.instrumentation.sarvam.sarvam import text_to_speech_convert
from openlit.semcov import SemanticConvention

TEXT = "नमस्ते, आप कैसे हैं?"


class _TtsResponse:  # pylint: disable=too-few-public-methods
    """Minimal stand-in for sarvamai's TextToSpeechResponse."""

    request_id = "req-1"
    audios = ["UklGRg=="]

    def model_dump(self):
        """Serialize like a pydantic model."""
        return {"request_id": self.request_id, "audios": self.audios}


def _convert(pricing_info, disable_metrics, max_content_length=None):
    OpenlitConfig.reset_to_defaults()
    if max_content_length is not None:
        OpenlitConfig.max_content_length = max_content_length
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    wrapper = text_to_speech_convert(
        version="test-version",
        environment="test-env",
        application_name="test-app",
        tracer=provider.get_tracer("test-sarvam-tts"),
        pricing_info=pricing_info,
        capture_message_content=True,
        metrics={},
        disable_metrics=disable_metrics,
    )
    wrapper(
        lambda *a, **k: _TtsResponse(),
        None,
        (),
        {"text": TEXT, "language_code": "hi-IN", "model": "bulbul:v2"},
    )
    (span,) = exporter.get_finished_spans()
    return span


def test_tts_span_captures_the_request_text():
    """The text passed as ``text`` is the span's input message."""
    span = _convert(pricing_info={}, disable_metrics=True)
    assert span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] == TEXT


def test_tts_cost_is_computed_from_the_request_text(monkeypatch):
    """The per-character cost is computed from ``text``, not an empty string."""
    recorded = []
    monkeypatch.setattr(
        sarvam_utils,
        "record_audio_metrics",
        lambda **kwargs: recorded.append(kwargs["cost"]),
    )

    _convert(pricing_info={"audio": {"bulbul:v2": 2.0}}, disable_metrics=False)

    assert recorded == [len(TEXT) / 1000 * 2.0]

def test_tts_span_respects_max_content_length():
    """Captured TTS text is truncated when the configured limit is positive."""
    span = _convert(pricing_info={}, disable_metrics=True, max_content_length=5)
    assert span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] == TEXT[:5] + "..."
