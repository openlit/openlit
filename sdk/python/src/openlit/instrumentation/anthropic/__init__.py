"""Initializer of Auto Instrumentation of Anthropic Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry import trace, _logs
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.anthropic.anthropic import messages
from openlit.instrumentation.anthropic.async_anthropic import async_messages

_instruments = ("anthropic >= 0.21.0",)


class AnthropicInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Anthropic's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("anthropic")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)

        # sync
        wrap_function_wrapper(
            "anthropic.resources.messages",
            "Messages.create",
            messages(
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

        # async
        wrap_function_wrapper(
            "anthropic.resources.messages",
            "AsyncMessages.create",
            async_messages(
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

    def _uninstrument(self, **kwargs):
        pass
