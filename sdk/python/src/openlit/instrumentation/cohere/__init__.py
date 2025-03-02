# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Cohere Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.cohere.cohere import chat, chat_stream, embed
from openlit.instrumentation.cohere.async_cohere import async_chat, async_chat_stream, async_embed


_instruments = ("cohere >= 5.14.0",)

class CohereInstrumentor(BaseInstrumentor):
    """An instrumentor for Cohere's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("cohere")

        # Sync Client
        wrap_function_wrapper(
            "cohere.client_v2",  
            "ClientV2.chat",  
            chat(version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "cohere.client_v2",  
            "ClientV2.chat_stream",  
            chat_stream(version, environment, application_name,
                        tracer, pricing_info, trace_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "cohere.client_v2",  
            "ClientV2.embed",  
            embed(version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # Async Client
        wrap_function_wrapper(
            "cohere.client_v2",  
            "AsyncClientV2.chat",  
            async_chat(version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "cohere.client_v2",  
            "AsyncClientV2.chat_stream",  
            async_chat_stream(version, environment, application_name,
                        tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "cohere.client_v2",  
            "AsyncClientV2.embed",  
            async_embed(version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
