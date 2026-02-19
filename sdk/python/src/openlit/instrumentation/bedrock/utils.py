"""
AWS Bedrock OpenTelemetry instrumentation utility functions
"""

import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    record_completion_metrics,
    common_span_attributes,
    handle_exception,
    otel_event,
)
from openlit.semcov import SemanticConvention


def format_content(messages):
    """
    Format the messages into a string for span events.
    """

    if not messages:
        return ""

    formatted_messages = []
    for message in messages:
        if isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", "")
        else:
            # Handle Bedrock object format
            role = getattr(message, "role", "user")
            content = getattr(message, "content", "")

        if isinstance(content, list):
            # Handle structured content (e.g., text + images)
            text_parts = []
            for part in content:
                if isinstance(part, dict):
                    # Bedrock format: {"text": "content"} or generic format: {"type": "text", "text": "content"}
                    if "text" in part:
                        text_parts.append(part.get("text", ""))
                    elif part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
            content = " ".join(text_parts)
        elif not isinstance(content, str):
            content = str(content)

        formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


def build_input_messages(messages):
    """
    Convert Bedrock messages to OTel input message structure.

    Args:
        messages: List of Bedrock message objects or dicts

    Returns:
        List of ChatMessage objects following OTel schema
    """
    structured_messages = []

    for message in messages:
        # Extract role and content
        if isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", [])
        else:
            # Handle Bedrock object format
            role = getattr(message, "role", "user")
            content = getattr(message, "content", [])

        # Ensure content is a list
        if isinstance(content, str):
            content = [{"text": content}]
        elif not isinstance(content, list):
            content = [{"text": str(content)}]

        # Build parts array
        parts = []
        for part in content:
            if isinstance(part, dict):
                # Handle text blocks
                if "text" in part:
                    parts.append({"type": "text", "content": part.get("text", "")})
                elif part.get("type") == "text":
                    parts.append({"type": "text", "content": part.get("text", "")})

                # Handle image blocks - only include if has URL (skip embedded bytes)
                elif "image" in part:
                    image_data = part.get("image", {})
                    source = image_data.get("source", {})
                    # Only include if URL-based, skip bytes
                    if "url" in source:
                        parts.append(
                            {
                                "type": "uri",
                                "modality": "image",
                                "uri": source.get("url"),
                            }
                        )

                # Handle document blocks - skip if has embedded bytes
                elif "document" in part:
                    document_data = part.get("document", {})
                    source = document_data.get("source", {})
                    # Only include if URL-based
                    if "url" in source:
                        parts.append(
                            {
                                "type": "uri",
                                "modality": "document",
                                "uri": source.get("url"),
                                "name": document_data.get("name", ""),
                            }
                        )

        if parts:
            structured_messages.append({"role": role, "parts": parts})

    return structured_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Bedrock response to OTel output message structure.

    Args:
        response_text: The text response from Bedrock
        finish_reason: Bedrock stopReason value
        tool_calls: Tool calls (reserved for future, currently None)

    Returns:
        List with single OutputMessage following OTel schema
    """
    parts = []

    # Add text content if present
    if response_text:
        parts.append({"type": "text", "content": response_text})

    # Add tool calls if present (future support)
    if tool_calls:
        for tool_call in tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tool_call.get("id", ""),
                    "name": tool_call.get("name", ""),
                    "arguments": tool_call.get("arguments", {}),
                }
            )

    # Map Bedrock finish reasons to OTel standard
    finish_reason_map = {
        "end_turn": "stop",
        "max_tokens": "max_tokens",
        "stop_sequence": "stop",
        "tool_use": "tool_calls",
        "content_filtered": "content_filter",
        "guardrail_intervention": "content_filter",
    }

    otel_finish_reason = finish_reason_map.get(finish_reason, finish_reason)

    return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}]


def build_tool_definitions(tools):
    """
    Extract tool definitions from Bedrock toolConfig.

    Args:
        tools: Bedrock tools array from toolConfig

    Returns:
        List of tool definition objects or None

    Note: Currently returns None as Bedrock tool instrumentation is not yet implemented.
          Reserved for future when tool support is added.
    """
    # Bedrock tool support not yet instrumented
    # Will be implemented when tool calls are added to instrumentation
    return None


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
    Centralized function to emit gen_ai.client.inference.operation.details event.

    Args:
        event_provider: The OTel event provider
        operation_name: Operation type (chat, completion, embedding, etc.)
        request_model: Model specified in request
        response_model: Model returned in response
        input_messages: Structured input messages
        output_messages: Structured output messages
        tool_definitions: Tool/function definitions
        server_address: API server address
        server_port: API server port
        **extra_attrs: Additional attributes (temperature, max_tokens, etc.)
    """
    try:
        if not event_provider:
            return

        # Build base attributes
        attributes = {
            SemanticConvention.GEN_AI_OPERATION_NAME: operation_name,
        }

        # Add model attributes
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model

        # Add server attributes
        if server_address:
            attributes["server.address"] = server_address
        if server_port:
            attributes["server.port"] = server_port

        # Add messages (only if not None/empty)
        if input_messages:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        # Add tool definitions (recommended)
        if tool_definitions:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        # Map extra attributes to semantic conventions
        attr_mapping = {
            "temperature": SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
            "max_tokens": SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
            "top_p": SemanticConvention.GEN_AI_REQUEST_TOP_P,
            "top_k": SemanticConvention.GEN_AI_REQUEST_TOP_K,
            "frequency_penalty": SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
            "presence_penalty": SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
            "stop_sequences": SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
            "seed": SemanticConvention.GEN_AI_REQUEST_SEED,
            "response_id": SemanticConvention.GEN_AI_RESPONSE_ID,
            "finish_reasons": SemanticConvention.GEN_AI_RESPONSE_FINISH_REASONS,
            "choice_count": SemanticConvention.GEN_AI_RESPONSE_CHOICE_COUNT,
            "output_type": SemanticConvention.GEN_AI_RESPONSE_OUTPUT_TYPE,
            "input_tokens": SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
            "output_tokens": SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
            "cache_creation_input_tokens": SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
            "cache_read_input_tokens": SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        }

        for key, value in extra_attrs.items():
            if value is not None and key in attr_mapping:
                attributes[attr_mapping[key]] = value

        # Create and emit event
        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",  # Per spec, all data in attributes
        )

        event_provider.emit(event)

    except Exception as e:
        import logging

        logger = logging.getLogger(__name__)
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def process_chunk(self, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.time()
    # Record the timestamp for the current chunk
    self._timestamps.append(end_time)

    if len(self._timestamps) == 1:
        # Calculate time to first chunk
        self._ttft = calculate_ttft(self._timestamps, self._start_time)

    chunked = response_as_dict(chunk)

    # Handle Bedrock messageStart event
    if "messageStart" in chunked:
        message_start = chunked.get("messageStart", {})
        self._response_role = message_start.get("role", "assistant")

    # Handle Bedrock contentBlockDelta event
    if "contentBlockDelta" in chunked:
        content_delta = chunked.get("contentBlockDelta", {})
        delta = content_delta.get("delta", {})
        if "text" in delta:
            self._llmresponse += delta.get("text", "")

    # Handle Bedrock messageStop event
    if "messageStop" in chunked:
        message_stop = chunked.get("messageStop", {})
        self._finish_reason = message_stop.get("stopReason", "")

    # Handle Bedrock metadata event (final event with usage info)
    if "metadata" in chunked:
        metadata = chunked.get("metadata", {})
        usage = metadata.get("usage", {})
        self._input_tokens = usage.get("inputTokens", 0)
        self._output_tokens = usage.get("outputTokens", 0)
        self._end_time = end_time


def common_chat_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    llm_config,
    is_stream,
    event_provider=None,
):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    formatted_messages = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("modelId", "amazon.titan-text-express-v1")

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
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

    # Bedrock-specific attributes from llm_config
    bedrock_attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "frequencyPenalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "maxTokens"),
        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, "presencePenalty"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stopSequences"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "topP"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "topK"),
    ]

    # Set each bedrock-specific attribute if the corresponding value exists and is not None
    for attribute, key in bedrock_attributes:
        value = llm_config.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Cost and Tokens
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

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, formatted_messages
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES, scope._llmresponse
        )

        # Emit OTel log event
        if event_provider:
            try:
                # Build structured messages
                input_msgs = build_input_messages(scope._kwargs.get("messages", []))
                output_msgs = build_output_messages(
                    scope._llmresponse,
                    scope._finish_reason,
                    tool_calls=None,  # No tool support yet
                )
                # pylint: disable=assignment-from-none
                tool_defs = build_tool_definitions(
                    scope._kwargs.get("toolConfig", {}).get("tools")
                )

                # Extract inferenceConfig parameters
                inference_config = llm_config or {}

                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=tool_defs,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    response_id=scope._response_id if scope._response_id else None,
                    finish_reasons=[scope._finish_reason],
                    temperature=inference_config.get("temperature"),
                    max_tokens=inference_config.get("maxTokens"),
                    top_p=inference_config.get("topP"),
                    top_k=inference_config.get("topK"),
                    stop_sequences=inference_config.get("stopSequences"),
                    input_tokens=scope._input_tokens,
                    output_tokens=scope._output_tokens,
                )
            except Exception as e:
                import logging

                logger = logging.getLogger(__name__)
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
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


