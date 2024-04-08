# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Anthropic Functions"""

from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from .anthropic import init as init_anthropic
from .async_anthropic import init as init_async_anthropic

_instruments = ("anthropic >= 0.3.11",)

class AnthropicInstrumentor(BaseInstrumentor):
    """An instrumentor for Anthropic's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")

        init_anthropic(llm, environment, application_name, tracer, pricing_info, trace_content)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass

class AsyncAnthropicInstrumentor(BaseInstrumentor):
    """An instrumentor for Async Anthropic's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")

        init_async_anthropic(llm, environment, application_name, tracer, pricing_info, trace_content)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
