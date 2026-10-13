"""
Initializer of Auto Instrumentation of Firecrawl Functions.
Supports comprehensive Firecrawl API operations with enhanced business intelligence.
"""

from typing import Collection
import importlib.metadata

from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.firecrawl.firecrawl import general_wrap
from openlit.instrumentation.firecrawl.async_firecrawl import async_general_wrap

# The firecrawl SDK is published on PyPI under two distribution names:
# ``firecrawl-py`` (the canonical name its docs install) and ``firecrawl``
# (an alias publishing the same releases). Exactly one of them is installed
# in a given environment, so the dependency declaration reports whichever
# one is present instead of requiring both.
_FIRECRAWL_DISTRIBUTIONS = ("firecrawl-py", "firecrawl")

# Oldest SDK version the instrumentor supports.
_FIRECRAWL_MIN_VERSION = "1.6.3"


def _installed_firecrawl_distribution():
    """Return the name of the firecrawl distribution installed in this environment.

    Falls back to the canonical ``firecrawl-py`` when neither distribution is
    installed so the OpenTelemetry dependency check reports a truthful
    requirement instead of silently passing.
    """
    for distribution in _FIRECRAWL_DISTRIBUTIONS:
        try:
            importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            continue
        return distribution
    return _FIRECRAWL_DISTRIBUTIONS[0]


# (module, target, span endpoint) triples.
#
# firecrawl-py has shipped three client layouts across its history and older
# installs remain in the wild, so every layout gets wired and the wraps for
# layouts the installed SDK does not expose are skipped:
#
#   <= 2.x   module ``firecrawl.firecrawl`` with ``FirecrawlApp`` /
#            ``AsyncFirecrawlApp`` (removed in firecrawl-py 3.0)
#   >= 3.x   module ``firecrawl.v1.client`` with ``V1FirecrawlApp`` /
#            ``AsyncV1FirecrawlApp`` and modules ``firecrawl.v2.client`` /
#            ``firecrawl.v2.client_async`` with ``FirecrawlClient`` /
#            ``AsyncFirecrawlClient`` (the classes behind the top-level
#            ``firecrawl.Firecrawl`` / ``AsyncFirecrawl`` entry points)
#
# v2 note: ``FirecrawlClient.start_crawl`` / ``start_batch_scrape`` are
# synchronous fire-and-forget starters, so they take the sync wrapper
# below, not the coroutine wrapper.
_SYNC_WRAP_TARGETS = (
    # firecrawl-py <= 2.x module layout
    ("firecrawl.firecrawl", "FirecrawlApp.scrape_url", "firecrawl.scrape_url"),
    ("firecrawl.firecrawl", "FirecrawlApp.crawl_url", "firecrawl.crawl_url"),
    ("firecrawl.firecrawl", "FirecrawlApp.map_url", "firecrawl.map_url"),
    ("firecrawl.firecrawl", "FirecrawlApp.search", "firecrawl.search"),
    ("firecrawl.firecrawl", "FirecrawlApp.extract", "firecrawl.extract"),
    (
        "firecrawl.firecrawl",
        "FirecrawlApp.batch_scrape_urls",
        "firecrawl.batch_scrape_urls",
    ),
    (
        "firecrawl.firecrawl",
        "FirecrawlApp.check_crawl_status",
        "firecrawl.check_crawl_status",
    ),
    # v1 API clients (api_version="v1")
    ("firecrawl.v1.client", "V1FirecrawlApp.scrape_url", "firecrawl.scrape_url"),
    ("firecrawl.v1.client", "V1FirecrawlApp.crawl_url", "firecrawl.crawl_url"),
    ("firecrawl.v1.client", "V1FirecrawlApp.map_url", "firecrawl.map_url"),
    ("firecrawl.v1.client", "V1FirecrawlApp.search", "firecrawl.search"),
    ("firecrawl.v1.client", "V1FirecrawlApp.extract", "firecrawl.extract"),
    (
        "firecrawl.v1.client",
        "V1FirecrawlApp.batch_scrape_urls",
        "firecrawl.batch_scrape_urls",
    ),
    (
        "firecrawl.v1.client",
        "V1FirecrawlApp.check_crawl_status",
        "firecrawl.check_crawl_status",
    ),
    # v2 API clients, the classes behind the top-level Firecrawl entry points.
    # The v2 legacy method names (scrape_url, crawl_url, map_url,
    # batch_scrape_urls, check_crawl_status, async_crawl_url,
    # async_batch_scrape_urls) are thin one-line delegations to the
    # canonical methods wrapped here, so they are not wrapped separately:
    # that would emit two nested spans for a single user call.
    ("firecrawl.v2.client", "FirecrawlClient.scrape", "firecrawl.scrape"),
    ("firecrawl.v2.client", "FirecrawlClient.crawl", "firecrawl.crawl"),
    ("firecrawl.v2.client", "FirecrawlClient.map", "firecrawl.map"),
    ("firecrawl.v2.client", "FirecrawlClient.search", "firecrawl.search"),
    ("firecrawl.v2.client", "FirecrawlClient.extract", "firecrawl.extract"),
    ("firecrawl.v2.client", "FirecrawlClient.batch_scrape", "firecrawl.batch_scrape"),
    # fire-and-forget starters: synchronous methods, not coroutines
    (
        "firecrawl.v2.client",
        "FirecrawlClient.start_crawl",
        "firecrawl.start_crawl",
    ),
    (
        "firecrawl.v2.client",
        "FirecrawlClient.start_batch_scrape",
        "firecrawl.start_batch_scrape",
    ),
    (
        "firecrawl.v2.client",
        "FirecrawlClient.get_crawl_status",
        "firecrawl.get_crawl_status",
    ),
)

