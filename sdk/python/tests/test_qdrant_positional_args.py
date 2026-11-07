"""Exercise real Qdrant telemetry wrappers without a server or exported requests."""

import asyncio
from types import SimpleNamespace
from unittest.mock import create_autospec

import pytest
from opentelemetry import context as context_api
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from qdrant_client import AsyncQdrantClient, QdrantClient, models
from wrapt import FunctionWrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.qdrant.async_qdrant import async_general_wrap
from openlit.instrumentation.qdrant.qdrant import general_wrap
from openlit.semcov import SemanticConvention


POINTS = [models.PointStruct(id=1, vector=[0.1, 0.2])]
FILTER = models.Filter(must=[])
CASES = [
    ("upsert", "points", POINTS, "UPSERT", {"db.vector.count": 1}),
    ("query_points", "query", [0.1, 0.2], "QUERY", {"db.vector.query.top_k": 10}),
    ("delete", "points_selector", [1, 2], "DELETE", {"db.vector.count": 2}),
    ("retrieve", "ids", [1], "GET", {"db.vector.count": 1}),
    ("scroll", "scroll_filter", FILTER, "GET", {"db.filter": str(FILTER)}),
]


@pytest.fixture(name="telemetry")
def _telemetry_fixture():
    """Use isolated telemetry defaults and collect spans in memory."""
    OpenlitConfig.reset_to_defaults()
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    yield provider.get_tracer(__name__), exporter
    provider.shutdown()
    OpenlitConfig.reset_to_defaults()


def instrument(wrapped, method, asynchronous, tracer):
    """Use wrapt's actual dispatch with the synchronous or asynchronous wrapper."""
    factory = async_general_wrap if asynchronous else general_wrap
    callback = factory(
        f"qdrant.{method}", "test-version", "test", "test-app", tracer,
        pricing_info={}, capture_message_content=False, metrics={}, disable_metrics=True,
    )
    return FunctionWrapper(wrapped, callback)


def invoke(wrapped, asynchronous, args, kwargs):
    """Only the asynchronous client needs an event loop."""
    result = wrapped(*args, **kwargs)
    return asyncio.run(result) if asynchronous else result


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("positional", [False, True])
@pytest.mark.parametrize("method,field,value,operation,expected", CASES)
def test_call_styles_record_the_same_request(
    telemetry, asynchronous, positional, method, field, value, operation, expected,
):
    """Bind real SDK method signatures while keeping the underlying operation offline."""
    tracer, exporter = telemetry
    client = AsyncQdrantClient(":memory:") if asynchronous else QdrantClient(":memory:")
    response = SimpleNamespace(status="completed")
    wrapped = create_autospec(getattr(client, method), return_value=response)
    args = ("demo", value) if positional else ()
    kwargs = {} if positional else {"collection_name": "demo", field: value}
    original_kwargs = dict(kwargs)
    try:
        result = invoke(instrument(wrapped, method, asynchronous, tracer), asynchronous, args, kwargs)
    finally:
        if asynchronous:
            asyncio.run(client.close())
        else:
            client.close()

    assert result is response
    wrapped.assert_called_once_with(*args, **original_kwargs)
    assert kwargs == original_kwargs
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == f"{operation} demo"
    assert spans[0].attributes[SemanticConvention.DB_COLLECTION_NAME] == "demo"
    assert spans[0].attributes[SemanticConvention.DB_QUERY_TEXT] == str(value)
    for attribute, expected_value in expected.items():
        assert spans[0].attributes[attribute] == expected_value


@pytest.mark.parametrize("asynchronous", [False, True])
def test_original_exception_is_preserved(telemetry, asynchronous):
    """Parameter inspection must not replace an error from the original operation."""
    tracer, _ = telemetry
    error = RuntimeError("offline operation failed")

    def call(collection_name, points):
        raise error

    async def async_call(collection_name, points):
        raise error

    wrapped = instrument(async_call if asynchronous else call, "upsert", asynchronous, tracer)
    with pytest.raises(RuntimeError) as caught:
        invoke(wrapped, asynchronous, ("demo", POINTS), {})
    assert caught.value is error


@pytest.mark.parametrize("asynchronous", [False, True])
def test_suppression_keeps_the_original_call(telemetry, asynchronous):
    """A suppressed operation must not create spans or rewrite arguments."""
    tracer, exporter = telemetry
    calls = []
    response = object()

    def call(*args, **kwargs):
        calls.append((args, kwargs))
        return response

    async def async_call(*args, **kwargs):
        return call(*args, **kwargs)

    token = context_api.attach(context_api.set_value(context_api._SUPPRESS_INSTRUMENTATION_KEY, True))
    try:
        wrapped = instrument(async_call if asynchronous else call, "upsert", asynchronous, tracer)
        assert invoke(wrapped, asynchronous, ("demo", POINTS), {"wait": False}) is response
    finally:
        context_api.detach(token)
    assert calls == [(("demo", POINTS), {"wait": False})]
    assert not exporter.get_finished_spans()


