from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from .mistral import init as init_mistral
from .async_mistral import init as init_async_mistral

_instruments = ("mistralai >= 0.1.0",)

class MistralInstrumentor(BaseInstrumentor):
    """An instrumentor for Azure Mistral's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")

        init_mistral(llm, environment, application_name, tracer, pricing_info)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass

class AsyncMistralInstrumentor(BaseInstrumentor):
    """An instrumentor for Azure AsyncMistral's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")

        init_async_mistral(llm, environment, application_name, tracer, pricing_info)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
