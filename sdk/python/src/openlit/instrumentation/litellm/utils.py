"""
LiteLLM OpenTelemetry instrumentation utility functions
"""

import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    get_embed_model_cost,
    common_span_attributes,
    record_completion_metrics,
    record_embedding_metrics,
    otel_event,
)
from openlit.semcov import SemanticConvention


def format_content(messages):
    """
    Process a list of messages to extract content.
    """

    formatted_messages = []
    for message in messages:
        role = message["role"]
        content = message["content"]

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


def build_input_messages(messages):
    """
    Convert LiteLLM messages (OpenAI-compatible format) to OTel input message structure.

    Args:
        messages: List of message objects from LiteLLM request

    Returns:
        List of ChatMessage objects following OTel schema
    """
    structured_messages = []

    for msg in messages:
        # Extract role
        role = msg.get("role", "user")

        # Build parts array
        parts = []
        content = msg.get("content", "")

        if isinstance(content, str):
            # Simple text content
            parts.append({"type": "text", "content": content})
        elif isinstance(content, list):
            # Multi-part content (text, images, etc.)
            for part in content:
                if part.get("type") == "text":
                    parts.append({"type": "text", "content": part.get("text", "")})
                elif part.get("type") == "image_url":
                    image_url = part.get("image_url", {}).get("url", "")
                    # Skip data URIs for privacy
                    if not image_url.startswith("data:"):
                        parts.append(
                            {"type": "uri", "modality": "image", "uri": image_url}
                        )

        # Handle tool calls (for assistant messages)
        if "tool_calls" in msg:
            for tool_call in msg.get("tool_calls", []):
                parts.append(
                    {
                        "type": "tool_call",
                        "id": tool_call.get("id", ""),
                        "name": tool_call.get("function", {}).get("name", ""),
                        "arguments": tool_call.get("function", {}).get("arguments", {}),
                    }
                )

        # Handle tool responses (for tool role)
        if role == "tool" and "tool_call_id" in msg:
            parts.append(
                {
                    "type": "tool_call_response",
                    "id": msg.get("tool_call_id", ""),
                    "response": content,
                }
            )

        if parts:
            structured_messages.append({"role": role, "parts": parts})

    return structured_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert LiteLLM response to OTel output message structure.

    Args:
        response_text: The text response
        finish_reason: LiteLLM finish reason value
        tool_calls: Tool calls from response

    Returns:
        List with single OutputMessage following OTel schema
    """
    parts = []

    # Add text content if present
    if response_text:
        parts.append({"type": "text", "content": response_text})

    # Add tool calls if present
    if tool_calls:
        for tool_call in tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tool_call.get("id", ""),
                    "name": tool_call.get("function", {}).get("name", ""),
                    "arguments": tool_call.get("function", {}).get("arguments", {}),
                }
            )

    # Map LiteLLM finish reasons to OTel standard
    finish_reason_map = {
        "stop": "stop",
        "length": "max_tokens",
        "tool_calls": "tool_calls",
        "content_filter": "content_filter",
    }

    otel_finish_reason = finish_reason_map.get(finish_reason, finish_reason)

    return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}]


def build_tool_definitions(tools):
    """
    Extract tool definitions from request.

    Args:
        tools: LiteLLM tools array (OpenAI-compatible format)

    Returns:
        List of tool definition objects or None
    """
    # LiteLLM uses OpenAI-compatible tool format
    # Direct pass-through
    return tools if tools else None


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
    if len(chunked.get("choices", [])) > 0 and (
        "delta" in chunked.get("choices")[0]
        and "content" in chunked.get("choices")[0].get("delta", {})
    ):
        content = chunked.get("choices")[0].get("delta").get("content")
        if content:
            scope._llmresponse += content

        # Handle tool calls in streaming - optimized
        delta_tools = chunked.get("choices", [{}])[0].get("delta", {}).get("tool_calls")
        if delta_tools:
            scope._tools = scope._tools or []

            for tool in delta_tools:
                idx = tool.get("index", 0)

                # Extend list if needed
                scope._tools.extend([{}] * (idx + 1 - len(scope._tools)))

                if tool.get("id"):  # New tool (id exists)
                    func = tool.get("function", {})
                    scope._tools[idx] = {
                        "id": tool["id"],
                        "function": {
                            "name": func.get("name", ""),
                            "arguments": func.get("arguments", ""),
                        },
                        "type": tool.get("type", "function"),
                    }
                elif (
                    scope._tools[idx] and "function" in tool
                ):  # Append args (id is None)
                    scope._tools[idx]["function"]["arguments"] += tool["function"].get(
                        "arguments", ""
                    )

    if chunked.get("usage"):
        scope._input_tokens = chunked.get("usage").get("prompt_tokens", 0)
        scope._output_tokens = chunked.get("usage").get("completion_tokens", 0)
        scope._response_id = chunked.get("id")
        scope._response_model = chunked.get("model")
        finish_reason = chunked.get("choices", [{}])[0].get("finish_reason")
        # Only update finish_reason if it's not None (preserve previous valid value)
        if finish_reason is not None:
            scope._finish_reason = finish_reason
        scope._response_service_tier = str(chunked.get("system_fingerprint", ""))
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

    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    prompt = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("model", "openai/gpt-4o")

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_LITELLM,
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

    # Helper function to handle None values with proper defaults
    def safe_get(value, default):
        return default if value is None else value

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SEED, safe_get(scope._kwargs.get("seed"), "")
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        safe_get(scope._kwargs.get("frequency_penalty"), 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        safe_get(scope._kwargs.get("max_tokens"), -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        safe_get(scope._kwargs.get("presence_penalty"), 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, scope._kwargs.get("stop", [])
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        safe_get(scope._kwargs.get("temperature"), 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P,
        safe_get(scope._kwargs.get("top_p"), 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_USER, safe_get(scope._kwargs.get("user"), "")
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SERVICE_TIER,
        safe_get(scope._kwargs.get("service_tier"), "auto"),
    )

    # Span Attributes for Response parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason or ""]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_SERVICE_TIER, scope._response_service_tier
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT,
        scope._response_service_tier,
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

    # Span Attributes for Tools - optimized
    if scope._tools:
        tools = scope._tools if isinstance(scope._tools, list) else [scope._tools]

        names, ids, args = (
            zip(
                *[
                    (
                        t.get("function", {}).get("name", ""),
                        str(t.get("id", "")),
                        str(t.get("function", {}).get("arguments", "")),
                    )
                    for t in tools
                    if isinstance(t, dict) and t
                ]
            )
            if tools
            else ([], [], [])
        )

        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, ", ".join(filter(None, names))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, ", ".join(filter(None, ids))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, ", ".join(filter(None, args))
        )

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt)
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_CONTENT_COMPLETION, scope._llmresponse
        )

        # Emit OTel log event
        if event_provider:
            try:
                input_msgs = build_input_messages(scope._kwargs.get("messages", []))
                output_msgs = build_output_messages(
                    scope._llmresponse, scope._finish_reason, scope._tools
                )
                tool_defs = build_tool_definitions(scope._kwargs.get("tools"))

                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=tool_defs,
                    server_address="api.litellm.ai",
                    server_port=443,
                    response_id=scope._response_id,
                    finish_reasons=[scope._finish_reason],
                    temperature=scope._kwargs.get("temperature"),
                    max_tokens=scope._kwargs.get("max_tokens"),
                    top_p=scope._kwargs.get("top_p"),
                    frequency_penalty=scope._kwargs.get("frequency_penalty"),
                    presence_penalty=scope._kwargs.get("presence_penalty"),
                    input_tokens=scope._input_tokens,
                    output_tokens=scope._output_tokens,
                )
            except Exception as e:
                import logging

                logger = logging.getLogger(__name__)
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_LITELLM,
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
    scope._input_tokens = response_dict.get("usage", {}).get("prompt_tokens", 0)
    scope._output_tokens = response_dict.get("usage", {}).get("completion_tokens", 0)
    scope._response_id = response_dict.get("id")
    scope._response_model = response_dict.get("model")
    scope._finish_reason = str(
        response_dict.get("choices", [])[0].get("finish_reason", "")
    )
    scope._response_service_tier = str(response_dict.get("system_fingerprint", ""))
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

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
    event_provider=None,
    **kwargs,
):
    """
    Process embedding request and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._input_tokens = response_dict.get("usage", {}).get("prompt_tokens", 0)
    scope._response_model = response_dict.get("model")
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    # Calculate cost of the operation
    cost = get_embed_model_cost(request_model, pricing_info, scope._input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_LITELLM,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        False,
        0,
        scope._end_time - scope._start_time,
        version,
    )

    # Helper function to handle None values with proper defaults
    def safe_get(value, default):
        return default if value is None else value

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS,
        [scope._kwargs.get("encoding_format", "float")],
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_USER, safe_get(scope._kwargs.get("user"), "")
    )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_CONTENT_PROMPT,
            str(scope._kwargs.get("input", "")),
        )

        # Emit OTel log event
        if event_provider:
            try:
                # For embeddings, input is text strings, output is empty
                input_text = scope._kwargs.get("input", [])
                if isinstance(input_text, str):
                    input_text = [input_text]

                # Create simple text input messages
                input_msgs = [
                    {"role": "user", "parts": [{"type": "text", "content": text}]}
                    for text in input_text
                ]

                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=[],  # Embeddings don't have text output
                    tool_definitions=None,
                    server_address="api.litellm.ai",
                    server_port=443,
                    response_id=None,
                    input_tokens=scope._input_tokens,
                )
            except Exception as e:
                import logging

                logger = logging.getLogger(__name__)
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Metrics
    if not disable_metrics:
        record_embedding_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            SemanticConvention.GEN_AI_SYSTEM_LITELLM,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            scope._input_tokens,
            cost,
        )

    return response
