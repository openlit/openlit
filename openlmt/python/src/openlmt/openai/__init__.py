# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of OpenAI Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from .openai import chatCompletions, embedding, finetune, imageGenerate, imageVariatons, audioCreate
from .async_openai import async_chatCompletions, async_embedding, async_finetune, async_imageGenerate, async_imageVariatons, async_audioCreate

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
        trace_content = kwargs.get("trace_content")
        version = importlib.metadata.version("openai")

        #sync
        wrap_function_wrapper(
            "openai.resources.chat.completions",  
            "Completions.create",  
            chatCompletions("azure_openai.chat.completions", version, environment, application_name, tracer, pricing_info, trace_content),
        )
        wrap_function_wrapper(
            "openai.resources.chat.completions",  
            "AsyncCompletions.create",  
            async_chatCompletions("azure_openai.chat.completions", version, environment, application_name, tracer, pricing_info, trace_content),
        )

        # #sync
        # wrap_function_wrapper(
        #     "openai",  
        #     "Completions.create",  
        #     completions("azure_openai.chat.completions", version, environment, application_name, tracer, pricing_info, trace_content),
        # )

        # #sync
        # wrap_function_wrapper(
        #     "openai",  
        #     "Images.generate",  
        #     imageGenerate("azure_openai.images.generate", version, environment, application_name, tracer, pricing_info, trace_content),
        # )

        # #sync
        # wrap_function_wrapper(
        #     "openai",  
        #     "Embeddings.create",  
        #     embedding("azure_openai.embeddings", version, environment, application_name, tracer, pricing_info, trace_content),
        # )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