def process_streaming_chat_response(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content=False,
    disable_metrics=False,
    version="",
    llm_config=None,
    event_provider=None,
):
    """
    Process streaming chat response and generate telemetry.
    """

    try:
        if llm_config is None:
            llm_config = {}

        common_chat_logic(
            scope,
            pricing_info,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            llm_config,
            is_stream=True,
            event_provider=event_provider,
        )
    except Exception as e:
        handle_exception(scope._span, e)
        raise


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
    llm_config=None,
    event_provider=None,
    **kwargs,
):
    """
    Process non-streaming chat response and generate telemetry.
    """

    try:
        if llm_config is None:
            llm_config = {}

        scope = type("GenericScope", (), {})()
        response_dict = response_as_dict(response)

        scope._start_time = start_time
        scope._end_time = time.time()
        scope._span = span
        scope._llmresponse = (
            response_dict.get("output", {})
            .get("message", {})
            .get("content", [{}])[0]
            .get("text", "")
        )
        scope._response_role = (
            response_dict.get("output", {}).get("message", {}).get("role", "assistant")
        )
        scope._input_tokens = response_dict.get("usage", {}).get("inputTokens", 0)
        scope._output_tokens = response_dict.get("usage", {}).get("outputTokens", 0)
        scope._response_model = request_model
        scope._finish_reason = response_dict.get("stopReason", "")
        scope._response_id = response_dict.get("RequestId", "")
        scope._timestamps = []
        scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
        scope._server_address, scope._server_port = server_address, server_port
        scope._kwargs = kwargs

        common_chat_logic(
            scope,
            pricing_info,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            llm_config,
            is_stream=False,
            event_provider=event_provider,
        )

        return response
    except Exception as e:
        handle_exception(span, e)
        raise
