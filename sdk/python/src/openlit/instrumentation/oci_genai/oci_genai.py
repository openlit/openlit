"""
Module for monitoring OCI GenAI API calls.
"""

import time
from urllib.parse import urlparse

from opentelemetry.trace import SpanKind

from openlit.__helpers import (
    handle_exception,
    is_framework_llm_active,
    record_completion_metrics,
    record_embedding_metrics,
)
from openlit.instrumentation.oci_genai.utils import (
    _serving_model_id,
    process_chat_response,
    process_generate_text_response,
    process_embedding_response,
)
from openlit.semcov import SemanticConvention

# Default OCI GenAI inference host used when the client endpoint is unavailable.
_DEFAULT_OCI_HOST = "inference.generativeai.us-chicago-1.oci.oraclecloud.com"
_DEFAULT_OCI_PORT = 443


def _resolve_details(args, kwargs, key):
    """Resolve an OCI *Details request object passed positionally or by keyword."""
    if key in kwargs:
        return kwargs.get(key)
    return args[0] if args else None


def _server_address_and_port(instance):
    """Derive (address, port) from the OCI client endpoint (base_client.endpoint)."""
    endpoint = getattr(getattr(instance, "base_client", None), "endpoint", None)
    if isinstance(endpoint, str) and endpoint:
        parsed = urlparse(endpoint if "://" in endpoint else "https://" + endpoint)
        return (
            parsed.hostname or _DEFAULT_OCI_HOST,
            parsed.port if parsed.port is not None else _DEFAULT_OCI_PORT,
        )
    return _DEFAULT_OCI_HOST, _DEFAULT_OCI_PORT


def chat(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """
    Generates a telemetry wrapper for GenAI chat function call.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OCI GenAI chat function call.
        """

        # The LangChain instrumentor owns (and enriches) the LLM span; skip the
        # SDK-level span to avoid duplicates.
        if is_framework_llm_active():
            return wrapped(*args, **kwargs)

        details = _resolve_details(args, kwargs, "chat_details")
        chat_request = getattr(details, "chat_request", None)

        # Streaming is not instrumented in this version; pass through untouched.
        if getattr(chat_request, "is_stream", False):
            return wrapped(*args, **kwargs)

        request_model = _serving_model_id(details)
        server_address, server_port = _server_address_and_port(instance)
        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                if not disable_metrics and metrics:
                    record_completion_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        time.time(),
                        0,
                        0,
                        0,
                        0,
                        None,
                        error_type=type(e).__name__ or "_OTHER",
                    )
                raise

            # Telemetry processing self-handles its own errors and never raises.
            response = process_chat_response(
                response=response,
                request=chat_request,
                request_model=request_model,
                pricing_info=pricing_info,
                server_port=server_port,
                server_address=server_address,
                environment=environment,
                application_name=application_name,
                metrics=metrics,
                start_time=start_time,
                span=span,
                capture_message_content=capture_message_content,
                disable_metrics=disable_metrics,
                version=version,
            )

        return response

    return wrapper


def generate_text(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """
    Generates a telemetry wrapper for GenAI generate_text (legacy) function call.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OCI GenAI generate_text function call.
        """

        if is_framework_llm_active():
            return wrapped(*args, **kwargs)

        details = _resolve_details(args, kwargs, "generate_text_details")
        inference_request = getattr(details, "inference_request", None)

        if getattr(inference_request, "is_stream", False):
            return wrapped(*args, **kwargs)

        request_model = _serving_model_id(details)
        server_address, server_port = _server_address_and_port(instance)
        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} "
            f"{request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                if not disable_metrics and metrics:
                    record_completion_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                        SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        time.time(),
                        0,
                        0,
                        0,
                        0,
                        None,
                        error_type=type(e).__name__ or "_OTHER",
                    )
                raise

            # Telemetry processing self-handles its own errors and never raises.
            response = process_generate_text_response(
                response=response,
                request=details,
                request_model=request_model,
                pricing_info=pricing_info,
                server_port=server_port,
                server_address=server_address,
                environment=environment,
                application_name=application_name,
                metrics=metrics,
                start_time=start_time,
                span=span,
                capture_message_content=capture_message_content,
                disable_metrics=disable_metrics,
                version=version,
            )

        return response

    return wrapper


def embed(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Generates a telemetry wrapper for GenAI embedding function call.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OCI GenAI embed_text function call.
        """

        details = _resolve_details(args, kwargs, "embed_text_details")
        request_model = _serving_model_id(details)
        server_address, server_port = _server_address_and_port(instance)
        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                if not disable_metrics and metrics:
                    record_embedding_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                        SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        time.time(),
                        0,
                        0,
                        error_type=type(e).__name__ or "_OTHER",
                    )
                raise

            # Telemetry processing self-handles its own errors and never raises.
            response = process_embedding_response(
                response=response,
                request=details,
                request_model=request_model,
                pricing_info=pricing_info,
                server_port=server_port,
                server_address=server_address,
                environment=environment,
                application_name=application_name,
                metrics=metrics,
                start_time=start_time,
                span=span,
                capture_message_content=capture_message_content,
                disable_metrics=disable_metrics,
                version=version,
            )

            return response

    return wrapper
