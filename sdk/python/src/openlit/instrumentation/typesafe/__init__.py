"""Initializer of Auto Instrumentation of TypeSafe System One."""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import _logs, trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.typesafe.typesafe import system_one
from openlit.instrumentation.typesafe.async_typesafe import async_system_one

logger = logging.getLogger(__name__)

_instruments = ("typesafe-sdk >= 0.6.0",)


def _safe_wrap(module, class_method, wrapper):
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except (ModuleNotFoundError, AttributeError):
        logger.debug(
            "Skipping %s.%s — not available in this typesafe-sdk version",
            module,
            class_method,
        )


class TypeSafeInstrumentor(BaseInstrumentor):
    """An instrumentor for the TypeSafe Python SDK."""

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
        try:
            version = importlib.metadata.version("typesafe-sdk")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        sync_wrapper = system_one(
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
        async_wrapper = async_system_one(
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

        _safe_wrap("typesafe_sdk", "TypeSafeClient.system_one", sync_wrapper)
        _safe_wrap("typesafe_sdk", "AsyncTypeSafeClient.system_one", async_wrapper)

    def _uninstrument(self, **kwargs):
        pass
