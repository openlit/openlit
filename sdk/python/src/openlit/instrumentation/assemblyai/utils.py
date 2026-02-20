"""
AssemblyAI OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    common_span_attributes,
    get_audio_model_cost,
    otel_event,
    record_audio_metrics,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_audio_url(audio_url):
    """
    Process audio URL input to extract content.
    """
    return str(audio_url) if audio_url else ""


def format_content(messages):
    """
    Format the request input for display/cost. For AssemblyAI, input is typically
    an audio URL string; pass-through for consistency with other instrumentations.
    """
    if messages is None:
        return ""
    if isinstance(messages, str):
        return messages
    return str(messages)


def build_input_messages(audio_url_or_request):
    """
    Convert AssemblyAI request to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    if not audio_url_or_request:
        return []
    content = (
        format_audio_url(audio_url_or_request)
        if isinstance(audio_url_or_request, str)
        else str(audio_url_or_request)
    )
    if not content:
        return []
    return [{"role": "user", "parts": [{"type": "text", "content": content}]}]


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert AssemblyAI response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    content = str(response_text) if response_text is not None else ""
    msg = {
        "role": "assistant",
        "parts": [{"type": "text", "content": content}],
        "finish_reason": finish_reason or "stop",
    }
    return [msg]


def _set_span_messages_as_array(span, input_messages, output_messages):
    """Set gen_ai.input.messages and gen_ai.output.messages on span as JSON array strings (OTel)."""
    try:
        if input_messages is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                json.dumps(input_messages)
                if isinstance(input_messages, list)
                else input_messages,
            )
        if output_messages is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                json.dumps(output_messages)
                if isinstance(output_messages, list)
                else output_messages,
            )
    except Exception as e:
        logger.warning("Failed to set span message attributes: %s", e, exc_info=True)


def emit_inference_event(
    event_provider,
    operation_name,
    request_model,
    response_model,
    input_messages=None,
    output_messages=None,
    tool_definitions=None,
    server_address=None,
    server_port=None,
    **extra_attrs,
):
    """
    Emit gen_ai.client.inference.operation.details event.
    """
    try:
        if not event_provider:
            return

        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_name,
        }
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        for key, value in extra_attrs.items():
            if value is not None:
                if key == "response_id":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
                elif key == "finish_reasons":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
                elif key == "output_type":
                    attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
                elif key == "conversation_id":
                    attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value
                elif key == "temperature":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
                elif key == "max_tokens":
                    attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
                elif key == "top_p":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
                elif key == "frequency_penalty":
                    attributes[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] = (
                        value
                    )
                elif key == "presence_penalty":
                    attributes[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] = (
                        value
                    )
                elif key == "stop_sequences":
                    attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
                elif key == "seed":
                    attributes[SemanticConvention.GEN_AI_REQUEST_SEED] = value
                elif key in ("choice_count", "n"):
                    if value != 1:
                        attributes[SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT] = (
                            value
                        )
                elif key == "input_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
                elif key == "output_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
                else:
                    attributes[key] = value

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def common_audio_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    is_stream,
    event_provider=None,
):
    """
    Process audio transcription request and generate Telemetry.
    """

    prompt = scope._response.audio_url
    request_model = scope._kwargs.get("speech_model", "best")

    # Compute cost
    cost = get_audio_model_cost(
        request_model, pricing_info, prompt, scope._response.audio_duration
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
        SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # AssemblyAI transcription (no additional API type attribute)

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_AUDIO_DURATION,
        scope._response.audio_duration,
    )

    # Span Attributes for Response parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "text")
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response.id)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ["stop"]
    )

    # Span Attributes for Cost and Tokens
    input_tokens = getattr(scope, "_input_tokens", 0)
    output_tokens = getattr(scope, "_output_tokens", 0)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        input_tokens + output_tokens,
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # OTel cached token attributes (set even when 0)
    if hasattr(scope, "_cache_read_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
            scope._cache_read_input_tokens,
        )
    if hasattr(scope, "_cache_creation_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
            scope._cache_creation_input_tokens,
        )

    # Span Attributes for Content
    if capture_message_content:
        input_msgs = build_input_messages(prompt)
        output_msgs = build_output_messages(scope._response.text, "stop")
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                extra = {
                    "response_id": scope._response.id,
                    "finish_reasons": ["stop"],
                    "output_type": "text",
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                }
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    **extra,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    # Span status and metrics
    scope._span.set_status(Status(StatusCode.OK))
    if not disable_metrics:
        record_audio_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
            SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
        )


def process_audio_response(
    response,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
    **kwargs,
):
    """
    Process audio transcription request and generate Telemetry.
    """

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._response = response

    scope._response_model = kwargs.get("speech_model", "best")
    scope._tbt = 0.0
    scope._ttft = scope._end_time - scope._start_time

    # Handle token usage including reasoning tokens and cached tokens
    usage = getattr(response, "usage", None)
    if isinstance(usage, dict):
        scope._input_tokens = usage.get("input_tokens", 0)
        scope._output_tokens = usage.get("output_tokens", 0)
        input_details = usage.get("input_tokens_details") or usage.get(
            "prompt_tokens_details", {}
        )
        scope._cache_read_input_tokens = input_details.get("cached_tokens", 0)
        scope._cache_creation_input_tokens = usage.get("cache_creation_input_tokens", 0)
    else:
        scope._input_tokens = 0
        scope._output_tokens = 0
        scope._cache_read_input_tokens = 0
        scope._cache_creation_input_tokens = 0

    common_audio_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        is_stream=False,
        event_provider=event_provider,
    )

    return response
