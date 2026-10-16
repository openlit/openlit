# pylint: disable=redefined-outer-name, missing-function-docstring
"""
Tests for Firecrawl instrumentation on the current firecrawl-py SDK.

The real ``Firecrawl`` / ``AsyncFirecrawl`` clients run against a fake HTTP
transport, so no API key or network access is needed.
"""

import asyncio
import importlib
import importlib.metadata
import json

import httpx
import pytest
import requests
from opentelemetry.instrumentation.dependencies import get_dependency_conflicts
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

import openlit.instrumentation.firecrawl as firecrawl_instrumentation
from openlit._config import OpenlitConfig
from openlit.instrumentation.firecrawl import FireCrawlInstrumentor
from openlit.semcov import SemanticConvention

firecrawl = pytest.importorskip("firecrawl")
pytest.importorskip("firecrawl.v2.client")
from firecrawl.v2.utils.error_handler import InternalServerError  # pylint: disable=wrong-import-position, wrong-import-order

EXPECTED_V2_TARGETS = {
    (module, f"{cls}.{method}")
    for module, cls in (
        ("firecrawl.v2.client", "FirecrawlClient"),
        ("firecrawl.v2.client_async", "AsyncFirecrawlClient"),
    )
    for method in (
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
} | {("firecrawl.v2.client_async", "AsyncFirecrawlClient.wait_batch_scrape")}
EXPECTED_V1_TARGETS = {
    (module, f"{cls}.{method}")
    for module, sync_cls, async_cls in (
        ("firecrawl.firecrawl", "FirecrawlApp", "AsyncFirecrawlApp"),
        ("firecrawl.v1.client", "V1FirecrawlApp", "AsyncV1FirecrawlApp"),
    )
    for cls, methods in (
        (sync_cls, ("scrape_url", "crawl_url", "map_url", "search", "extract", "batch_scrape_urls", "check_crawl_status")),
        (async_cls, ("scrape_url", "async_crawl_url", "async_extract", "async_batch_scrape_urls", "search", "map_url")),
    )
    for method in methods
}

URL = "https://example.com"
DOCUMENT = {
    "markdown": "# Example Domain",
    "metadata": {"title": "Example Domain", "statusCode": 200, "sourceURL": URL},
}
RESPONSES = {
    ("POST", "/v2/scrape"): (200, {"success": True, "data": DOCUMENT}),
    ("POST", "/v2/search"): (
        200,
        {
            "success": True,
            "data": {
                "web": [
                    {"url": URL, "title": "Example", "description": "Example"},
                    {"url": "https://example.org", "title": "Org", "description": "Org"},
                ]
            },
        },
    ),
    ("POST", "/v2/crawl"): (
        200,
        {"success": True, "id": "crawl-1", "url": "https://api.firecrawl.dev/v2/crawl/crawl-1"},
    ),
    ("GET", "/v2/crawl/crawl-1"): (
        200,
        {
            "success": True,
            "status": "completed",
            "total": 1,
            "completed": 1,
            "creditsUsed": 1,
            "expiresAt": "2026-10-06T00:00:00Z",
            "data": [DOCUMENT],
        },
    ),
}


def _wrapped_targets():
    """Every class method the instrumentor may replace, so tests can restore them."""
    targets = []
    for module, sync_class, async_class in firecrawl_instrumentation._V1_CLIENTS:
        targets += [(module, sync_class, m) for m, _ in firecrawl_instrumentation._V1_SYNC_METHODS]
        targets += [(module, async_class, m) for m, _ in firecrawl_instrumentation._V1_ASYNC_METHODS]
    for module, cls in (
        firecrawl_instrumentation._V2_SYNC_CLIENT,
        firecrawl_instrumentation._V2_ASYNC_CLIENT,
    ):
        targets += [(module, cls, m) for m in firecrawl_instrumentation._V2_METHODS]
    originals = []
    for module, cls, method in targets:
        try:
            owner = getattr(importlib.import_module(module), cls)
        except (ImportError, AttributeError):
            continue
        if method in owner.__dict__:
            originals.append((owner, method, owner.__dict__[method]))
    return originals


@pytest.fixture
def requests_seen():
    return []


@pytest.fixture
def fake_api(monkeypatch, requests_seen):
    """Serve RESPONSES from the requests and httpx transports."""

    def lookup(method, path):
        requests_seen.append((method, path))
        return RESPONSES.get((method, path), (500, {"success": False, "error": "boom"}))

    def send(self, request, **kwargs):
        status, body = lookup(request.method, requests.utils.urlparse(request.url).path)
        response = requests.Response()
        response.status_code = status
        response._content = json.dumps(body).encode()
        response.headers["Content-Type"] = "application/json"
        response.url = request.url
        response.request = request
        return response

    async def handle_async_request(self, request):
        status, body = lookup(request.method, request.url.path)
        return httpx.Response(status, json=body, request=request)

    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", send)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", handle_async_request)


