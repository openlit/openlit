"""
Initializer of Auto Instrumentation of Ollama Functions
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.ollama.ollama import (
    chat, embeddings
)
from openlit.instrumentation.ollama.async_ollama import (
    async_chat, async_embeddings
)

_instruments = ("ollama >= 0.2.0",)

class OllamaInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Ollama's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        event_provider = kwargs.get("event_provider")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("ollama")

        # sync chat
        wrap_function_wrapper(
            "ollama",
            "chat",
            chat(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "ollama",
            "Client.chat",
            chat(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # sync embeddings
        wrap_function_wrapper(
            "ollama",
            "embeddings",
            embeddings(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "ollama",
            "Client.embeddings",
            embeddings(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # async chat
        wrap_function_wrapper(
            "ollama",
            "AsyncClient.chat",
            async_chat(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # async embeddings
        wrap_function_wrapper(
            "ollama",
            "AsyncClient.embeddings",
            async_embeddings(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