# Coroutine-function targets taking the async wrapper. v2 async methods share
# the span endpoints of their sync twins so dashboards see one operation.
_ASYNC_WRAP_TARGETS = (
    # firecrawl-py <= 2.x module layout
    (
        "firecrawl.firecrawl",
        "AsyncFirecrawlApp.scrape_url",
        "firecrawl.async_scrape_url",
    ),
    ("firecrawl.firecrawl", "AsyncFirecrawlApp.search", "firecrawl.async_search"),
    ("firecrawl.firecrawl", "AsyncFirecrawlApp.map_url", "firecrawl.async_map_url"),
    (
        "firecrawl.firecrawl",
        "AsyncFirecrawlApp.async_crawl_url",
        "firecrawl.async_crawl_url",
    ),
    (
        "firecrawl.firecrawl",
        "AsyncFirecrawlApp.async_extract",
        "firecrawl.async_extract",
    ),
    (
        "firecrawl.firecrawl",
        "AsyncFirecrawlApp.async_batch_scrape_urls",
        "firecrawl.async_batch_scrape_urls",
    ),
    # v1 API async client
    (
        "firecrawl.v1.client",
        "AsyncV1FirecrawlApp.scrape_url",
        "firecrawl.async_scrape_url",
    ),
    ("firecrawl.v1.client", "AsyncV1FirecrawlApp.search", "firecrawl.async_search"),
    ("firecrawl.v1.client", "AsyncV1FirecrawlApp.map_url", "firecrawl.async_map_url"),
    (
        "firecrawl.v1.client",
        "AsyncV1FirecrawlApp.async_crawl_url",
        "firecrawl.async_crawl_url",
    ),
    (
        "firecrawl.v1.client",
        "AsyncV1FirecrawlApp.async_extract",
        "firecrawl.async_extract",
    ),
    (
        "firecrawl.v1.client",
        "AsyncV1FirecrawlApp.async_batch_scrape_urls",
        "firecrawl.async_batch_scrape_urls",
    ),
    # v2 API async client
    ("firecrawl.v2.client_async", "AsyncFirecrawlClient.scrape", "firecrawl.scrape"),
    ("firecrawl.v2.client_async", "AsyncFirecrawlClient.crawl", "firecrawl.crawl"),
    ("firecrawl.v2.client_async", "AsyncFirecrawlClient.map", "firecrawl.map"),
    ("firecrawl.v2.client_async", "AsyncFirecrawlClient.search", "firecrawl.search"),
    (
        "firecrawl.v2.client_async",
        "AsyncFirecrawlClient.extract",
        "firecrawl.extract",
    ),
    (
        "firecrawl.v2.client_async",
        "AsyncFirecrawlClient.batch_scrape",
        "firecrawl.batch_scrape",
    ),
    (
        "firecrawl.v2.client_async",
        "AsyncFirecrawlClient.get_crawl_status",
        "firecrawl.get_crawl_status",
    ),
)


class FireCrawlInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Firecrawl's client library.
    Supports comprehensive Firecrawl API operations including scraping, crawling, searching, and mapping.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        requirement = _installed_firecrawl_distribution()
        return (f"{requirement} >= {_FIRECRAWL_MIN_VERSION}",)

    def _instrument(self, **kwargs):
        """Instrument the firecrawl-py library functions."""
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content", True)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version(_installed_firecrawl_distribution())
        metrics = kwargs.get("metrics")

        for module_name, target, endpoint in _SYNC_WRAP_TARGETS:
            try:
                wrap_function_wrapper(
                    module_name,
                    target,
                    general_wrap(
                        endpoint,
                        version,
                        environment,
                        application_name,
                        tracer,
                        pricing_info,
                        trace_content,
                        metrics,
                        disable_metrics,
                    ),
                )
            except Exception:
                pass

        for module_name, target, endpoint in _ASYNC_WRAP_TARGETS:
            try:
                wrap_function_wrapper(
                    module_name,
                    target,
                    async_general_wrap(
                        endpoint,
                        version,
                        environment,
                        application_name,
                        tracer,
                        pricing_info,
                        trace_content,
                        metrics,
                        disable_metrics,
                    ),
                )
            except Exception:
                pass

    def _uninstrument(self, **kwargs):
        pass
