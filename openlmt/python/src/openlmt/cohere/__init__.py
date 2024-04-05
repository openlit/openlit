# pylint: disable=useless-return, bad-staticmethod-argument
"""Initializer of Auto Instrumentation of Cohere Functions"""
from typing import Collection

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from .cohere import init as init_cohere

_instruments = ("cohere >= 5.0.0",)

class CohereInstrumentor(BaseInstrumentor):
    """An instrumentor for Cohere's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        llm = kwargs.get("llm")
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")

        init_cohere(llm, environment, application_name, tracer, pricing_info)
        return

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
