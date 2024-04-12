# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Mistral Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlmt.mistral.mistral import chat, chat_stream, embeddings
from openlmt.mistral.async_mistral import async_chat, async_chat_stream, async_embeddings

_instruments = ("mistralai >= 0.1.0",)

class MistralInstrumentor(BaseInstrumentor):
    """An instrumentor for Azure Mistral's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        version = importlib.metadata.version("mistralai")

        #sync
        wrap_function_wrapper(
            "mistralai.client",  
            "MistralClient.chat",  
            chat("mistral.chat", version, environment, application_name,
                 tracer, pricing_info, trace_content),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.client",  
            "MistralClient.chat_stream",  
            chat_stream("mistral.chat", version, environment, application_name,
                        tracer, pricing_info, trace_content),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.client",  
            "MistralClient.embeddings",  
            embeddings("mistral.embeddings", version, environment, application_name,
                       tracer, pricing_info, trace_content),
        )

        # Async
        wrap_function_wrapper(
            "mistralai.async_client",  
            "MistralAsyncClient.chat",  
            async_chat("mistral.chat", version, environment, application_name,
                       tracer, pricing_info, trace_content),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.async_client",  
            "MistralAsyncClient.chat_stream",  
            async_chat_stream("mistral.chat", version, environment, application_name,
                              tracer, pricing_info, trace_content),
        )

        #sync
        wrap_function_wrapper(
            "mistralai.async_client",  
            "MistralAsyncClient.embeddings",  
            async_embeddings("mistral.embeddings", version, environment, application_name,
                             tracer, pricing_info, trace_content),
        )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
