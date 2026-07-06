"""
Keyless tests for OCI GenAI instrumentation.

These build real `oci` SDK model objects (no credentials or network needed) and
drive the instrumentation's processing / wrapper code directly, asserting the
emitted OpenTelemetry span attributes.
"""

from types import SimpleNamespace

import pytest

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from oci.response import Response
from oci.generative_ai_inference.models import (
    ChatResult,
    GenericChatResponse,
    CohereChatResponse,
    ChatChoice,
    AssistantMessage,
    TextContent,
    Usage,
    ChatDetails,
    GenericChatRequest,
    CohereChatRequest,
    OnDemandServingMode,
    GenerateTextDetails,
    GenerateTextResult,
    CohereLlmInferenceRequest,
    CohereLlmInferenceResponse,
    GeneratedText,
    EmbedTextDetails,
    EmbedTextResult,
)

from openlit.semcov import SemanticConvention
from openlit.__helpers import (
    set_framework_llm_active,
    reset_framework_llm_active,
)
from openlit.instrumentation.oci_genai import oci_genai as oci_wrappers
from openlit.instrumentation.oci_genai.utils import (
    process_chat_response,
    process_generate_text_response,
    process_embedding_response,
)
import openlit.instrumentation.langchain as lc
from openlit.__helpers import get_server_address_for_provider
from openlit._config import OpenlitConfig


@pytest.fixture(autouse=True)
def _reset_openlit_config():
    """Initialize OpenlitConfig class attributes without a full openlit.init()."""
    OpenlitConfig.reset_to_defaults()
    yield


