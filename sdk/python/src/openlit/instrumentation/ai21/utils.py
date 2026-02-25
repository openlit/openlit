"""
AI21 OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    general_tokens,
    get_chat_model_cost,
    common_span_attributes,
    record_completion_metrics,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def build_input_messages(messages):
    """
    Convert AI21 request messages to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    structured = []
    for message in messages or []:
        if hasattr(message, "role") and (
            hasattr(message, "content") or hasattr(message, "text")
        ):
            role = (
                str(message.role.value)
                if hasattr(message.role, "value")
                else str(message.role)
            )
            content = getattr(message, "content", None) or getattr(message, "text", "")
        elif isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", "")
        else:
            role = str(getattr(message, "role", "user"))
            content = str(
                getattr(message, "content", "") or getattr(message, "text", "")
            )
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        parts.append({"type": "text", "content": item.get("text", "")})
                    elif "image_url" in item:
                        parts.append(
                            {
                                "type": "uri",
                                "modality": "image",
                                "uri": item.get("image_url", ""),
                            }
                        )
                else:
                    parts.append({"type": "text", "content": str(item)})
        else:
            parts = [{"type": "text", "content": str(content)}]
        if parts:
            structured.append({"role": role, "parts": parts})
    return structured


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert AI21 response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    if response_text:
        parts.append({"type": "text", "content": str(response_text)})
    if tool_calls:
        if not isinstance(tool_calls, list):
            tool_calls = [tool_calls]
        for tc in tool_calls:
            func = tc.get("function", {}) if isinstance(tc, dict) else {}
            if isinstance(func, dict):
                parts.append(
                    {
                        "type": "tool_call",
                        "id": tc.get("id", ""),
                        "name": func.get("name", ""),
                        "arguments": func.get("arguments", {}),
                    }
                )
    if not parts:
        parts = [{"type": "text", "content": ""}]
    return [
        {"role": "assistant", "parts": parts, "finish_reason": finish_reason or "stop"}
    ]


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
            if value is not None:
                if key == "response_id":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
                elif key == "finish_reasons":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
                elif key == "output_type":
                    attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
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
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                elif key == "conversation_id":
                    attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def format_content(messages):
    """
    Process a list of messages to extract content.
    """

    formatted_messages = []
    for message in messages:
        # Handle different message formats
        if hasattr(message, "role") and (
            hasattr(message, "content") or hasattr(message, "text")
        ):
            # ChatMessage object (AI21 format)
            role = (
                str(message.role)
                if hasattr(message.role, "value")
                else str(message.role)
            )
            content = getattr(message, "content", None) or getattr(message, "text", "")
        elif isinstance(message, dict):
            # Dictionary format
            role = message["role"]
            content = message["content"]
        else:
            # Fallback - try to extract as string
            role = str(getattr(message, "role", "unknown"))
            content = str(
                getattr(message, "content", "") or getattr(message, "text", "")
            )

        if isinstance(content, list):
            content_str = ", ".join(
                f"{item['type']}: {item['text'] if 'text' in item else item['image_url']}"
                if "type" in item
                else f"text: {item['text']}"
                for item in content
            )
            formatted_messages.append(f"{role}: {content_str}")
        else:
            formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


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

    chunked = response_as_dict(chunk)

    # Collect message IDs and aggregated response from events
    if (
        len(chunked.get("choices", [])) > 0
        and "delta" in chunked.get("choices")[0]
        and "content" in chunked.get("choices")[0].get("delta", {})
    ):
        content = chunked.get("choices")[0].get("delta").get("content")
        if content:
            scope._llmresponse += content

    # Handle token usage including reasoning tokens and cached tokens
    if chunked.get("usage"):
        usage = chunked.get("usage", {})
        scope._input_tokens = usage.get("prompt_tokens", 0)
        scope._output_tokens = usage.get("completion_tokens", 0)
        scope._cache_read_input_tokens = (usage.get("prompt_tokens_details") or {}).get(
            "cached_tokens", 0
        ) or 0
        scope._cache_creation_input_tokens = (
            usage.get("input_tokens_details") or {}
        ).get("cache_creation_tokens", 0) or 0
        scope._response_id = chunked.get("id")
        scope._finish_reason = chunked.get("choices", [{}])[0].get("finish_reason")
        scope._end_time = time.time()


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

    prompt = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("model", "jamba-1.5-mini")

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

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_AI21,
        scope._server_address,
        scope._server_port,
        request_model,
        getattr(scope, "_response_model", request_model),
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SEED, scope._kwargs.get("seed", "")
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        scope._kwargs.get("frequency_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        scope._kwargs.get("max_tokens", -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        scope._kwargs.get("presence_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, scope._kwargs.get("stop", [])
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        scope._kwargs.get("temperature", 0.4),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P, scope._kwargs.get("top_p", 1.0)
    )

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    if scope._tools:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME,
            scope._tools.get("function", {}).get("name", ""),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, str(scope._tools.get("id", ""))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS,
            str(scope._tools.get("function", {}).get("arguments", "")),
        )

    # Span Attributes for Cost and Tokens
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

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages / gen_ai.output.messages)
    if capture_message_content:
        input_msgs = build_input_messages(scope._kwargs.get("messages", []))
        output_msgs = build_output_messages(
            scope._llmresponse, scope._finish_reason, tool_calls=scope._tools
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                extra = {
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": scope._kwargs.get("temperature"),
                    "max_tokens": scope._kwargs.get("max_tokens"),
                    "top_p": scope._kwargs.get("top_p"),
                    "frequency_penalty": scope._kwargs.get("frequency_penalty"),
                    "presence_penalty": scope._kwargs.get("presence_penalty"),
                    "stop_sequences": scope._kwargs.get("stop"),
                    "seed": scope._kwargs.get("seed"),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                }
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=request_model,
                    response_model=getattr(scope, "_response_model", request_model),
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

    # Metrics
    if not disable_metrics:
        inter_chunk_durations = None
        if getattr(scope, "_timestamps", None) and len(scope._timestamps) > 1:
            inter_chunk_durations = [
                scope._timestamps[i] - scope._timestamps[i - 1]
                for i in range(1, len(scope._timestamps))
            ]
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_AI21,
            scope._server_address,
            scope._server_port,
            request_model,
            getattr(scope, "_response_model", request_model),
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            input_tokens,
            output_tokens,
            cost,
            scope._tbt,
            scope._ttft,
            is_stream=is_stream,
            time_per_chunk_observations=inter_chunk_durations,
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
    Process streaming chat request and generate Telemetry
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
    Process chat request and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._llmresponse = " ".join(
        (choice.get("message", {}).get("content") or "")
        for choice in response_dict.get("choices", [])
    )
    scope._response_id = response_dict.get("id")
    scope._response_model = response_dict.get("model") or request_model
    # Handle token usage including reasoning tokens and cached tokens
    usage = response_dict.get("usage", {})
    scope._input_tokens = usage.get("prompt_tokens", 0)
    scope._output_tokens = usage.get("completion_tokens", 0)
    scope._cache_read_input_tokens = (usage.get("prompt_tokens_details") or {}).get(
        "cached_tokens", 0
    ) or 0
    scope._cache_creation_input_tokens = (usage.get("input_tokens_details") or {}).get(
        "cache_creation_tokens", 0
    ) or 0
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._finish_reason = str(
        response_dict.get("choices", [])[0].get("finish_reason", "")
    )

    # Handle tool calls
    if scope._kwargs.get("tools"):
        scope._tools = (
            response_dict.get("choices", [{}])[0].get("message", {}).get("tool_calls")
        )
    else:
        scope._tools = None

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


def common_chat_rag_logic(
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
    Process RAG chat request and generate Telemetry
    """

    prompt = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("model", "jamba-1.5-mini")

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_AI21,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        False,
        scope._tbt,
        scope._ttft,
        version,
    )

    # RAG-specific span attributes
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RAG_MAX_SEGMENTS,
        scope._kwargs.get("max_segments", -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RAG_STRATEGY,
        scope._kwargs.get("retrieval_strategy", "segments"),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RAG_MAX_NEIGHBORS,
        scope._kwargs.get("max_neighbors", -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RAG_FILE_IDS, str(scope._kwargs.get("file_ids", ""))
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RAG_DOCUMENTS_PATH, scope._kwargs.get("path", "")
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RAG_SIMILARITY_THRESHOLD,
        scope._kwargs.get("retrieval_similarity_threshold", -1),
    )

    # Standard span attributes
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        scope._input_tokens + scope._output_tokens,
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

    # Handle tool calls
    if scope._kwargs.get("tools"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALLS,
            str(scope._choices[0].get("message", {}).get("tool_calls", "")),
        )

    # Content attributes
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt)
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES, scope._llmresponse
        )

        # To be removed once the change to span_attributes (from span events) is complete
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvention.GEN_AI_INPUT_MESSAGES: prompt,
            },
        )
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
            attributes={
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES: scope._llmresponse,
            },
        )

    scope._span.set_status(Status(StatusCode.OK))

    # Metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_AI21,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            scope._input_tokens,
            scope._output_tokens,
            cost,
            scope._tbt,
            scope._ttft,
        )


def process_chat_rag_response(
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
    Process RAG chat request and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span

    # Format input messages and calculate input tokens
    prompt = format_content(kwargs.get("messages", []))
    input_tokens = general_tokens(prompt)

    # Process response choices
    choices = response_dict.get("choices", [])
    aggregated_completion = []
    output_tokens = 0

    for i in range(kwargs.get("n", 1)):
        content = choices[i].get("content", "")
        aggregated_completion.append(content)
        output_tokens += general_tokens(content)

    scope._llmresponse = "".join(aggregated_completion)
    scope._response_id = response_dict.get("id", "")
    scope._response_model = request_model
    scope._input_tokens = input_tokens
    scope._output_tokens = output_tokens
    # Handle token usage including reasoning tokens and cached tokens
    usage = response_dict.get("usage", {})
    scope._cache_read_input_tokens = (usage.get("prompt_tokens_details") or {}).get(
        "cached_tokens", 0
    ) or 0
    scope._cache_creation_input_tokens = (usage.get("input_tokens_details") or {}).get(
        "cache_creation_tokens", 0
    ) or 0
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._finish_reason = ""
    scope._tools = None
    scope._choices = choices

    common_chat_rag_logic(
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
