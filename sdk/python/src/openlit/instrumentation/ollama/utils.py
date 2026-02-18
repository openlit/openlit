"""
Ollama OpenTelemetry instrumentation utility functions
"""

import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    general_tokens,
    get_chat_model_cost,
    get_embed_model_cost,
    create_metrics_attributes,
    common_span_attributes,
    record_completion_metrics,
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
    Convert Ollama messages to OTel input message structure.
    Ollama uses OpenAI-compatible message format.
    """
    structured_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        parts = []
        content = msg.get("content", "")

        if isinstance(content, str):
            parts.append({"type": "text", "content": content})
        elif isinstance(content, list):
            for part in content:
                if part.get("type") == "text":
                    parts.append({"type": "text", "content": part.get("text", "")})
                elif part.get("type") == "image_url":
                    image_url = part.get("image_url", {}).get("url", "")
                    if not image_url.startswith("data:"):
                        parts.append(
                            {"type": "uri", "modality": "image", "uri": image_url}
                        )

        # Handle tool calls
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

        # Handle tool responses
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
    Convert Ollama response to OTel output message structure.
    Maps Ollama finish reasons to OTel standard.
    """
    parts = []
    if response_text:
        parts.append({"type": "text", "content": response_text})

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

    # Ollama uses done_reason field - map to OTel standard
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
    Extract tool definitions from Ollama request.
    Returns tool definitions or None if not present.
    """
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
    Uses Ollama-specific defaults (localhost:11434).
    """
    try:
        if not event_provider:
            return

        attributes = {SemanticConvention.GEN_AI_OPERATION_NAME: operation_name}

        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model
        if server_address:
            attributes["server.address"] = server_address
        if server_port:
            attributes["server.port"] = server_port
        if input_messages:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages
        if tool_definitions:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        # Map extra attributes to semantic conventions
        attr_mapping = {
            "response_id": SemanticConvention.GEN_AI_RESPONSE_ID,
            "finish_reasons": SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
            "temperature": SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
            "max_tokens": SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
            "top_p": SemanticConvention.GEN_AI_REQUEST_TOP_P,
            "top_k": SemanticConvention.GEN_AI_REQUEST_TOP_K,
            "repeat_penalty": SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
            "input_tokens": SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
            "output_tokens": SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
        }

        for key, value in extra_attrs.items():
            if value is not None and key in attr_mapping:
                attributes[attr_mapping[key]] = value

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
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

    end_time = time.monotonic()
    # Record the timestamp for the current chunk
    self._timestamps.append(end_time)

    if len(self._timestamps) == 1:
        # Calculate time to first chunk
        self._ttft = calculate_ttft(self._timestamps, self._start_time)

    chunked = response_as_dict(chunk)
    self._llmresponse += chunked.get("message", {}).get("content", "")

    if chunked.get("message", {}).get("tool_calls"):
        self._tools = chunked["message"]["tool_calls"]

    if chunked.get("eval_count"):
        self._response_role = chunked.get("message", {}).get("role", "")
        self._input_tokens = chunked.get("prompt_eval_count", 0)
        self._output_tokens = chunked.get("eval_count", 0)
        self._response_model = chunked.get("model", "")
        self._finish_reason = chunked.get("done_reason", "")


def record_embedding_metrics(
    metrics,
    gen_ai_operation,
    gen_ai_system,
    server_address,
    server_port,
    request_model,
    response_model,
    environment,
    application_name,
    start_time,
    end_time,
    cost,
    input_tokens,
):
    """
    Record embedding metrics for the operation.
    """

    attributes = create_metrics_attributes(
        operation=gen_ai_operation,
        system=gen_ai_system,
        server_address=server_address,
        server_port=server_port,
        request_model=request_model,
        response_model=response_model,
        service_name=application_name,
        deployment_environment=environment,
    )
    metrics["genai_client_usage_tokens"].record(input_tokens, attributes)
    metrics["genai_client_operation_duration"].record(end_time - start_time, attributes)
    metrics["genai_requests"].add(1, attributes)
    metrics["genai_prompt_tokens"].add(input_tokens, attributes)
    metrics["genai_cost"].record(cost, attributes)