def _tracer():
    """Tracer."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return provider.get_tracer("test"), exporter


def _generic_chat_response(text="hi there", finish="stop"):
    """Generic chat response."""
    usage = Usage(prompt_tokens=10, completion_tokens=5, total_tokens=15)
    generic = GenericChatResponse(
        api_format="GENERIC",
        choices=[
            ChatChoice(
                index=0,
                finish_reason=finish,
                message=AssistantMessage(
                    role="ASSISTANT",
                    content=[TextContent(type="TEXT", text=text)],
                ),
            )
        ],
        usage=usage,
    )
    data = ChatResult(
        model_id="meta.llama-3.3-70b-instruct",
        model_version="1.0",
        chat_response=generic,
    )
    return Response(200, {}, data, None)


def _cohere_chat_response(text="cohere reply", finish="COMPLETE"):
    """Cohere chat response."""
    usage = Usage(prompt_tokens=7, completion_tokens=3, total_tokens=10)
    cohere = CohereChatResponse(
        api_format="COHERE", text=text, finish_reason=finish, usage=usage
    )
    data = ChatResult(
        model_id="cohere.command-a-03-2025",
        model_version="1.0",
        chat_response=cohere,
    )
    return Response(200, {}, data, None)


# --------------------------------------------------------------------------- #
# process_* (utils) tests
# --------------------------------------------------------------------------- #


def test_generic_chat_span_attributes():
    """Test generic chat span attributes."""
    tracer, exporter = _tracer()
    request = GenericChatRequest(
        api_format="GENERIC", is_stream=False, max_tokens=128, temperature=0.7
    )
    with tracer.start_as_current_span("chat test") as span:
        process_chat_response(
            response=_generic_chat_response(),
            request=request,
            request_model="meta.llama-3.3-70b-instruct",
            pricing_info={},
            server_port=443,
            server_address="inference.generativeai.us-chicago-1.oci.oraclecloud.com",
            environment="test-env",
            application_name="test-app",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="9.9.9",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs["telemetry.sdk.name"] == "openlit"
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "oci_genai"
    assert attrs[SemanticConvention.GEN_AI_OPERATION] == "chat"
    assert attrs["deployment.environment"] == "test-env"
    assert attrs["service.name"] == "test-app"
    assert attrs[SemanticConvention.GEN_AI_SDK_VERSION] == "9.9.9"
    assert (
        attrs[SemanticConvention.GEN_AI_REQUEST_MODEL]
        == "meta.llama-3.3-70b-instruct"
    )
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 10
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 5
    assert attrs[SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE] == 15
    assert SemanticConvention.GEN_AI_USAGE_COST in attrs
    assert attrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] == 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] == 0
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] == 128


def test_cohere_chat_span_attributes():
    """Test cohere chat span attributes."""
    tracer, exporter = _tracer()
    request = CohereChatRequest(api_format="COHERE", message="hello", is_stream=False)
    with tracer.start_as_current_span("chat test") as span:
        process_chat_response(
            response=_cohere_chat_response(),
            request=request,
            request_model="cohere.command-a-03-2025",
            pricing_info={},
            server_port=443,
            server_address="host",
            environment="e",
            application_name="a",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "oci_genai"
    assert (
        attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "cohere.command-a-03-2025"
    )
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 7
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] == 3


def test_generate_text_span_attributes():
    """Test generate text span attributes."""
    tracer, exporter = _tracer()
    request = GenerateTextDetails(
        compartment_id="c",
        serving_mode=OnDemandServingMode(model_id="cohere.command"),
        inference_request=CohereLlmInferenceRequest(prompt="say hi", is_stream=False),
    )
    inference_response = CohereLlmInferenceResponse(
        runtime_type="COHERE",
        generated_texts=[GeneratedText(text="hi from cohere", finish_reason="COMPLETE")],
    )
    data = GenerateTextResult(
        model_id="cohere.command", inference_response=inference_response
    )
    response = Response(200, {}, data, None)
    with tracer.start_as_current_span("gen test") as span:
        process_generate_text_response(
            response=response,
            request=request,
            request_model="cohere.command",
            pricing_info={},
            server_port=443,
            server_address="host",
            environment="e",
            application_name="a",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "oci_genai"
    assert (
        attrs[SemanticConvention.GEN_AI_OPERATION]
        == SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "cohere.command"
    # generate_text has no usage; tokens are estimated (> 0 for non-empty text).
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] > 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] > 0


def test_embedding_span_attributes():
    """Test embedding span attributes."""
    tracer, exporter = _tracer()
    request = EmbedTextDetails(
        inputs=["hello world", "second"],
        serving_mode=OnDemandServingMode(model_id="cohere.embed-v4.0"),
        compartment_id="c",
    )
    usage = Usage(prompt_tokens=4, completion_tokens=0, total_tokens=4)
    data = EmbedTextResult(
        embeddings=[[0.1, 0.2], [0.3, 0.4]],
        model_id="cohere.embed-v4.0",
        usage=usage,
    )
    response = Response(200, {}, data, None)
    with tracer.start_as_current_span("embed test") as span:
        process_embedding_response(
            response=response,
            request=request,
            request_model="cohere.embed-v4.0",
            pricing_info={},
            server_port=443,
            server_address="host",
            environment="e",
            application_name="a",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "oci_genai"
    assert (
        attrs[SemanticConvention.GEN_AI_OPERATION]
        == SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING
    )
    assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "cohere.embed-v4.0"
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] == 4


# --------------------------------------------------------------------------- #
# wrapper (oci_genai.py) tests: pass-through + resolution
# --------------------------------------------------------------------------- #


def _chat_wrapper():
    """Chat wrapper."""
    tracer, exporter = _tracer()
    wrapper = oci_wrappers.chat(
        version="1.0.0",
        environment="e",
        application_name="a",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )
    instance = SimpleNamespace(
        base_client=SimpleNamespace(
            endpoint="https://inference.generativeai.us-chicago-1.oci.oraclecloud.com"
        )
    )
    return wrapper, instance, exporter


def _non_stream_chat_details():
    """Non stream chat details."""
    return ChatDetails(
        compartment_id="c",
        serving_mode=OnDemandServingMode(model_id="meta.llama-3.3-70b-instruct"),
        chat_request=GenericChatRequest(api_format="GENERIC", is_stream=False),
    )


def test_wrapper_positional_and_keyword_resolution():
    """Test wrapper positional and keyword resolution."""
    wrapper, instance, exporter = _chat_wrapper()
    details = _non_stream_chat_details()
    called = {"n": 0}

    def wrapped(*args, **kwargs):
        """Wrapped."""
        called["n"] += 1
        return _generic_chat_response()

    # positional
    wrapper(wrapped, instance, (details,), {})
    # keyword
    wrapper(wrapped, instance, (), {"chat_details": details})
    assert called["n"] == 2
    spans = exporter.get_finished_spans()
    assert len(spans) == 2
    for span in spans:
        assert span.attributes[SemanticConvention.GEN_AI_PROVIDER_NAME] == "oci_genai"
        assert (
            span.attributes["server.address"]
            == "inference.generativeai.us-chicago-1.oci.oraclecloud.com"
        )


def test_wrapper_stream_passthrough_emits_no_span():
    """Test wrapper stream passthrough emits no span."""
    wrapper, instance, exporter = _chat_wrapper()
    details = ChatDetails(
        compartment_id="c",
        serving_mode=OnDemandServingMode(model_id="m"),
        chat_request=GenericChatRequest(api_format="GENERIC", is_stream=True),
    )
    sentinel = object()

    def wrapped(*args, **kwargs):
        """Wrapped."""
        return sentinel

    result = wrapper(wrapped, instance, (details,), {})
    assert result is sentinel
    assert not exporter.get_finished_spans()


def test_wrapper_framework_active_passthrough_emits_no_span():
    """Test wrapper framework active passthrough emits no span."""
    wrapper, instance, exporter = _chat_wrapper()
    details = _non_stream_chat_details()
    sentinel = object()

    def wrapped(*args, **kwargs):
        """Wrapped."""
        return sentinel

    token = set_framework_llm_active()
    try:
        result = wrapper(wrapped, instance, (details,), {})
    finally:
        reset_framework_llm_active(token)
    assert result is sentinel
    assert not exporter.get_finished_spans()


# --------------------------------------------------------------------------- #
# LangChain OCI detection (the #522 reporter's path)
# --------------------------------------------------------------------------- #


def test_langchain_detects_oci_provider_and_model():
    """Test langchain detects oci provider and model."""
    chat_ser = {
        "id": [
            "langchain_community",
            "chat_models",
            "oci_generative_ai",
            "ChatOCIGenAI",
        ],
        "kwargs": {"model_id": "cohere.command-a-03-2025"},
    }
    llm_ser = {
        "id": ["langchain_community", "llms", "oci_generative_ai", "OCIGenAI"],
        "kwargs": {"model_id": "meta.llama-3.3-70b-instruct"},
    }
    assert lc.detect_provider(chat_ser) == "oci_genai"
    assert lc.detect_provider(llm_ser) == "oci_genai"
    assert (
        lc.extract_model_name(chat_ser, {"invocation_params": {"model_id": "cohere.command-a-03-2025"}})
        == "cohere.command-a-03-2025"
    )
    assert (
        lc.extract_model_name(llm_ser, {"kwargs": {"model_id": "meta.llama-3.3-70b-instruct"}})
        == "meta.llama-3.3-70b-instruct"
    )
    assert get_server_address_for_provider("oci_genai") == (
        "inference.generativeai.us-chicago-1.oci.oraclecloud.com",
        443,
    )


# --------------------------------------------------------------------------- #
# Fallback / error branches
# --------------------------------------------------------------------------- #


def test_generate_text_llama_runtime_defensive_path():
    """Test generate text Llama runtime defensive path."""
    tracer, exporter = _tracer()
    request = SimpleNamespace(
        inference_request=SimpleNamespace(prompt="hello llama", is_stream=False)
    )
    inference_response = SimpleNamespace(
        runtime_type="LLAMA",
        choices=[SimpleNamespace(finish_reason="stop", text="llama out")],
    )
    data = SimpleNamespace(
        model_id="meta.llama-3.3-70b-instruct",
        inference_response=inference_response,
        id="",
    )
    response = Response(200, {}, data, None)
    with tracer.start_as_current_span("gen llama") as span:
        process_generate_text_response(
            response=response,
            request=request,
            request_model="meta.llama-3.3-70b-instruct",
            pricing_info={},
            server_port=443,
            server_address="host",
            environment="e",
            application_name="a",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=True,
            disable_metrics=True,
            version="1.0.0",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "oci_genai"
    # prompt + completion both estimated (> 0) since the response has no usage.
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] > 0
    assert attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] > 0


def test_embedding_usage_missing_falls_back_to_estimate():
    """Test embedding usage missing falls back to estimate."""
    tracer, exporter = _tracer()
    request = EmbedTextDetails(
        inputs=["hello world"],
        serving_mode=OnDemandServingMode(model_id="cohere.embed-v4.0"),
        compartment_id="c",
    )
    data = EmbedTextResult(
        embeddings=[[0.1, 0.2]], model_id="cohere.embed-v4.0", usage=None
    )
    response = Response(200, {}, data, None)
    with tracer.start_as_current_span("embed test") as span:
        process_embedding_response(
            response=response,
            request=request,
            request_model="cohere.embed-v4.0",
            pricing_info={},
            server_port=443,
            server_address="host",
            environment="e",
            application_name="a",
            metrics=None,
            start_time=0.0,
            span=span,
            capture_message_content=False,
            disable_metrics=True,
            version="1.0.0",
        )
    attrs = exporter.get_finished_spans()[0].attributes
    # No usage on the response -> tokens estimated from the input text (> 0).
    assert attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] > 0


def test_wrapper_reraises_sdk_error():
    """Test wrapper reraises sdk error."""
    wrapper, instance, exporter = _chat_wrapper()
    details = _non_stream_chat_details()

    class _Boom(RuntimeError):
        """Simulated OCI SDK failure."""

    def wrapped(*args, **kwargs):
        raise _Boom("service unavailable")

    with pytest.raises(_Boom):
        wrapper(wrapped, instance, (details,), {})
    # A span is still produced and marked with an error status.
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].status.status_code.name == "ERROR"
