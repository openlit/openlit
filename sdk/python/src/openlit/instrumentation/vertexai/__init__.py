# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of VertexAI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.vertexai.vertexai import (
    generate_content, predict, predict_streaming,
    send_message, start_chat, start_chat_streaming,
    embeddings
)
from openlit.instrumentation.vertexai.async_vertexai import (
    generate_content_async, predict_async,
    predict_streaming_async,
    send_message_async,
    start_chat_async, start_chat_streaming_async,
    embeddings_async
)


_instruments = ("google-cloud-aiplatform >= 1.38.1",)

class VertexAIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for VertexAI's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("google-cloud-aiplatform")

        #sync
        wrap_function_wrapper(
            "vertexai.generative_models",
            "GenerativeModel.generate_content",
            generate_content("vertexai.generate_content", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.generative_models",
            "ChatSession.send_message",
            send_message("vertexai.send_message", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",  
            "TextGenerationModel.predict",  
            predict("vertexai.predict", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "TextGenerationModel.predict_streaming",
            predict_streaming("vertexai.predict", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message",
            start_chat("vertexai.send_message", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message_streaming",
            start_chat_streaming("vertexai.send_message", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "TextEmbeddingModel.get_embeddings",
            embeddings("vertexai.get_embeddings", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        #async
        wrap_function_wrapper(
            "vertexai.generative_models",
            "GenerativeModel.generate_content_async",
            generate_content_async("vertexai.generate_content", version, environment,
                                   application_name, tracer, pricing_info, trace_content,
                                   metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.generative_models",
            "ChatSession.send_message_async",
            send_message_async("vertexai.send_message", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "TextGenerationModel.predict_async",
            predict_async("vertexai.predict", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "TextGenerationModel.predict_streaming_async",
            predict_streaming_async("vertexai.predict", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message_async",
            start_chat_async("vertexai.send_message", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message_streaming_async",
            start_chat_streaming_async("vertexai.send_message", version, environment,
                                       application_name, tracer, pricing_info, trace_content,
                                       metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "TextEmbeddingModel.get_embeddings_async",
            embeddings_async("vertexai.get_embeddings", version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
