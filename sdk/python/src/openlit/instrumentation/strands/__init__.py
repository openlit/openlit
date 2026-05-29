"""OpenLIT Strands Agents Instrumentation.

Uses a SpanProcessor to enrich Strands' native OTel spans with OpenLIT
attributes, content capture, inference log events, and metrics --
without any monkey-patching.
"""

import contextlib
import importlib.metadata
import logging
from typing import Collection

from opentelemetry import _logs, trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor

from openlit._config import OpenlitConfig
from openlit.instrumentation.strands.processor import StrandsSpanProcessor

logger = logging.getLogger(__name__)

_instruments = ("strands-agents >= 0.1.0",)


class StrandsInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic-convention compliant instrumentor for Strands Agents."""

    def __init__(self):
        super().__init__()
        self._processor = None

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        try:
            version = importlib.metadata.version("strands-agents")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)
        pricing_info = kwargs.get("pricing_info")

        self._processor = StrandsSpanProcessor(
            version=version,
            environment=environment,
            application_name=application_name,
            capture_message_content=capture_message_content,
            metrics=metrics,
            disable_metrics=disable_metrics,
            event_provider=event_provider,
            pricing_info=pricing_info,
        )

        provider = trace.get_tracer_provider()
        multi = getattr(provider, "_active_span_processor", None)
        if multi and hasattr(multi, "_span_processors"):
            with getattr(multi, "_lock", contextlib.nullcontext()):
                multi._span_processors = (self._processor,) + multi._span_processors
        elif hasattr(provider, "add_span_processor"):
            provider.add_span_processor(self._processor)
        else:
            logger.warning(
                "TracerProvider does not support add_span_processor; "
                "Strands instrumentation will not be active."
            )

    def _uninstrument(self, **kwargs):
        if self._processor is not None:
            try:
                self._processor.shutdown()
            except Exception:
                pass
            self._processor = None
