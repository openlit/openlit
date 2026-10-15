# pylint: disable=duplicate-code, no-name-in-module, wrong-import-position, wrong-import-order, not-callable
"""
Regression tests for the FireCrawl instrumentation wiring.

Before the fix (issue #1721), ``FireCrawlInstrumentor`` declared a
``firecrawl >= 1.6.3`` dependency while the SDK installs as the
``firecrawl-py`` distribution, and every wrap targeted the
``firecrawl.firecrawl`` module that firecrawl-py 3.x removed. Result:
``openlit.init()`` skipped the instrumentor with
"FireCrawlInstrumentor only instruments ... but no installed version was
found" and no firecrawl call ever produced a span.

These tests are hermetic: the real instrumentor runs via ``openlit.init()``
against a local mock Firecrawl API, clients are constructed after
initialization (like real applications), and spans are captured with an
in-memory exporter. They cover the v2 clients behind the top-level
``firecrawl.Firecrawl`` entry point, the v1 ``V1FirecrawlApp`` client, and
the async v2 client.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

pytest.importorskip("firecrawl")

from opentelemetry import trace as otel_trace  # noqa: E402
from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (  # noqa: E402
    InMemorySpanExporter,
)

import openlit  # noqa: E402
from openlit.instrumentation.firecrawl import FireCrawlInstrumentor  # noqa: E402
from openlit.semcov import SemanticConvention  # noqa: E402

from firecrawl import AsyncFirecrawl, Firecrawl, V1FirecrawlApp  # noqa: E402


class _MockFirecrawlAPI(BaseHTTPRequestHandler):
    """Serves canned Firecrawl API responses for every client layout."""

    def do_POST(self):
        """Answer every client layout with its canned payload."""
        length = int(self.headers.get("Content-Length", 0))
        self.rfile.read(length)

        if self.path == "/v2/scrape":
            payload = {
                "success": True,
                "data": {
                    "url": "https://example.com",
                    "markdown": "# example page",
                    "metadata": {"title": "Example", "statusCode": 200},
                    "links": ["https://example.com/about"],
                },
            }
        elif self.path == "/v2/search":
            payload = {
                "success": True,
                "data": {
                    "web": [
                        {
                            "url": "https://example.com",
                            "title": "Example",
                            "description": "An example result",
                        }
                    ]
                },
            }
        elif self.path == "/v2/map":
            payload = {
                "success": True,
                "links": ["https://example.com/a", "https://example.com/b"],
            }
        elif self.path == "/v1/scrape":
            payload = {
                "success": True,
                "data": {
                    "markdown": "# v1 page",
                    "metadata": {"title": "V1", "statusCode": 200},
                },
            }
        else:
            payload = {"success": False, "error": f"unmocked path {self.path}"}

        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


_SERVER = ThreadingHTTPServer(("127.0.0.1", 0), _MockFirecrawlAPI)
threading.Thread(target=_SERVER.serve_forever, daemon=True).start()
MOCK_API_URL = f"http://127.0.0.1:{_SERVER.server_port}"

# Configure the tracer provider before openlit.init() so OpenLIT reuses it
# and the in-memory exporter captures every firecrawl span.
_PROVIDER = TracerProvider()
EXPORTER = InMemorySpanExporter()
_PROVIDER.add_span_processor(SimpleSpanProcessor(EXPORTER))
otel_trace.set_tracer_provider(_PROVIDER)

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-firecrawl-test",
    disable_metrics=True,
    disable_events=True,
)

# Construct clients after init: the wraps patch the client classes, so
# instances built here resolve the wrapped methods, exactly like
# applications that create their clients after openlit.init().
V2_CLIENT = Firecrawl(api_key="fc-test", api_url=MOCK_API_URL)
ASYNC_V2_CLIENT = AsyncFirecrawl(api_key="fc-test", api_url=MOCK_API_URL)
V1_CLIENT = V1FirecrawlApp(api_key="fc-test", api_url=MOCK_API_URL)


def _firecrawl_spans():
    """Return only the firecrawl spans this suite produced, newest last.

    The mock server calls also pass through the HTTP client
    instrumentors, so filter on the firecrawl provider attribute instead
    of taking every finished span.
    """
    return [
        span
        for span in EXPORTER.get_finished_spans()
        if span.attributes.get(SemanticConvention.GEN_AI_PROVIDER_NAME)
        == "firecrawl"
    ]


def test_dependency_declaration_matches_installed_distribution():
    """The instrumentor must declare the dist name that actually installs.

    On pristine main this returns ``("firecrawl >= 1.6.3",)`` even when
    ``firecrawl-py`` is the installed distribution, which made the
    OpenTelemetry dependency check skip the instrumentor entirely.
    """
    declared = FireCrawlInstrumentor().instrumentation_dependencies()
    assert declared == ("firecrawl-py >= 1.6.3",)


def test_v2_scrape_produces_span():
    """``Firecrawl(...).scrape()`` (the v2 entry point) must emit a span."""
    EXPORTER.clear()
    document = V2_CLIENT.scrape("https://example.com")

    assert document is not None
    spans = _firecrawl_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "scrape https://example.com"
    attributes = span.attributes
    assert (
        attributes[SemanticConvention.GEN_AI_PROVIDER_NAME] == "firecrawl"
    )
    assert attributes[SemanticConvention.GEN_AI_OPERATION] == "scrape"
    assert (
        attributes[SemanticConvention.GEN_AI_AGENT_BROWSE_URL]
        == "https://example.com"
    )
    assert (
        attributes[SemanticConvention.GEN_AI_CRAWL_RESULT_MARKDOWN_LENGTH]
        == len("# example page")
    )
    assert attributes[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION] > 0


def test_v2_scrape_url_alias_produces_span():
    """The deprecated ``scrape_url`` name on the v2 client must emit a span."""
    EXPORTER.clear()
    document = V2_CLIENT.scrape_url("https://example.com")

    assert document is not None
    spans = _firecrawl_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "scrape https://example.com"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == "scrape"


def test_v2_search_produces_span():
    """``Firecrawl(...).search()`` must emit a span with the search operation."""
    EXPORTER.clear()
    results = V2_CLIENT.search("example query")

    assert results is not None
    spans = _firecrawl_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "search example query"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == "search"


def test_v2_map_produces_span():
    """``Firecrawl(...).map()`` must emit a span with the map operation."""
    EXPORTER.clear()
    result = V2_CLIENT.map("https://example.com")

    assert result is not None
    spans = _firecrawl_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "map https://example.com"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == "map"


def test_v1_scrape_url_produces_span():
    """The v1 ``V1FirecrawlApp.scrape_url`` client must emit a span."""
    EXPORTER.clear()
    response = V1_CLIENT.scrape_url("https://example.com")

    assert response is not None
    spans = _firecrawl_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "scrape https://example.com"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == "scrape"
    assert (
        span.attributes[SemanticConvention.GEN_AI_CRAWL_RESULT_MARKDOWN_LENGTH]
        == len("# v1 page")
    )


@pytest.mark.asyncio
async def test_v2_async_scrape_produces_span():
    """The async v2 client coroutine must emit a span."""
    EXPORTER.clear()
    document = await ASYNC_V2_CLIENT.scrape("https://example.com")

    assert document is not None
    spans = _firecrawl_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "scrape https://example.com"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == "scrape"
    assert (
        span.attributes[SemanticConvention.GEN_AI_AGENT_BROWSE_URL]
        == "https://example.com"
    )
