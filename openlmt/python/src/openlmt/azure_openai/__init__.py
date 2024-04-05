# pylint: disable=useless-return, bad-staticmethod-argument
"""Initializer of Auto Instrumentation of Azure OpenAI Functions"""
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from .azure_openai import init as init_azure_openai
from .async_azure_openai import init as init_async_azure_openai

_instruments = ("openai >= 0.3.11",)

class AzureOpenAIInstrumentor(BaseInstrumentor):
    """An instrumentor for Azure OpenAI's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")

        init_azure_openai(llm, environment, application_name, tracer, pricing_info)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass

class AsyncAzureOpenAIInstrumentor(BaseInstrumentor):
    """An instrumentor for Azure OpenAI's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")

        init_async_azure_openai(llm, environment, application_name, tracer, pricing_info)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
