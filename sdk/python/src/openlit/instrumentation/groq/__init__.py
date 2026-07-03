"""Initializer of Auto Instrumentation of Groq Functions"""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import _logs, trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.groq.groq import (
    chat,
    audio_create,
    audio_transcription,
    audio_translation,
)
from openlit.instrumentation.groq.async_groq import (
    async_chat,
    async_audio_create,
    async_audio_transcription,
    async_audio_translation,
)

logger = logging.getLogger(__name__)

_instruments = ("groq >= 0.5.0",)


def _safe_wrap(module, class_method, wrapper):
    """Wrap a function, silently skipping if the module doesn't exist in this SDK version."""
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except ModuleNotFoundError:
        logger.debug(
            "Skipping %s.%s — module not in this groq version", module, class_method
        )


class GroqInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Groq client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = trace.get_tracer(__name__)
        metrics = OpenlitConfig.metrics_dict
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)
        version = importlib.metadata.version("groq")

        # Chat completions
        wrap_function_wrapper(
            "groq.resources.chat.completions",
            "Completions.create",
            chat(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Chat completions
        wrap_function_wrapper(
            "groq.resources.chat.completions",
            "AsyncCompletions.create",
            async_chat(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Audio speech (text-to-speech)
        _safe_wrap(
            "groq.resources.audio.speech",
            "Speech.create",
            audio_create(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Audio speech (text-to-speech)
        _safe_wrap(
            "groq.resources.audio.speech",
            "AsyncSpeech.create",
            async_audio_create(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Audio transcriptions (speech-to-text)
        _safe_wrap(
            "groq.resources.audio.transcriptions",
            "Transcriptions.create",
            audio_transcription(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Audio transcriptions (speech-to-text)
        _safe_wrap(
            "groq.resources.audio.transcriptions",
            "AsyncTranscriptions.create",
            async_audio_transcription(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Audio translations (speech-to-text)
        _safe_wrap(
            "groq.resources.audio.translations",
            "Translations.create",
            audio_translation(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # Audio translations (speech-to-text)
        _safe_wrap(
            "groq.resources.audio.translations",
            "AsyncTranslations.create",
            async_audio_translation(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

    def _uninstrument(self, **kwargs):
        pass
