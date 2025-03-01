# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of OpenAI Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.openai.openai import chat_completions, embedding
from openlit.instrumentation.openai.openai import image_generate, image_variatons, audio_create
from openlit.instrumentation.openai.async_openai import async_chat_completions, async_embedding
from openlit.instrumentation.openai.async_openai import async_image_generate, async_image_variatons
from openlit.instrumentation.openai.async_openai import async_audio_create

_instruments = ("openai >= 1.1.1",)

class OpenAIInstrumentor(BaseInstrumentor):
    """An instrumentor for OpenAI's client library."""

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
        version = importlib.metadata.version("openai")

        wrap_function_wrapper(
            "openai.resources.chat.completions",  
            "Completions.create",  
            chat_completions(version, environment, application_name,
                         tracer, pricing_info, trace_content,
                         metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.chat.completions",  
            "AsyncCompletions.create",  
            async_chat_completions(version, environment, application_name,
                               tracer, pricing_info, trace_content,
                               metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.images",  
            "Images.generate",  
            image_generate(version, environment, application_name,
                                   tracer, pricing_info, trace_content,
                                   metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.images",  
            "AsyncImages.generate",  
            async_image_generate(version, environment, application_name,
                                         tracer, pricing_info, trace_content,
                                         metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.embeddings",  
            "Embeddings.create",  
            embedding(version, environment, application_name,
                              tracer, pricing_info, trace_content,
                              metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.embeddings",  
            "AsyncEmbeddings.create",  
            async_embedding(version, environment, application_name,
                                    tracer, pricing_info, trace_content,
                                    metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.images",  
            "Images.create_variation",  
            image_variatons(version,
                            environment, application_name,
                            tracer, pricing_info, trace_content,
                            metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.images",  
            "AsyncImages.create_variation",  
            async_image_variatons(version,
                                  environment, application_name,
                                  tracer, pricing_info, trace_content,
                                  metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.audio.speech",  
            "Speech.create",  
            audio_create(version, environment, application_name,
                         tracer, pricing_info, trace_content,
                         metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "openai.resources.audio.speech",  
            "AsyncSpeech.create",  
            async_audio_create(version, environment, application_name,
                               tracer, pricing_info, trace_content,
                               metrics, disable_metrics),
        )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
