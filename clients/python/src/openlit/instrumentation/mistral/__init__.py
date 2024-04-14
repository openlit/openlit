# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Mistral Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.mistral.mistral import chat, chat_stream, embeddings
from openlit.instrumentation.mistral.async_mistral import async_chat, async_chat_stream
from openlit.instrumentation.mistral.async_mistral import async_embeddings

_instruments = ("mistralai >= 0.1.0",)

class MistralInstrumentor(BaseInstrumentor):
    """An instrumentor for Azure Mistral's client library."""

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
        version = importlib.metadata.version("mistralai")

        #sync
        wrap_function_wrapper(
            "mistralai.client",  
            "MistralClient.chat",  
            chat("mistral.chat", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.client",  
            "MistralClient.chat_stream",  
            chat_stream("mistral.chat", version, environment, application_name,
                        tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.client",  
            "MistralClient.embeddings",  
            embeddings("mistral.embeddings", version, environment, application_name,
                       tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # Async
        wrap_function_wrapper(
            "mistralai.async_client",  
            "MistralAsyncClient.chat",  
            async_chat("mistral.chat", version, environment, application_name,
                       tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.async_client",  
            "MistralAsyncClient.chat_stream",  
            async_chat_stream("mistral.chat", version, environment, application_name,
                              tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.async_client",  
            "MistralAsyncClient.embeddings",  
            async_embeddings("mistral.embeddings", version, environment, application_name,
                             tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
