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

_instruments = ("google-generativeai >= 0.2.0",)

class GoogleAIStudioInstrumentor(BaseInstrumentor):
    """
    An instrumentor for google-generativeai's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("google-generativeai")

        # sync generate
        wrap_function_wrapper(
            "google.generativeai.generative_models",
            "GenerativeModel.generate_content",
            generate("google_ai_studio.generate_content", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # async generate
        wrap_function_wrapper(
            "google.generativeai.generative_models",
            "GenerativeModel.generate_content_async",
            async_generate("google_ai_studio.generate_content", version, environment,
                           application_name, tracer, pricing_info, trace_content, metrics,
                           disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
