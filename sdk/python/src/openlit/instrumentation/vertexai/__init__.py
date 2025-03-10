# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of VertexAI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.vertexai.vertexai import (
    send_message
)
from openlit.instrumentation.vertexai.async_vertexai import (
    async_send_message
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
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("google-cloud-aiplatform")

        #sync
        wrap_function_wrapper(
            "vertexai.generative_models",
            "GenerativeModel.generate_content",
            send_message(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.generative_models",
            "ChatSession.send_message",
            send_message(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message",
            send_message(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message_streaming",
            send_message(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        #async
        wrap_function_wrapper(
            "vertexai.generative_models",
            "GenerativeModel.generate_content_async",
            async_send_message(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.generative_models",
            "ChatSession.send_message_async",
            async_send_message(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message_async",
            async_send_message(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "vertexai.language_models",
            "ChatSession.send_message_streaming_async",
            async_send_message(version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
