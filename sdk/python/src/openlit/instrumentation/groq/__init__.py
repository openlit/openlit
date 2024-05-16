# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Groq Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.groq.groq import chat
from openlit.instrumentation.groq.async_groq import async_chat

_instruments = ("groq >= 0.5.0",)

class GroqInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Groq's client library.
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
        version = importlib.metadata.version("groq")

        #sync
        wrap_function_wrapper(
            "groq.resources.chat.completions",  
            "Completions.create",  
            chat("groq.chat.completions", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #async
        wrap_function_wrapper(
            "groq.resources.chat.completions",  
            "AsyncCompletions.create",  
            async_chat("groq.chat.completions", version, environment, application_name,
                            tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
