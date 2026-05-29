"""Initializer of Auto Instrumentation of DigitalOcean Gradient SDK Functions"""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import _logs, trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.gradient.gradient import (
    chat_completions,
    responses_create,
    image_generate,
    agent_chat_completions,
    retrieve_documents,
)
from openlit.instrumentation.gradient.async_gradient import (
    async_chat_completions,
    async_responses_create,
    async_image_generate,
    async_agent_chat_completions,
    async_retrieve_documents,
)

_instruments = ("gradient >= 3.0.0",)

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
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except (ModuleNotFoundError, AttributeError):
        logger.debug(
            "Skipping %s.%s — not available in this gradient version",
            module,
            class_method,
        )


class GradientInstrumentor(BaseInstrumentor):
    """An instrumentor for the DigitalOcean Gradient SDK."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("gradient")
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

        # Chat completions
        _safe_wrap(
            "gradient.resources.chat.completions",
            "CompletionsResource.create",
            chat_completions(*sa),
        )
        _safe_wrap(
            "gradient.resources.chat.completions",
            "AsyncCompletionsResource.create",
            async_chat_completions(*sa),
        )

        # Responses API
        _safe_wrap(
            "gradient.resources.responses",
            "ResponsesResource.create",
            responses_create(*sa),
        )
        _safe_wrap(
            "gradient.resources.responses",
            "AsyncResponsesResource.create",
            async_responses_create(*sa),
        )

        # Image generation
        _safe_wrap(
            "gradient.resources.images",
            "ImagesResource.generate",
            image_generate(*sa),
        )
        _safe_wrap(
            "gradient.resources.images",
            "AsyncImagesResource.generate",
            async_image_generate(*sa),
        )

        # Agent chat completions
        _safe_wrap(
            "gradient.resources.agents.chat.completions",
            "CompletionsResource.create",
            agent_chat_completions(*sa),
        )
        _safe_wrap(
            "gradient.resources.agents.chat.completions",
            "AsyncCompletionsResource.create",
            async_agent_chat_completions(*sa),
        )

        # Knowledge-base retrieval (RAG)
        _safe_wrap(
            "gradient.resources.retrieve",
            "RetrieveResource.documents",
            retrieve_documents(*sa),
        )
        _safe_wrap(
            "gradient.resources.retrieve",
            "AsyncRetrieveResource.documents",
            async_retrieve_documents(*sa),
        )

    def _uninstrument(self, **kwargs):
        pass