def common_chat_logic(
    scope,
    gen_ai_endpoint,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.monotonic()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)
    json_body = scope._kwargs.get("json", {}) or {}
    messages = json_body.get("messages", scope._kwargs.get("messages", ""))
    prompt = format_content(messages)
    request_model = json_body.get("model") or scope._kwargs.get("model", "llama3.2")
    is_stream = scope._kwargs.get("stream", False)

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    options = json_body.get("options", scope._kwargs.get("options", {}))
    attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "repeat_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_SEED, "seed"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]
    for attribute, key in attributes:
        value = options.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
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

    # Span Attributes for Tools
    if scope._tools is not None:
        if isinstance(scope._tools, dict):
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_NAME, scope._tools.get("function", "")
            ).get("name", "")
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID, str(scope._tools.get("id", ""))
            )
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_ARGS,
                str(scope._tools.get("function", "").get("arguments", "")),
            )
        elif isinstance(scope._tools, list) and len(scope._tools) > 0:
            for tool in scope._tools:
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_NAME,
                    tool.get("function", {}).get("name", ""),
                )
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tool.get("id", ""))
                )
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_ARGS,
                    str(tool.get("function", {}).get("arguments", "")),
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
                json_body = scope._kwargs.get("json", {}) or {}
                input_msgs = build_input_messages(
                    json_body.get("messages", scope._kwargs.get("messages", []))
                )
                output_msgs = build_output_messages(
                    scope._llmresponse, scope._finish_reason, scope._tools
                )
                tool_defs = build_tool_definitions(
                    json_body.get("tools", scope._kwargs.get("tools"))
                )

                # Extract options for parameters
                options = json_body.get("options", scope._kwargs.get("options", {}))

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
                    finish_reasons=[scope._finish_reason],
                    temperature=options.get("temperature"),
                    max_tokens=options.get("max_tokens"),
                    top_p=options.get("top_p"),
                    top_k=options.get("top_k"),
                    repeat_penalty=options.get("repeat_penalty"),
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
            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
            scope._input_tokens,
            scope._output_tokens,
            scope._tbt,
            scope._ttft,
        )


def common_generate_logic(
    scope,
    gen_ai_endpoint,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Process generate request and generate Telemetry
    """

    scope._end_time = time.monotonic()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)
    json_body = scope._kwargs.get("json", {}) or {}
    prompt = json_body.get("prompt")
    request_model = json_body.get("model") or scope._kwargs.get("model", "llama3.2")
    is_stream = scope._kwargs.get("stream", False)

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    options = json_body.get("options", scope._kwargs.get("options", {}))
    attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "repeat_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_SEED, "seed"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]
    for attribute, key in attributes:
        value = options.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
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

    # Span Attributes for Tools
    if scope._tools is not None:
        if isinstance(scope._tools, dict):
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_NAME, scope._tools.get("function", "")
            ).get("name", "")
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID, str(scope._tools.get("id", ""))
            )
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_ARGS,
                str(scope._tools.get("function", "").get("arguments", "")),
            )
        elif isinstance(scope._tools, list) and len(scope._tools) > 0:
            for tool in scope._tools:
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_NAME,
                    tool.get("function", {}).get("name", ""),
                )
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tool.get("id", ""))
                )
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_ARGS,
                    str(tool.get("function", {}).get("arguments", "")),
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
                json_body = scope._kwargs.get("json", {}) or {}

                # For generate operation, input is a prompt string, not messages
                input_msgs = [
                    {"role": "user", "parts": [{"type": "text", "content": prompt}]}
                ]
                output_msgs = build_output_messages(
                    scope._llmresponse, scope._finish_reason, scope._tools
                )
                tool_defs = build_tool_definitions(
                    json_body.get("tools", scope._kwargs.get("tools"))
                )

                # Extract options for parameters
                options = json_body.get("options", scope._kwargs.get("options", {}))

                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=tool_defs,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    finish_reasons=[scope._finish_reason],
                    temperature=options.get("temperature"),
                    max_tokens=options.get("max_tokens"),
                    top_p=options.get("top_p"),
                    top_k=options.get("top_k"),
                    repeat_penalty=options.get("repeat_penalty"),
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
            SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
            scope._input_tokens,
            scope._output_tokens,
            scope._tbt,
            scope._ttft,
        )


def common_embedding_logic(
    scope,
    gen_ai_endpoint,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Process embedding request and generate Telemetry
    """

    json_body = scope._kwargs.get("json", {}) or {}
    request_model = json_body.get("model") or scope._kwargs.get("model", "llama3.2")
    prompt_val = json_body.get("prompt", scope._kwargs.get("prompt", ""))
    input_tokens = general_tokens(str(prompt_val))
    is_stream = False  # Ollama embeddings are not streaming

    cost = get_embed_model_cost(request_model, pricing_info, input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Embedding-specific parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens
    )

    # Span Attributes for Cost
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, prompt_val)

        # Emit OTel log event
        if event_provider:
            try:
                # For embeddings, input is text strings, output is empty
                if isinstance(prompt_val, str):
                    input_text = [prompt_val]
                elif isinstance(prompt_val, list):
                    input_text = prompt_val
                else:
                    input_text = [str(prompt_val)]

                # Create simple text input messages
                input_msgs = [
                    {"role": "user", "parts": [{"type": "text", "content": text}]}
                    for text in input_text
                ]

                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                    request_model=request_model,
                    response_model=request_model,
                    input_messages=input_msgs,
                    output_messages=[],  # Embeddings don't have text output
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    input_tokens=input_tokens,
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
            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
            input_tokens,
        )


