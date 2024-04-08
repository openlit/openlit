# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Anthropic Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from .anthropic import messages
from .async_anthropic import async_messages

_instruments = ("anthropic >= 0.21.0",)

class AnthropicInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Anthropic's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")  # Ensure llm object is used if necessary
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        version = importlib.metadata.version("anthropic")

        #sync
        wrap_function_wrapper(
            "anthropic.resources.messages",  
            "Messages.create",  
            messages("anthropic.messages", version, environment, application_name, tracer, pricing_info, trace_content),
        )

        #async
        wrap_function_wrapper(
            "anthropic.resources.messages",  
            "AsyncMessages.create",  
            async_messages("anthropic.messages", version, environment, application_name, tracer, pricing_info, trace_content),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
