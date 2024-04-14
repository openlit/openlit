# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Anthropic Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.anthropic.anthropic import messages
from openlit.instrumentation.anthropic.async_anthropic import async_messages

_instruments = ("anthropic >= 0.21.0",)

class AnthropicInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Anthropic's client library.
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
        version = importlib.metadata.version("anthropic")

        #sync
        wrap_function_wrapper(
            "anthropic.resources.messages",  
            "Messages.create",  
            messages("anthropic.messages", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #async
        wrap_function_wrapper(
            "anthropic.resources.messages",  
            "AsyncMessages.create",  
            async_messages("anthropic.messages", version, environment, application_name,
                            tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
