# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Together AI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.together.together import (
    completion, image_generate
)
from openlit.instrumentation.together.async_together import (
    async_completion, async_image_generate
)

_instruments = ("together >= 1.3.5",)

class TogetherInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Together's client library.
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
        version = importlib.metadata.version("together")

        # Chat completions
        wrap_function_wrapper(
            "together.resources.chat.completions",  
            "ChatCompletions.create",  
            completion("together.chat.completions", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # Image generate
        wrap_function_wrapper(
            "together.resources.images",  
            "Images.generate",  
            image_generate("together.image.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # Chat completions
        wrap_function_wrapper(
            "together.resources.chat.completions",  
            "AsyncChatCompletions.create",  
            async_completion("together.chat.completions", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # Image generate
        wrap_function_wrapper(
            "together.resources.images",  
            "AsyncImages.generate",  
            async_image_generate("together.image.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
