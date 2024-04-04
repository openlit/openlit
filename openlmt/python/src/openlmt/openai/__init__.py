from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from .openai import init as init_openai
from .async_openai import init as init_async_openai


_instruments = ("openai >= 0.3.11",)

class OpenAIInstrumentor(BaseInstrumentor):
    """An instrumentor for OpenAI's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments
    
    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")

        init_openai(llm, environment, application_name, tracer, pricing_info)
        return
    
    @staticmethod
    def _uninstrument(self, **kwargs):
        pass

class AsyncOpenAIInstrumentor(BaseInstrumentor):
    """An instrumentor for Async OpenAI's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments
    
    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")


        init_async_openai(llm, environment, application_name, tracer, pricing_info)
        return
    
    @staticmethod
    def _uninstrument(self, **kwargs):
        pass