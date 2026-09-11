"""Initializer of Auto Instrumentation of Mistral Functions"""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import _logs
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper
from wrapt.exceptions import TargetModuleNotFoundError

from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral.mistral import complete, stream, embed
from openlit.instrumentation.mistral.async_mistral import (
    async_complete,
    async_stream,
    async_embed,
)

_instruments = ("mistralai >= 1.0.0",)

logger = logging.getLogger(__name__)

_CHAT_MODULES = ("mistralai.chat", "mistralai.client.chat")
_EMBEDDINGS_MODULES = ("mistralai.embeddings", "mistralai.client.embeddings")


def _safe_wrap(module, class_method, wrapper):
    """Wrap a function, skipping SDK module layouts that are not installed."""
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except (ModuleNotFoundError, TargetModuleNotFoundError, AttributeError):
        logger.debug(
            "Skipping %s.%s — not available in this mistralai version",
            module,
            class_method,
        )


class MistralInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Mistral client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = trace.get_tracer(__name__)
        metrics = OpenlitConfig.metrics_dict
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)
        version = importlib.metadata.version("mistralai")

        for chat_module in _CHAT_MODULES:
            # sync chat completions
            _safe_wrap(
                chat_module,
                "Chat.complete",
                complete(
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    event_provider,
                ),
            )

            # sync chat streaming
            _safe_wrap(
                chat_module,
                "Chat.stream",
                stream(
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    event_provider,
                ),
            )

            # async chat completions
            _safe_wrap(
                chat_module,
                "Chat.complete_async",
                async_complete(
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    event_provider,
                ),
            )

            # async chat streaming
            _safe_wrap(
                chat_module,
                "Chat.stream_async",
                async_stream(
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    event_provider,
                ),
            )

        for embeddings_module in _EMBEDDINGS_MODULES:
            # sync embeddings
            _safe_wrap(
                embeddings_module,
                "Embeddings.create",
                embed(
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # async embeddings
            _safe_wrap(
                embeddings_module,
                "Embeddings.create_async",
                async_embed(
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

    def _uninstrument(self, **kwargs):
        pass
