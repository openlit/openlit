"""
GPT4All OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    calculate_tbt,
    general_tokens,
    get_chat_model_cost,
    get_embed_model_cost,
    common_span_attributes,
    record_completion_metrics,
    record_embedding_metrics,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(prompt):
    """
    Process a prompt to extract content.
    """
    return str(prompt) if prompt else ""


def build_input_messages(prompt):
    """
    Convert GPT4All request prompt to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    content = str(prompt) if prompt else ""
    return [{"role": "user", "parts": [{"type": "text", "content": content}]}]


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert GPT4All response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    if response_text:
        parts.append({"type": "text", "content": str(response_text)})
    if tool_calls:
        tools = tool_calls if isinstance(tool_calls, list) else [tool_calls]
        for t in tools:
            tc = t if isinstance(t, dict) else {}
            fn = tc.get("function", {}) or {}
            parts.append(
                {
                    "type": "tool_call",
                    "id": tc.get("id", ""),
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", ""),
                }
            )
    reason = finish_reason if finish_reason else "stop"
    return [{"role": "assistant", "parts": parts, "finish_reason": reason}]


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
        attributes = {SemanticConvention.GEN_AI_OPERATION: operation_name}
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
            if key == "response_id" and value is not None:
                attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
            elif key == "finish_reasons" and value is not None:
                attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
            elif key == "output_type" and value is not None:
                attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
            elif key == "temperature" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
            elif key == "max_tokens" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
            elif key == "top_p" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
            elif key == "top_k" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_TOP_K] = value
            elif key == "frequency_penalty" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] = value
            elif key == "presence_penalty" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] = value
            elif key == "stop_sequences" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
            elif key == "seed" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_SEED] = value
            elif key in ("choice_count", "n") and value is not None and value != 1:
                attributes[SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT] = value
            elif key == "input_tokens" and value is not None:
                attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
            elif key == "output_tokens" and value is not None:
                attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
            elif key == "cache_read_input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = (
                    value if value is not None else 0
                )
            elif key == "cache_creation_input_tokens":
                attributes[
                    SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                ] = value if value is not None else 0
            elif key == "error_type" and value is not None:
                attributes[SemanticConvention.ERROR_TYPE] = value
            elif key == "system_instructions" and value is not None:
                attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
            elif key == "conversation_id" and value is not None:
                attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value
        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)
    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def process_chunk(scope, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.time()
    # Record the timestamp for the current chunk
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        # Calculate time to first chunk
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    scope._llmresponse += chunk
    scope._end_time = time.time()


def common_generate_logic(
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
    Process generate request and generate Telemetry
    """

    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    prompt = format_content(
        scope._kwargs.get("prompt") or (scope._args[0] if scope._args else "") or ""
    )
    request_model = scope._request_model
    response_model = getattr(scope, "_response_model", request_model)

    # Calculate tokens from scope (may be set by caller)
    input_tokens = getattr(scope, "_input_tokens", None)
    if input_tokens is None:
        input_tokens = general_tokens(prompt)
    output_tokens = getattr(scope, "_output_tokens", None)
    if output_tokens is None:
        output_tokens = general_tokens(scope._llmresponse)

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
        scope._server_address,
        scope._server_port,
        request_model,
        response_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        scope._kwargs.get("repeat_penalty", 1.18),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        scope._kwargs.get("max_tokens", 200),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        scope._kwargs.get("presence_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, scope._kwargs.get("temp", 0.7)
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P, scope._kwargs.get("top_p", 0.4)
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_K, scope._kwargs.get("top_k", 40)
    )

    # Span Attributes for Response parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )
    finish_reason = getattr(scope, "_finish_reason", None) or "stop"
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finish_reason]
    )
    response_id = getattr(scope, "_response_id", None)
    if response_id is not None:
        scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, response_id)

    # Span Attributes for Tools
    if scope._tools:
        tools_list = scope._tools if isinstance(scope._tools, list) else [scope._tools]
        names = []
        ids = []
        args_list = []
        for t in tools_list:
            item = t if isinstance(t, dict) else {}
            fn = item.get("function") or {}
            if isinstance(fn, dict):
                names.append(fn.get("name", ""))
                args_list.append(str(fn.get("arguments", "")))
            else:
                names.append("")
                args_list.append("")
            ids.append(str(item.get("id", "")))
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, ",".join(names) if names else ""
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, ",".join(ids) if ids else ""
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS,
            ",".join(args_list) if args_list else "",
        )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens
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
    input_msgs = build_input_messages(prompt)
    output_msgs = build_output_messages(
        scope._llmresponse,
        getattr(scope, "_finish_reason", None),
        getattr(scope, "_tools", None),
    )
    _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
    if capture_message_content and event_provider:
        cache_read = getattr(scope, "_cache_read_input_tokens", 0)
        cache_creation = getattr(scope, "_cache_creation_input_tokens", 0)
        extra = {
            "response_id": getattr(scope, "_response_id", None),
            "finish_reasons": [finish_reason],
            "output_type": "text" if isinstance(scope._llmresponse, str) else "json",
            "temperature": scope._kwargs.get("temp"),
            "max_tokens": scope._kwargs.get("max_tokens"),
            "top_p": scope._kwargs.get("top_p"),
            "top_k": scope._kwargs.get("top_k"),
            "frequency_penalty": scope._kwargs.get("repeat_penalty"),
            "presence_penalty": scope._kwargs.get("presence_penalty"),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_input_tokens": cache_read,
            "cache_creation_input_tokens": cache_creation,
        }
        emit_inference_event(
            event_provider,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            request_model,
            response_model,
            input_messages=json.dumps(input_msgs) if input_msgs else None,
            output_messages=json.dumps(output_msgs) if output_msgs else None,
            server_address=scope._server_address,
            server_port=scope._server_port,
            **extra,
        )

    scope._span.set_status(Status(StatusCode.OK))

    # Span status and metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
            scope._server_address,
            scope._server_port,
            request_model,
            response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            input_tokens,
            output_tokens,
            cost,
            scope._tbt,
            scope._ttft,
        )


def common_embedding_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
):
    """
    Process embedding request and generate Telemetry
    """

    prompt = format_content(scope._kwargs.get("text") or "")
    request_model = scope._request_model

    input_tokens = general_tokens(prompt)

    cost = get_embed_model_cost(request_model, pricing_info, input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        False,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Embedding-specific span attributes
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES,
            str(scope._kwargs.get("text", "") or scope._kwargs.get("input", "")),
        )

    scope._span.set_status(Status(StatusCode.OK))

    # Span status and metrics
    if not disable_metrics:
        record_embedding_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            input_tokens,
            cost,
        )


def process_streaming_generate_response(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content=False,
    disable_metrics=False,
    version="",
    event_provider=None,
):
    """
    Process generate request and generate Telemetry
    """
    common_generate_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        is_stream=True,
        event_provider=event_provider,
    )


def process_generate_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    args,
    kwargs,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    event_provider=None,
):
    """
    Process generate request and generate Telemetry
    """

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._llmresponse = str(response)
    scope._request_model = request_model
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._args = args
    scope._tools = None

    # Handle token usage including reasoning tokens and cached tokens
    prompt = format_content(kwargs.get("prompt") or (args[0] if args else "") or "")
    scope._input_tokens = general_tokens(prompt)
    scope._output_tokens = general_tokens(scope._llmresponse)
    scope._cache_read_input_tokens = 0
    scope._cache_creation_input_tokens = 0

    common_generate_logic(
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


def process_embedding_response(
    response,
    request_model,
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
    **kwargs,
):
    """
    Process embedding request and generate Telemetry
    """

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._request_model = request_model
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    common_embedding_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
    )

    return response
