# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Crawl4AI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.crawl4ai.crawl4ai import (
    wrap_crawl
)
from openlit.instrumentation.crawl4ai.async_crawl4ai import (
    async_wrap_crawl
)

_instruments = ("crawl4ai >= 0.4.0",)

class Crawl4AIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for crawl4ai's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("crawl4ai")

        wrap_function_wrapper(
            "crawl4ai.web_crawler",
            "WebCrawler.run",
            wrap_crawl("crawl4ai.web_crawl", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "crawl4ai.async_webcrawler",
            "AsyncWebCrawler.arun",
            async_wrap_crawl("crawl4ai.web_crawl", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