@pytest.fixture
def capture_message_content():
    return True


@pytest.fixture
def exporter(monkeypatch, fake_api, capture_message_content):
    """Instrument firecrawl-py with an in-memory exporter, then unwrap it."""
    OpenlitConfig.reset_to_defaults()
    span_exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(span_exporter))
    monkeypatch.setattr(
        firecrawl_instrumentation.trace,
        "get_tracer",
        lambda *args, **kwargs: provider.get_tracer("test-firecrawl"),
    )
    originals = _wrapped_targets()
    FireCrawlInstrumentor()._instrument(
        environment="test",
        application_name="test",
        capture_message_content=capture_message_content,
    )
    yield span_exporter
    for owner, method, original in originals:
        setattr(owner, method, original)


def _only_span(span_exporter):
    spans = span_exporter.get_finished_spans()
    assert len(spans) == 1, [span.name for span in spans]
    return spans[0]


def test_dependency_check_passes_for_installed_distribution():
    assert get_dependency_conflicts(FireCrawlInstrumentor().instrumentation_dependencies()) is None


@pytest.mark.parametrize("installed", ["firecrawl-py", "firecrawl"])
def test_dependency_check_accepts_either_distribution(monkeypatch, installed):
    def fake_version(name):
        if name != installed:
            raise importlib.metadata.PackageNotFoundError(name)
        return "4.46.2"

    monkeypatch.setattr(firecrawl_instrumentation.importlib.metadata, "version", fake_version)

    assert FireCrawlInstrumentor().instrumentation_dependencies() == (f"{installed} >= 1.6.3",)


def test_dependency_check_skips_distribution_below_minimum(monkeypatch):
    versions = {"firecrawl-py": "1.0.0", "firecrawl": "4.46.2"}

    def fake_version(name):
        if name not in versions:
            raise importlib.metadata.PackageNotFoundError(name)
        return versions[name]

    monkeypatch.setattr(firecrawl_instrumentation.importlib.metadata, "version", fake_version)

    assert FireCrawlInstrumentor().instrumentation_dependencies() == ("firecrawl >= 1.6.3",)


def _record_wraps(monkeypatch, missing_modules=()):
    wrapped = set()

    def fake_wrap(module, class_method, wrapper):
        if module in missing_modules:
            raise ModuleNotFoundError(module)
        wrapped.add((module, class_method))

    monkeypatch.setattr(firecrawl_instrumentation, "wrap_function_wrapper", fake_wrap)
    monkeypatch.setattr(firecrawl_instrumentation.importlib.metadata, "version", lambda name: "4.46.2")
    FireCrawlInstrumentor()._instrument(environment="test", application_name="test")
    return wrapped


def test_registers_v1_and_v2_client_layouts(monkeypatch):
    """firecrawl.firecrawl (1.x/2.x), firecrawl.v1.client and the v2 clients (3.x+)."""
    assert _record_wraps(monkeypatch) == EXPECTED_V1_TARGETS | EXPECTED_V2_TARGETS


def test_missing_layout_does_not_stop_other_wraps(monkeypatch):
    wrapped = _record_wraps(monkeypatch, missing_modules={"firecrawl.firecrawl"})

    assert wrapped == {
        target for target in EXPECTED_V1_TARGETS | EXPECTED_V2_TARGETS if target[0] != "firecrawl.firecrawl"
    }


def test_scrape_emits_span(exporter):
    document = firecrawl.Firecrawl(api_key="fc-test").scrape(URL, formats=["markdown"])

    assert document.markdown == "# Example Domain"
    span = _only_span(exporter)
    attrs = span.attributes
    assert span.name == f"scrape {URL}"
    assert attrs[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_SCRAPE
    assert attrs[SemanticConvention.GEN_AI_AGENT_BROWSE_URL] == URL
    assert attrs[SemanticConvention.GEN_AI_CRAWL_RESULT_MARKDOWN_LENGTH] == len("# Example Domain")
    assert attrs[SemanticConvention.GEN_AI_CRAWL_RESULT_STATUS_CODE] == 200
    assert attrs["gen_ai.response.title"] == "Example Domain"
    assert attrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] == "# Example Domain"
    assert attrs[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION] > 0


