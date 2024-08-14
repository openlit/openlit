# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of ElevenLabs Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.elevenlabs.elevenlabs import (
    generate
)
from openlit.instrumentation.elevenlabs.async_elevenlabs import (
    async_generate
)

_instruments = ("elevenlabs >= 1.4.0",)

class ElevenLabsInstrumentor(BaseInstrumentor):
    """
    An instrumentor for ElevenLabs's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("elevenlabs")

        # sync generate
        wrap_function_wrapper(
            "elevenlabs.client",
            "ElevenLabs.generate",
            generate("elevenlabs.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # sync text_to_speech.convert
        wrap_function_wrapper(
            "elevenlabs.text_to_speech.client",
            "TextToSpeechClient.convert",
            generate("elevenlabs.text_to_speech", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # async generate
        wrap_function_wrapper(
            "elevenlabs.client",
            "AsyncElevenLabs.generate",
            async_generate("elevenlabs.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # sync text_to_speech.convert
        wrap_function_wrapper(
            "elevenlabs.text_to_speech.client",
            "AsyncTextToSpeechClient.convert",
            generate("elevenlabs.text_to_speech", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
