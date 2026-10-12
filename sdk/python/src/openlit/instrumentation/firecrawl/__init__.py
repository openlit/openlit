"""
Initializer of Auto Instrumentation of Firecrawl Functions.
Supports comprehensive Firecrawl API operations with enhanced business intelligence.
"""

import logging
from typing import Collection
import importlib.metadata
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.firecrawl.firecrawl import general_wrap
from openlit.instrumentation.firecrawl.async_firecrawl import async_general_wrap

logger = logging.getLogger(__name__)

# The SDK is published as "firecrawl-py" and, with the same code, as "firecrawl".
_DISTRIBUTIONS = ("firecrawl-py", "firecrawl")
_MIN_VERSION = "1.6.3"
_instruments = (f"firecrawl-py >= {_MIN_VERSION}",)

# v1 clients. firecrawl-py < 3 keeps them in firecrawl.firecrawl, 3.x and later
# in firecrawl.v1.client under a V1 prefix.
_V1_SYNC_METHODS = (
    ("scrape_url", "firecrawl.scrape_url"),
    ("crawl_url", "firecrawl.crawl_url"),
    ("map_url", "firecrawl.map_url"),
    ("search", "firecrawl.search"),
    ("extract", "firecrawl.extract"),
    ("batch_scrape_urls", "firecrawl.batch_scrape_urls"),
    ("check_crawl_status", "firecrawl.get_crawl_status"),
)
_V1_ASYNC_METHODS = (
    ("scrape_url", "firecrawl.async_scrape_url"),
    ("async_crawl_url", "firecrawl.async_crawl_url"),
    ("async_extract", "firecrawl.async_extract"),
    ("async_batch_scrape_urls", "firecrawl.async_batch_scrape_urls"),
    ("search", "firecrawl.async_search"),
    ("map_url", "firecrawl.async_map_url"),
)
_V1_CLIENTS = (
    ("firecrawl.firecrawl", "FirecrawlApp", "AsyncFirecrawlApp"),
    ("firecrawl.v1.client", "V1FirecrawlApp", "AsyncV1FirecrawlApp"),
)

# v2 clients (firecrawl-py >= 3). Firecrawl, AsyncFirecrawl and the
# FirecrawlApp alias delegate to these, as do the legacy *_url helpers.
# Methods missing from a given release are skipped.
_V2_METHODS = (
    "scrape",
    "search",
    "crawl",
    "start_crawl",
    "get_crawl_status",
    "wait_crawl",
    "map",
    "batch_scrape",
    "start_batch_scrape",
    "get_batch_scrape_status",
    "extract",
)
# Only the async v2 client has wait_batch_scrape.
_V2_ASYNC_ONLY_METHODS = ("wait_batch_scrape",)
_V2_SYNC_CLIENT = ("firecrawl.v2.client", "FirecrawlClient")
_V2_ASYNC_CLIENT = ("firecrawl.v2.client_async", "AsyncFirecrawlClient")


def _installed_distribution():
    """Return the name of the installed Firecrawl SDK distribution, if any."""
    for distribution in _DISTRIBUTIONS:
        try:
            importlib.metadata.version(distribution)
            return distribution
        except importlib.metadata.PackageNotFoundError:
            continue
    return None


def _safe_wrap(module, class_method, wrapper):
    """Wrap a method, skipping SDK layouts that are not installed."""
    try:
        wrap_function_wrapper(module, class_method, wrapper)
    except (ImportError, AttributeError):
        logger.debug(
            "Skipping %s.%s - not available in this firecrawl version",
            module,
            class_method,
        )


class FireCrawlInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Firecrawl's client library.
    Supports comprehensive Firecrawl API operations including scraping, crawling, searching, and mapping.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        # BaseInstrumentor requires every listed distribution, so declare
        # whichever of firecrawl-py / firecrawl is installed.
        distribution = _installed_distribution()
        if distribution:
            return (f"{distribution} >= {_MIN_VERSION}",)
        return _instruments

    def _instrument(self, **kwargs):
        """Instrument the firecrawl-py library functions."""
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info")
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version(
            _installed_distribution() or _DISTRIBUTIONS[0]
        )
        metrics = kwargs.get("metrics")

        def wrapper_args(endpoint):
            return (
                endpoint,
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        for module, sync_class, async_class in _V1_CLIENTS:
            for method, endpoint in _V1_SYNC_METHODS:
                _safe_wrap(
                    module,
                    f"{sync_class}.{method}",
                    general_wrap(*wrapper_args(endpoint)),
                )
            for method, endpoint in _V1_ASYNC_METHODS:
                _safe_wrap(
                    module,
                    f"{async_class}.{method}",
                    async_general_wrap(*wrapper_args(endpoint)),
                )

        module, sync_class = _V2_SYNC_CLIENT
        for method in _V2_METHODS:
            _safe_wrap(
                module,
                f"{sync_class}.{method}",
                general_wrap(*wrapper_args(f"firecrawl.{method}")),
            )

        module, async_class = _V2_ASYNC_CLIENT
        for method in _V2_METHODS + _V2_ASYNC_ONLY_METHODS:
            _safe_wrap(
                module,
                f"{async_class}.{method}",
                async_general_wrap(*wrapper_args(f"firecrawl.async_{method}")),
            )

    def _uninstrument(self, **kwargs):
        pass