@pytest.mark.parametrize("capture_message_content", [False])
def test_scrape_respects_capture_message_content(exporter):
    firecrawl.Firecrawl(api_key="fc-test").scrape(URL)

    attrs = _only_span(exporter).attributes
    assert SemanticConvention.GEN_AI_INPUT_MESSAGES not in attrs
    assert SemanticConvention.GEN_AI_OUTPUT_MESSAGES not in attrs


def test_legacy_alias_emits_one_span(exporter):
    """scrape_url on the v2 client delegates to scrape and must not nest a second span."""
    firecrawl.FirecrawlApp(api_key="fc-test").scrape_url(URL)

    assert _only_span(exporter).name == f"scrape {URL}"


def test_search_emits_span(exporter):
    results = firecrawl.Firecrawl(api_key="fc-test").search("example", limit=2)

    assert len(results.web) == 2
    span = _only_span(exporter)
    assert span.name == "search example"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_SEARCH
    assert span.attributes["gen_ai.response.data_count"] == 2


def test_crawl_emits_span(exporter):
    job = firecrawl.Firecrawl(api_key="fc-test").crawl(URL, limit=1, poll_interval=0)

    assert job.status == "completed"
    span = _only_span(exporter)
    attrs = span.attributes
    assert span.name == f"crawl {URL}"
    assert attrs[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL
    assert attrs[SemanticConvention.GEN_AI_MONITOR_TASK_STATUS] == "completed"
    assert attrs["gen_ai.response.credits_used"] == 1
    assert attrs["gen_ai.response.data_count"] == 1


def test_crawl_status_does_not_report_job_id_as_url(exporter):
    job = firecrawl.Firecrawl(api_key="fc-test").get_crawl_status("crawl-1")

    assert job.status == "completed"
    span = _only_span(exporter)
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL_STATUS
    assert SemanticConvention.GEN_AI_AGENT_BROWSE_URL not in span.attributes


def test_async_crawl_emits_one_span(exporter):
    """AsyncFirecrawlClient.crawl calls start_crawl internally; only the outer call is traced."""

    async def run():
        return await firecrawl.AsyncFirecrawl(api_key="fc-test").crawl(url=URL, limit=1, poll_interval=0)

    job = asyncio.run(run())

    assert job.status == "completed"
    span = _only_span(exporter)
    assert span.name == f"crawl {URL}"
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_CRAWL


def test_failed_call_is_sent_once_and_recorded(exporter, requests_seen):
    client = firecrawl.Firecrawl(api_key="fc-test")

    with pytest.raises(InternalServerError):
        client.map(URL)

    assert requests_seen == [("POST", "/v2/map")]
    span = _only_span(exporter)
    assert span.status.status_code == StatusCode.ERROR
    assert span.attributes[SemanticConvention.GEN_AI_OPERATION] == SemanticConvention.GEN_AI_OPERATION_TYPE_MAP
    assert span.attributes[SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION] > 0


def test_installed_targets_resolve_to_real_methods(monkeypatch):
    """Every target in a layout the installed SDK ships points at a real method."""
    resolved = set()
    unresolved = set()

    def resolving_wrap(module, class_method, wrapper):
        try:
            obj = importlib.import_module(module)
        except ImportError:
            return
        for part in class_method.split("."):
            obj = getattr(obj, part, None)
        (resolved if callable(obj) else unresolved).add((module, class_method))

    monkeypatch.setattr(firecrawl_instrumentation, "wrap_function_wrapper", resolving_wrap)
    monkeypatch.setattr(firecrawl_instrumentation.importlib.metadata, "version", lambda name: "4.46.2")
    FireCrawlInstrumentor()._instrument(environment="test", application_name="test")

    assert ("firecrawl.v2.client", "FirecrawlClient.scrape") in resolved
    assert ("firecrawl.v2.client_async", "AsyncFirecrawlClient.scrape") in resolved
    assert ("firecrawl.v1.client", "V1FirecrawlApp.scrape_url") in resolved
    assert not unresolved
