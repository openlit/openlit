# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Google AI Studio Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.google_ai_studio.google_ai_studio import (
    generate
)

from openlit.instrumentation.google_ai_studio.async_google_ai_studio import (
    async_generate
)

_instruments = ("google-genai >= 1.3.0",)

class GoogleAIStudioInstrumentor(BaseInstrumentor):
    """
    An instrumentor for google-genai's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("google-genai")

        # sync generate
        wrap_function_wrapper(
            "google.genai.models",
            "Models.generate_content",
            generate(version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # async generate
        wrap_function_wrapper(
            "google.genai.models",
            "AsyncModels.generate_content",
            async_generate(version, environment,
                           application_name, tracer, pricing_info, capture_message_content, metrics,
                           disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