def test_variadic_arguments_do_not_hide_keyword_data(telemetry):
    """Flatten a method's extra keywords without forwarding its variadic tuple as telemetry."""
    tracer, exporter = telemetry
    response = object()

    def call(collection_name, *extra, **kwargs):
        assert collection_name == "demo"
        assert extra == ("ignored",)
        assert kwargs == {"points": POINTS}
        return response

    wrapped = instrument(call, "upsert", False, tracer)
    assert wrapped("demo", "ignored", points=POINTS) is response
    span = exporter.get_finished_spans()[0]
    assert span.name == "UPSERT demo"
    assert span.attributes[SemanticConvention.DB_VECTOR_COUNT] == 1


def test_an_unavailable_signature_does_not_break_the_call(telemetry):
    """Opaque callables keep working, with their original keyword telemetry."""
    tracer, exporter = telemetry
    response = object()

    def call(collection_name, points):
        assert collection_name == "demo"
        assert points is POINTS
        return response

    call.__signature__ = "unavailable"
    wrapped = instrument(call, "upsert", False, tracer)
    assert wrapped("demo", points=POINTS) is response
    assert exporter.get_finished_spans()[0].attributes[SemanticConvention.DB_VECTOR_COUNT] == 1


def test_invalid_arguments_raise_the_original_binding_error(telemetry):
    """Do not replace the wrapped callable's TypeError with inspect's own message."""
    tracer, _ = telemetry

    def call(collection_name, points):
        pytest.fail("invalid arguments must not enter the operation")

    kwargs = {"collection_name": "duplicate", "points": POINTS}
    with pytest.raises(TypeError) as original:
        call("demo", **kwargs)  # pylint: disable=redundant-keyword-arg
    with pytest.raises(TypeError) as instrumented:
        instrument(call, "upsert", False, tracer)("demo", **kwargs)
    assert str(instrumented.value) == str(original.value)


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("method", ["set_payload", "overwrite_payload"])
def test_payload_operations_bind_the_third_positional_argument(telemetry, asynchronous, method):
    """Payload and point arguments occupy different positions but keep their own counts."""
    tracer, exporter = telemetry
    client = AsyncQdrantClient(":memory:") if asynchronous else QdrantClient(":memory:")
    response = SimpleNamespace(status="completed")
    wrapped = create_autospec(getattr(client, method), return_value=response)
    payload = {"city": "Paris"}
    args = ("demo", payload, [1, 2])
    try:
        assert invoke(instrument(wrapped, method, asynchronous, tracer), asynchronous, args, {}) is response
    finally:
        if asynchronous:
            asyncio.run(client.close())
        else:
            client.close()
    wrapped.assert_called_once_with(*args)
    span = exporter.get_finished_spans()[0]
    assert span.name == "UPDATE demo"
    assert span.attributes[SemanticConvention.DB_VECTOR_COUNT] == 2
    assert span.attributes[SemanticConvention.DB_PAYLOAD_COUNT] == 1


def test_real_in_memory_client_records_positional_calls(telemetry):
    """Exercise a real local Qdrant backend, without a server or model downloads."""
    tracer, exporter = telemetry
    client = QdrantClient(":memory:")
    try:
        client.create_collection("demo", models.VectorParams(size=2, distance=models.Distance.DOT))
        upsert = instrument(client.upsert, "upsert", False, tracer)
        retrieve = instrument(client.retrieve, "retrieve", False, tracer)
        assert upsert("demo", POINTS).status == models.UpdateStatus.COMPLETED
        assert [point.id for point in retrieve("demo", [1])] == [1]
    finally:
        client.close()
    spans = exporter.get_finished_spans()
    assert [span.name for span in spans] == ["UPSERT demo", "GET demo"]
    assert all(span.attributes[SemanticConvention.DB_VECTOR_COUNT] == 1 for span in spans)


@pytest.mark.asyncio
async def test_real_in_memory_async_client_records_positional_calls(telemetry):
    """Exercise the async SDK against its real local backend as well."""
    tracer, exporter = telemetry
    client = AsyncQdrantClient(":memory:")
    try:
        await client.create_collection("demo", models.VectorParams(size=2, distance=models.Distance.DOT))
        upsert = instrument(client.upsert, "upsert", True, tracer)
        retrieve = instrument(client.retrieve, "retrieve", True, tracer)
        assert (await upsert("demo", POINTS)).status == models.UpdateStatus.COMPLETED
        assert [point.id for point in await retrieve("demo", [1])] == [1]
    finally:
        await client.close()
    spans = exporter.get_finished_spans()
    assert [span.name for span in spans] == ["UPSERT demo", "GET demo"]
    assert all(span.attributes[SemanticConvention.DB_VECTOR_COUNT] == 1 for span in spans)