def process_streaming_chat_response(
    self,
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
        self,
        "ollama.chat",
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider,
    )


def process_chat_response(
    response,
    gen_ai_endpoint,
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

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.monotonic()
    scope._span = span
    scope._llmresponse = response_dict.get("message", {}).get("content", "")
    scope._response_role = response_dict.get("message", {}).get("role", "assistant")
    scope._input_tokens = response_dict.get("prompt_eval_count", 0)
    scope._output_tokens = response_dict.get("eval_count", 0)
    scope._response_model = response_dict.get("model", "llama3.2")
    scope._finish_reason = response_dict.get("done_reason", "")
    scope._timestamps = []
    scope._ttft = scope._end_time - scope._start_time
    scope._tbt = 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    if scope._kwargs.get("tools"):
        scope._tools = response_dict.get("choices")[0].get("message").get("tool_calls")
    else:
        scope._tools = None

    common_chat_logic(
        scope,
        gen_ai_endpoint,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider,
    )

    return response


def process_streaming_generate_response(
    self,
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
    Process streaming generate request and generate Telemetry
    """

    common_generate_logic(
        self,
        "ollama.generate",
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider,
    )


def process_generate_response(
    response,
    gen_ai_endpoint,
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
    Process generate request and generate Telemetry
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.monotonic()
    scope._span = span
    scope._llmresponse = response_dict.get("response", "")
    scope._response_role = response_dict.get("message", {}).get("role", "assistant")
    scope._input_tokens = response_dict.get("prompt_eval_count", 0)
    scope._output_tokens = response_dict.get("eval_count", 0)
    scope._response_model = response_dict.get("model", "llama3.2")
    scope._finish_reason = response_dict.get("done_reason", "")
    scope._timestamps = []
    scope._ttft = scope._end_time - scope._start_time
    scope._tbt = 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    if scope._kwargs.get("tools"):
        scope._tools = response_dict.get("choices")[0].get("message").get("tool_calls")
    else:
        scope._tools = None

    common_generate_logic(
        scope,
        gen_ai_endpoint,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider,
    )

    return response


def process_embedding_response(
    response,
    gen_ai_endpoint,
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

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.monotonic()
    scope._span = span
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    # Initialize streaming and timing values for Ollama embeddings
    scope._response_model = kwargs.get("model", "llama3.2")
    scope._tbt = 0.0
    scope._ttft = scope._end_time - scope._start_time

    common_embedding_logic(
        scope,
        gen_ai_endpoint,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider,
    )

    return response
