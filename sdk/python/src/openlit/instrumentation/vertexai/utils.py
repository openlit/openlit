"""
VertexAI OpenTelemetry instrumentation utility functions
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
    record_completion_metrics,
    common_span_attributes,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(contents):
    """
    Format the VertexAI contents into a string for span events.
    """

    if not contents:
        return ""

    formatted_messages = []
    for content in contents:
        role = content.role
        parts = content.parts
        content_str = []

        for part in parts:
            # Collect relevant fields and handle each type of data that Part could contain
            if part.text:
                content_str.append(f"text: {part.text}")
            if part.video_metadata:
                content_str.append(f"video_metadata: {part.video_metadata}")
            if part.thought:
                content_str.append(f"thought: {part.thought}")
            if part.code_execution_result:
                content_str.append(
                    f"code_execution_result: {part.code_execution_result}"
                )
            if part.executable_code:
                content_str.append(f"executable_code: {part.executable_code}")
            if part.file_data:
                content_str.append(f"file_data: {part.file_data}")
            if part.function_call:
                content_str.append(f"function_call: {part.function_call}")
            if part.function_response:
                content_str.append(f"function_response: {part.function_response}")
            if part.inline_data:
                content_str.append(f"inline_data: {part.inline_data}")

        formatted_messages.append(f"{role}: {', '.join(content_str)}")

    return "\n".join(formatted_messages)


def build_input_messages(contents):
    """
    Convert Vertex AI request contents to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    if not contents:
        return []
    otel_messages = []
    for content in contents:
        try:
            role = (
                getattr(content, "role", "user")
                if not isinstance(content, dict)
                else content.get("role", "user")
            )
            parts_attr = (
                getattr(content, "parts", [])
                if not isinstance(content, dict)
                else content.get("parts", [])
            )
            parts_list = list(parts_attr) if parts_attr else []
            otel_parts = []
            for part in parts_list:
                text = (
                    getattr(part, "text", None)
                    if not isinstance(part, dict)
                    else part.get("text")
                )
                if text:
                    otel_parts.append({"type": "text", "content": str(text)})
                inline_data = (
                    getattr(part, "inline_data", None)
                    if not isinstance(part, dict)
                    else part.get("inline_data")
                )
                if inline_data and not text:
                    otel_parts.append({"type": "text", "content": "[inline_data]"})
            if otel_parts:
                otel_messages.append({"role": role, "parts": otel_parts})
        except Exception as e:
            logger.warning("Failed to process input content: %s", e, exc_info=True)
            continue
    return otel_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Vertex AI response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    try:
        if response_text:
            parts.append({"type": "text", "content": str(response_text)})
        finish_reason_map = {
            "stop": "stop",
            "length": "length",
            "max_tokens": "length",
            "safety": "content_filter",
            "recitation": "content_filter",
            "other": "stop",
        }
        otel_finish = (
            finish_reason_map.get(str(finish_reason), str(finish_reason or "stop"))
            if finish_reason is not None
            else "stop"
        )
        return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish}]
    except Exception as e:
        logger.warning("Failed to build output messages: %s", e, exc_info=True)
        return [{"role": "assistant", "parts": [], "finish_reason": "stop"}]


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
        if server_port is not None:
            attributes[SemanticConvention.SERVER_PORT] = server_port
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions
        for key, value in extra_attrs.items():
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
                attributes[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] = value
            elif key == "presence_penalty":
                attributes[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] = value
            elif key == "stop_sequences":
                attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
            elif key == "seed":
                attributes[SemanticConvention.GEN_AI_REQUEST_SEED] = value
            elif key in ("choice_count", "n"):
                if value != 1:
                    attributes[SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT] = value
            elif key == "input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
            elif key == "output_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
            elif key == "cache_read_input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = (
                    value
                )
            elif key == "cache_creation_input_tokens":
                attributes[
                    SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
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

    # Aggregate response content
    scope._llmresponse += str(chunk.text)
    # Handle token usage including reasoning tokens and cached tokens
    usage_metadata = getattr(chunk, "usage_metadata", None)
    scope._input_tokens = (
        getattr(usage_metadata, "prompt_token_count", 0) if usage_metadata else 0
    )
    scope._output_tokens = (
        getattr(usage_metadata, "candidates_token_count", 0) if usage_metadata else 0
    )
    scope._cache_read_input_tokens = (
        getattr(usage_metadata, "cached_content_token_count", 0)
        if usage_metadata
        else 0
    )
    scope._cache_creation_input_tokens = (
        getattr(usage_metadata, "cache_creation_input_tokens", 0)
        if usage_metadata
        else 0
    )


def common_chat_logic(
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
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    contents = scope._kwargs.get("contents", []) or (
        scope._args[0] if scope._args else []
    )
    formatted_messages = format_content(contents)
    prompt = formatted_messages or (str(contents[0]) if contents else "")

    if (
        hasattr(scope, "_input_tokens")
        and scope._input_tokens is not None
        and hasattr(scope, "_output_tokens")
        and scope._output_tokens is not None
    ):
        input_tokens = scope._input_tokens
        output_tokens = scope._output_tokens
    else:
        input_tokens = general_tokens(prompt)
        output_tokens = general_tokens(scope._llmresponse)

    cost = get_chat_model_cost(
        scope._request_model, pricing_info, input_tokens, output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
        scope._server_address,
        scope._server_port,
        scope._request_model,
        getattr(scope, "_response_model", scope._request_model),
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    inference_config = scope._kwargs.get("generation_config", {}) or {}
    attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "frequency_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_output_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, "presence_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop_sequences"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]
    for attribute, key in attributes:
        value = inference_config.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    if getattr(scope, "_finish_reason", None) is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
            [scope._finish_reason],
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    if getattr(scope, "_tools", None):
        tools = scope._tools
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME,
            tools.get("name", "")
            if isinstance(tools, dict)
            else getattr(tools, "name", ""),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID,
            str(
                tools.get("id", "")
                if isinstance(tools, dict)
                else getattr(tools, "id", "")
            ),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS,
            str(
                tools.get("parameters", "")
                if isinstance(tools, dict)
                else getattr(tools, "parameters", "")
            ),
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
    if capture_message_content:
        input_msgs = build_input_messages(
            scope._kwargs.get("contents", []) or (scope._args[0] if scope._args else [])
        )
        output_msgs = build_output_messages(
            scope._llmresponse,
            getattr(scope, "_finish_reason", None),
            tool_calls=getattr(scope, "_tools", None),
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                gen_config = scope._kwargs.get("generation_config", {}) or {}
                extra = {
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [getattr(scope, "_finish_reason", "")],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": gen_config.get("temperature"),
                    "max_tokens": gen_config.get("max_output_tokens"),
                    "top_p": gen_config.get("top_p"),
                    "frequency_penalty": gen_config.get("frequency_penalty"),
                    "presence_penalty": gen_config.get("presence_penalty"),
                    "stop_sequences": gen_config.get("stop_sequences"),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                }
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=scope._request_model,
                    response_model=getattr(
                        scope, "_response_model", scope._request_model
                    ),
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    **extra,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
            scope._server_address,
            scope._server_port,
            scope._request_model,
            getattr(scope, "_response_model", scope._request_model),
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


def process_streaming_chat_response(
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
    Process streaming chat response and generate telemetry.
    """

    common_chat_logic(
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


def process_chat_response(
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
    event_provider=None,
    **kwargs,
):
    """
    Process non-streaming chat response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._llmresponse = getattr(response, "text", "") or ""
    # Handle token usage including reasoning tokens and cached tokens
    usage_metadata = getattr(response, "usage_metadata", None)
    scope._input_tokens = (
        getattr(usage_metadata, "prompt_token_count", 0) if usage_metadata else 0
    )
    scope._output_tokens = (
        getattr(usage_metadata, "candidates_token_count", 0) if usage_metadata else 0
    )
    scope._cache_read_input_tokens = (
        getattr(usage_metadata, "cached_content_token_count", 0)
        if usage_metadata
        else 0
    )
    scope._cache_creation_input_tokens = (
        getattr(usage_metadata, "cache_creation_input_tokens", 0)
        if usage_metadata
        else 0
    )
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._request_model = request_model
    scope._response_model = request_model
    scope._kwargs = kwargs
    scope._args = [kwargs.get("contents", [])]
    candidates = getattr(response, "candidates", None) or []
    first_candidate = candidates[0] if candidates else None
    scope._finish_reason = (
        str(getattr(first_candidate, "finish_reason", None) or "")
        if first_candidate is not None
        else ""
    )
    scope._response_id = getattr(response, "id", None) or getattr(
        response, "name", None
    )

    common_chat_logic(
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


def extract_vertexai_details(instance):
    """
    Extract VertexAI-specific details like location and model name.
    """
    try:
        location = instance._model._location
        request_model = "/".join(instance._model._model_name.split("/")[3:])
    except:
        location = instance._location
        request_model = "/".join(instance._model_name.split("/")[3:])

    server_address = location + "-aiplatform.googleapis.com"
    server_port = 443

    return server_address, server_port, request_model
