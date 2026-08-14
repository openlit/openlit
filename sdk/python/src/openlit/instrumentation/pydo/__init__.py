"""Initializer of Auto Instrumentation of DigitalOcean pydo Functions"""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import _logs, trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.pydo.pydo import (
    chat_completions,
    embeddings,
    responses_create,
    messages_create,
    agent_chat_completions,
    async_invoke_create,
    list_models,
)
from openlit.instrumentation.pydo.async_pydo import (
    async_chat_completions,
    async_embeddings,
    async_responses_create,
    async_messages_create,
    async_agent_chat_completions,
    async_async_invoke_create,
    async_list_models,
)

_instruments = ("pydo >= 0.10.0",)

logger = logging.getLogger(__name__)


def _standard_args(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider,
):
    return (
        version,
        environment,
        application_name,
        tracer,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
        event_provider,
    )


def _safe_wrap(module, class_method, wrapper):
    """Wrap a function, silently skipping if the module/class is missing."""
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except (ModuleNotFoundError, AttributeError):
        logger.debug(
            "Skipping %s.%s — not available in this pydo version",
            module,
            class_method,
        )


class PydoInstrumentor(BaseInstrumentor):
    """An instrumentor for the DigitalOcean pydo client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("pydo")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)

        sa = _standard_args(
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
            event_provider,
        )

        # Wrap the facade methods. Pydo's facades take flat kwargs and route to
        # `self._client.inference.create_*(body, ...)` — the streaming dispatch
        # is monkey-patched onto the operations *instance*, so wrapping the
        # raw class method is effectively dead (the instance attribute wins
        # at lookup). The facade is the only reliable hook point for both
        # streaming and non-streaming traffic.
        _safe_wrap(
            "pydo.resources.inference.chat.completions",
            "Completions.create",
            chat_completions(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.inference.chat.completions",
            "Completions.create",
            async_chat_completions(*sa),
        )

        _safe_wrap(
            "pydo.resources.inference.embeddings",
            "Embeddings.create",
            embeddings(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.inference.embeddings",
            "Embeddings.create",
            async_embeddings(*sa),
        )

        _safe_wrap(
            "pydo.resources.inference.responses",
            "Responses.create",
            responses_create(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.inference.responses",
            "Responses.create",
            async_responses_create(*sa),
        )

        _safe_wrap(
            "pydo.resources.inference.messages",
            "Messages.create",
            messages_create(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.inference.messages",
            "Messages.create",
            async_messages_create(*sa),
        )

        _safe_wrap(
            "pydo.resources.agent_inference.chat.completions",
            "Completions.create",
            agent_chat_completions(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.agent_inference.chat.completions",
            "Completions.create",
            async_agent_chat_completions(*sa),
        )

        # Async-invoke (queued image/audio/video generation)
        _safe_wrap(
            "pydo.resources.inference.async_invoke",
            "AsyncInvoke.create",
            async_invoke_create(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.inference.async_invoke",
            "AsyncInvoke.create",
            async_async_invoke_create(*sa),
        )

        # Models list (metadata)
        _safe_wrap(
            "pydo.resources.inference.models",
            "Models.list",
            list_models(*sa),
        )
        _safe_wrap(
            "pydo.resources.aio.inference.models",
            "Models.list",
            async_list_models(*sa),
        )

    def _uninstrument(self, **kwargs):
        pass
