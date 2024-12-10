# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of FireCrawl Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.firecrawl.firecrawl import (
    wrap_crawl
)

_instruments = ("firecrawl-py >= 1.6.3",)

class FireCrawlInstrumentor(BaseInstrumentor):
    """
    An instrumentor for firecrawl's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("firecrawl-py")

        wrap_function_wrapper(
            "firecrawl.firecrawl",
            "FirecrawlApp.scrape_url",
            wrap_crawl("firecrawl.scrape_url", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "firecrawl.firecrawl",
            "FirecrawlApp.crawl_url",
            wrap_crawl("firecrawl.crawl_url", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
