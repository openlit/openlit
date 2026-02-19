"""
Sarvam AI OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    record_completion_metrics,
    common_span_attributes,
    common_framework_span_attributes,
    otel_event,
    get_audio_model_cost,
    record_audio_metrics,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(messages):
    """
    Formats the given messages into a single string.

    Args:
        messages: A list of message dictionaries containing 'role' and 'content' keys.

    Returns:
        A formatted string representing the messages.
    """
    formatted_messages = []
    for message in messages:
        role = message.get("role", "unknown")
        content = message.get("content", "")
        formatted_messages.append(f"{role}: {content}")
    return "\n".join(formatted_messages)


def build_input_messages(messages):
    """
    Convert Sarvam request messages to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    if not messages:
        return []
    result = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if isinstance(content, list):
            parts = [
                {
                    "type": p.get("type", "text"),
                    "content": p.get("text", p.get("content", "")),
                }
                for p in content
            ]
        else:
            parts = [{"type": "text", "content": str(content) if content else ""}]
        result.append({"role": role, "parts": parts})
    return result


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Sarvam response to OTel output message structure.
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
    Processes a streaming chunk from Sarvam AI API response.

    Args:
        scope: The scope object containing span and response data.
        chunk: Individual chunk from the streaming response.
    """
    current_time = time.time()

    # Calculate TTFT for the first chunk
    if len(scope._timestamps) == 0:
        scope._ttft = calculate_ttft(scope._start_time, current_time)

    scope._timestamps.append(current_time)

    # Extract and accumulate response data from chunk
    if hasattr(chunk, "choices") and len(chunk.choices) > 0:
        choice = chunk.choices[0]

        if (
            hasattr(choice, "delta")
            and hasattr(choice.delta, "content")
            and choice.delta.content
        ):
            scope._llmresponse += choice.delta.content

        if hasattr(choice, "finish_reason") and choice.finish_reason:
            scope._finish_reason = choice.finish_reason

    # Extract usage information if available
    if hasattr(chunk, "usage") and chunk.usage:
        if hasattr(chunk.usage, "prompt_tokens"):
            scope._input_tokens = chunk.usage.prompt_tokens
        if hasattr(chunk.usage, "completion_tokens"):
            scope._output_tokens = chunk.usage.completion_tokens
        if hasattr(scope, "_cache_read_input_tokens"):
            pt_details = getattr(chunk.usage, "prompt_tokens_details", None)
            if pt_details and getattr(pt_details, "cached_tokens", None) is not None:
                scope._cache_read_input_tokens = pt_details.cached_tokens
        if hasattr(scope, "_cache_creation_input_tokens"):
            cache_creation = getattr(chunk.usage, "cache_creation_input_tokens", None)
            if cache_creation is not None:
                scope._cache_creation_input_tokens = cache_creation

    # Extract response ID and model if available
    if hasattr(chunk, "id"):
        scope._response_id = chunk.id
    if hasattr(chunk, "model"):
        scope._response_model = chunk.model


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
    Process chat request and generate Telemetry.
    """
    scope._end_time = time.time()

    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    request_model = scope._kwargs.get("model", "sarvam-m")
    input_tokens = getattr(scope, "_input_tokens", 0)
    output_tokens = getattr(scope, "_output_tokens", 0)

    # Compute cost
    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_SARVAM,
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

    # Sarvam-specific parameters
    if scope._kwargs.get("reasoning_effort"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_REASONING_EFFORT,
            scope._kwargs.get("reasoning_effort"),
        )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        scope._kwargs.get("max_tokens", -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        scope._kwargs.get("stop", []),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        scope._kwargs.get("temperature", 0.2),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P,
        scope._kwargs.get("top_p", 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        scope._kwargs.get("frequency_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        scope._kwargs.get("presence_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
        scope._kwargs.get("stream", False),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_WIKI_GROUNDING,
        scope._kwargs.get("wiki_grounding", False),
    )
    if scope._kwargs.get("seed") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_SEED, scope._kwargs.get("seed")
        )
    n_choices = scope._kwargs.get("n", 1)
    if n_choices != 1:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, int(n_choices)
        )

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    finish_reason = getattr(scope, "_finish_reason", None) or "stop"
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    # (Sarvam chat API may not expose tool_calls; omit or no-op if not present)
    if getattr(scope, "_tools", None):
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
    input_msgs = build_input_messages(scope._kwargs.get("messages", []))
    output_msgs = build_output_messages(
        scope._llmresponse,
        getattr(scope, "_finish_reason", None),
        getattr(scope, "_tools", None),
    )
    _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
    if capture_message_content and event_provider:
        extra = {
            "response_id": getattr(scope, "_response_id", None),
            "finish_reasons": [finish_reason],
            "output_type": "text" if isinstance(scope._llmresponse, str) else "json",
            "temperature": scope._kwargs.get("temperature"),
            "max_tokens": scope._kwargs.get("max_tokens"),
            "top_p": scope._kwargs.get("top_p"),
            "frequency_penalty": scope._kwargs.get("frequency_penalty"),
            "presence_penalty": scope._kwargs.get("presence_penalty"),
            "stop_sequences": scope._kwargs.get("stop"),
            "seed": scope._kwargs.get("seed"),
            "choice_count": scope._kwargs.get("n", 1),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_read_input_tokens": getattr(scope, "_cache_read_input_tokens", 0),
            "cache_creation_input_tokens": getattr(
                scope, "_cache_creation_input_tokens", 0
            ),
        }
        emit_inference_event(
            event_provider,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            request_model,
            getattr(scope, "_response_model", request_model),
            input_messages=input_msgs,
            output_messages=output_msgs,
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
            SemanticConvention.GEN_AI_SYSTEM_SARVAM,
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
        )


def process_streaming_chat_response(
    scope,
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
    Processes streaming chat response from Sarvam AI API.
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
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
    **kwargs,
):
    """
    Processes non-streaming chat response from Sarvam AI API.
    """
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._server_address = server_address
    scope._server_port = server_port
    scope._kwargs = kwargs
    scope._timestamps = []
    scope._tbt = 0
    scope._ttft = 0

    scope._llmresponse = ""
    scope._response_id = ""
    scope._response_model = request_model
    scope._finish_reason = ""
    scope._input_tokens = 0
    scope._output_tokens = 0

    response_dict = response_as_dict(response)

    if response_dict.get("choices") and len(response_dict["choices"]) > 0:
        choice = response_dict["choices"][0]
        if choice.get("message") and choice["message"].get("content"):
            scope._llmresponse = choice["message"]["content"]
        if choice.get("finish_reason"):
            scope._finish_reason = choice["finish_reason"]

    if response_dict.get("usage"):
        usage = response_dict["usage"]
        scope._input_tokens = usage.get("prompt_tokens", 0)
        scope._output_tokens = usage.get("completion_tokens", 0)

    # Handle token usage including reasoning tokens and cached tokens
    usage = response_dict.get("usage", {})
    prompt_tokens_details = usage.get("prompt_tokens_details", {})
    scope._cache_read_input_tokens = prompt_tokens_details.get("cached_tokens", 0)
    scope._cache_creation_input_tokens = (
        usage.get("cache_creation_input_tokens", 0) or 0
    )

    if response_dict.get("id"):
        scope._response_id = response_dict["id"]
    if response_dict.get("model"):
        scope._response_model = response_dict["model"]

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


def process_translate_response(
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
    capture_message_content,
    disable_metrics,
    version,
    **kwargs,
):
    """
    Processes translation response from Sarvam AI API.

    Args:
        response: The API response object.
        request_model: The model used for the request.
        pricing_info: Information about model pricing.
        server_port: The server port.
        server_address: The server address.
        environment: The environment name.
        application_name: The application name.
        metrics: Metrics collection object.
        start_time: The request start time.
        span: The OpenTelemetry span.
        capture_message_content: Whether to capture message content.
        disable_metrics: Whether to disable metrics collection.
        version: The version of the instrumentation.
        **kwargs: Additional keyword arguments.

    Returns:
        The processed response object.
    """
    end_time = time.time()
    response_dict = response_as_dict(response)

    # Create scope object for common framework attributes
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    # Common Framework Span Attributes
    common_framework_span_attributes(
        scope=scope,
        framework_system=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
        server_address=server_address,
        server_port=server_port,
        environment=environment,
        application_name=application_name,
        version=version,
        endpoint=SemanticConvention.GEN_AI_OPERATION_TYPE_TRANSLATE,
    )

    # Set specific attributes for translation
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )

    # Translation-specific request attributes (with API defaults)
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLATE_SOURCE_LANGUAGE,
        kwargs.get("source_language_code", ""),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLATE_TARGET_LANGUAGE,
        kwargs.get("target_language_code", ""),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLATE_MODE,
        kwargs.get("mode", "formal"),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLATE_ENABLE_PREPROCESSING,
        kwargs.get("enable_preprocessing", False),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLATE_NUMERALS_FORMAT,
        kwargs.get("numerals_format", "international"),  # API default
    )

    # Optional translation attributes (only set if provided)
    if kwargs.get("speaker_gender"):
        span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TRANSLATE_SPEAKER_GENDER,
            kwargs.get("speaker_gender"),
        )
    if kwargs.get("output_script"):
        span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TRANSLATE_OUTPUT_SCRIPT,
            kwargs.get("output_script"),
        )

    # Translation response attributes
    if response_dict.get("translated_text"):
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            response_dict.get("translated_text"),
        )

    if response_dict.get("request_id"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID,
            response_dict.get("request_id"),
        )

    if response_dict.get("source_language_code"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_TRANSLATE_SOURCE_LANGUAGE,
            response_dict.get("source_language_code"),
        )

    # Set content attributes if capture is enabled
    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, kwargs.get("input", "")
        )

    span.set_status(Status(StatusCode.OK))

    # Record metrics for translation
    if not disable_metrics:
        # Calculate cost based on input/output text for translation
        input_text = kwargs.get("input", "")
        output_text = response_dict.get("translated_text", "")
        cost = get_chat_model_cost(
            request_model, pricing_info, len(input_text), len(output_text)
        )

        record_completion_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_TRANSLATE,
            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
            server_address=server_address,
            server_port=server_port,
            request_model=request_model,
            response_model=request_model,
            environment=environment,
            application_name=application_name,
            start_time=start_time,
            end_time=end_time,
            cost=cost,
            input_tokens=len(input_text),
            output_tokens=len(output_text),
            tbt=0,
            ttft=0,
        )

    return response


def process_speech_to_text_response(
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
    capture_message_content,
    disable_metrics,
    version,
    **kwargs,
):
    """
    Processes speech-to-text response from Sarvam AI API.

    Args:
        response: The API response object.
        request_model: The model used for the request.
        pricing_info: Information about model pricing.
        server_port: The server port.
        server_address: The server address.
        environment: The environment name.
        application_name: The application name.
        metrics: Metrics collection object.
        start_time: The request start time.
        span: The OpenTelemetry span.
        capture_message_content: Whether to capture message content.
        disable_metrics: Whether to disable metrics collection.
        version: The version of the instrumentation.
        **kwargs: Additional keyword arguments.

    Returns:
        The processed response object.
    """
    end_time = time.time()
    response_dict = response_as_dict(response)

    # Create scope object for common framework attributes
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    # Common Framework Span Attributes
    common_framework_span_attributes(
        scope=scope,
        framework_system=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
        server_address=server_address,
        server_port=server_port,
        environment=environment,
        application_name=application_name,
        version=version,
        endpoint=SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT,
    )

    # Set specific attributes for speech-to-text
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )

    # Speech-to-text request attributes (with API defaults)
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SPEECH_LANGUAGE_CODE,
        kwargs.get(
            "language_code", "unknown"
        ),  # API allows "unknown" for auto-detection
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SPEECH_WITH_TIMESTAMPS,
        kwargs.get("with_timestamps", False),  # API default
    )

    # Optional speech-to-text attributes (only set if provided)
    if kwargs.get("prompt"):
        span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_SPEECH_PROMPT, kwargs.get("prompt")
        )

    # Speech-to-text response attributes
    if response_dict.get("transcript"):
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            response_dict.get("transcript"),
        )

    if response_dict.get("request_id"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID,
            response_dict.get("request_id"),
        )

    if response_dict.get("language_code"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SPEECH_DETECTED_LANGUAGE,
            response_dict.get("language_code"),
        )

    # Optional response attributes (only set if present)
    if response_dict.get("timestamps"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SPEECH_TIMESTAMPS,
            str(response_dict.get("timestamps")),  # Convert to string for telemetry
        )

    if response_dict.get("diarized_transcript"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SPEECH_DIARIZED_TRANSCRIPT,
            str(
                response_dict.get("diarized_transcript")
            ),  # Convert to string for telemetry
        )

    # Set content attributes if capture is enabled
    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, kwargs.get("file", "audio_file")
        )

    span.set_status(Status(StatusCode.OK))

    # Record metrics for speech-to-text
    if not disable_metrics:
        # Calculate cost based on audio duration or default for audio operations
        cost = get_audio_model_cost(
            request_model, pricing_info, "", end_time - start_time
        )

        record_audio_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT,
            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
            server_address=server_address,
            server_port=server_port,
            request_model=request_model,
            response_model=request_model,
            environment=environment,
            application_name=application_name,
            start_time=start_time,
            end_time=end_time,
            cost=cost,
        )

    return response


def process_text_to_speech_response(
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
    capture_message_content,
    disable_metrics,
    version,
    **kwargs,
):
    """
    Processes text-to-speech response from Sarvam AI API.

    Args:
        response: The API response object.
        request_model: The model used for the request.
        pricing_info: Information about model pricing.
        server_port: The server port.
        server_address: The server address.
        environment: The environment name.
        application_name: The application name.
        metrics: Metrics collection object.
        start_time: The request start time.
        span: The OpenTelemetry span.
        capture_message_content: Whether to capture message content.
        disable_metrics: Whether to disable metrics collection.
        version: The version of the instrumentation.
        **kwargs: Additional keyword arguments.

    Returns:
        The processed response object.
    """
    end_time = time.time()

    # Create scope object for common framework attributes
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    # Common Framework Span Attributes
    common_framework_span_attributes(
        scope=scope,
        framework_system=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
        server_address=server_address,
        server_port=server_port,
        environment=environment,
        application_name=application_name,
        version=version,
        endpoint=SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_TO_SPEECH,
    )

    # Set specific attributes for text-to-speech
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )

    # Text-to-speech specific attributes (using Sarvam API defaults)
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_TARGET_LANGUAGE_CODE,
        kwargs.get("target_language_code", ""),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_SPEAKER,
        kwargs.get("speaker", "Anushka"),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_PITCH,
        kwargs.get("pitch", 0.0),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_PACE,
        kwargs.get("pace", 1.0),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_LOUDNESS,
        kwargs.get("loudness", 1.0),  # API default
    )

    # Additional TTS parameters with API defaults
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_SPEECH_SAMPLE_RATE,
        kwargs.get("speech_sample_rate", 22050),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_ENABLE_PREPROCESSING,
        kwargs.get("enable_preprocessing", False),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TTS_OUTPUT_AUDIO_CODEC,
        kwargs.get("output_audio_codec", ""),
    )

    # Set content attributes if capture is enabled
    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, kwargs.get("inputs", "")
        )

    span.set_status(Status(StatusCode.OK))

    # Record metrics for text-to-speech
    if not disable_metrics:
        # Calculate cost based on input text for audio operations
        input_text = kwargs.get("inputs", "")
        cost = get_audio_model_cost(request_model, pricing_info, input_text)

        record_audio_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_TO_SPEECH,
            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
            server_address=server_address,
            server_port=server_port,
            request_model=request_model,
            response_model=request_model,
            environment=environment,
            application_name=application_name,
            start_time=start_time,
            end_time=end_time,
            cost=cost,
        )

    return response


def process_transliterate_response(
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
    capture_message_content,
    disable_metrics,
    version,
    **kwargs,
):
    """
    Processes transliterate response from Sarvam AI API.

    Args:
        response: The API response object.
        request_model: The model used for the request.
        pricing_info: Information about model pricing.
        server_port: The server port.
        server_address: The server address.
        environment: The environment name.
        application_name: The application name.
        metrics: Metrics collection object.
        start_time: The request start time.
        span: The OpenTelemetry span.
        capture_message_content: Whether to capture message content.
        disable_metrics: Whether to disable metrics collection.
        version: The version of the instrumentation.
        **kwargs: Additional keyword arguments.

    Returns:
        The processed response object.
    """
    end_time = time.time()
    response_dict = response_as_dict(response)

    # Create scope object for common framework attributes
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    # Common Framework Span Attributes
    common_framework_span_attributes(
        scope=scope,
        framework_system=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
        server_address=server_address,
        server_port=server_port,
        environment=environment,
        application_name=application_name,
        version=version,
        endpoint=SemanticConvention.GEN_AI_OPERATION_TYPE_TRANSLITERATE,
    )

    # Set specific attributes for transliterate
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )

    # Transliterate request attributes (with API defaults)
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLITERATE_SOURCE_LANGUAGE,
        kwargs.get("source_language_code", ""),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLITERATE_TARGET_LANGUAGE,
        kwargs.get("target_language_code", ""),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLITERATE_NUMERALS_FORMAT,
        kwargs.get("numerals_format", "international"),  # API default
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TRANSLITERATE_SPOKEN_FORM,
        kwargs.get("spoken_form", False),  # API default
    )

    # Optional transliterate attributes (only set if provided)
    if kwargs.get("spoken_form_numerals_language"):
        span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TRANSLITERATE_SPOKEN_FORM_NUMERALS_LANGUAGE,
            kwargs.get("spoken_form_numerals_language"),
        )

    # Transliterate response attributes
    if response_dict.get("transliterated_text"):
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            response_dict.get("transliterated_text"),
        )

    if response_dict.get("request_id"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID,
            response_dict.get("request_id"),
        )

    if response_dict.get("source_language_code"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_TRANSLITERATE_SOURCE_LANGUAGE,
            response_dict.get("source_language_code"),
        )

    # Set content attributes if capture is enabled
    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, kwargs.get("input", "")
        )

    span.set_status(Status(StatusCode.OK))

    # Record metrics for transliteration
    if not disable_metrics:
        # Calculate cost based on input/output text for transliteration
        input_text = kwargs.get("input", "")
        output_text = response_dict.get("transliterated_text", "")
        cost = get_chat_model_cost(
            request_model, pricing_info, len(input_text), len(output_text)
        )

        record_completion_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_TRANSLITERATE,
            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
            server_address=server_address,
            server_port=server_port,
            request_model=request_model,
            response_model=request_model,
            environment=environment,
            application_name=application_name,
            input_tokens=len(input_text),
            output_tokens=len(output_text),
            tbt=0,
            ttft=0,
            start_time=start_time,
            end_time=end_time,
            cost=cost,
        )

    return response


def process_language_identification_response(
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
    capture_message_content,
    disable_metrics,
    version,
    **kwargs,
):
    """
    Processes language identification response from Sarvam AI API.

    Args:
        response: The API response object.
        request_model: The model used for the request.
        pricing_info: Information about model pricing.
        server_port: The server port.
        server_address: The server address.
        environment: The environment name.
        application_name: The application name.
        metrics: Metrics collection object.
        start_time: The request start time.
        span: The OpenTelemetry span.
        capture_message_content: Whether to capture message content.
        disable_metrics: Whether to disable metrics collection.
        version: The version of the instrumentation.
        **kwargs: Additional keyword arguments.

    Returns:
        The processed response object.
    """
    end_time = time.time()
    response_dict = response_as_dict(response)

    # Create scope object for common framework attributes
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    # Common Framework Span Attributes
    common_framework_span_attributes(
        scope=scope,
        framework_system=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
        server_address=server_address,
        server_port=server_port,
        environment=environment,
        application_name=application_name,
        version=version,
        endpoint=SemanticConvention.GEN_AI_OPERATION_TYPE_LANGUAGE_IDENTIFICATION,
    )

    # Set specific attributes for language identification
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )

    # Language identification response attributes
    if response_dict.get("request_id"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID,
            response_dict.get("request_id"),
        )

    if response_dict.get("language_code"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_LANGUAGE_CODE,
            response_dict.get("language_code"),
        )

    if response_dict.get("script_code"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SCRIPT_CODE,
            response_dict.get("script_code"),
        )

    # Set content attributes if capture is enabled
    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, kwargs.get("input", "")
        )
        # For language identification, the "completion" would be the detected language/script
        detected_info = (
            f"Language: {response_dict.get('language_code', 'unknown')}, "
            f"Script: {response_dict.get('script_code', 'unknown')}"
        )
        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, detected_info)

    span.set_status(Status(StatusCode.OK))

    # Record metrics for language identification
    if not disable_metrics:
        # Calculate cost based on input text length for language identification
        input_text = kwargs.get("input", "")
        cost = get_chat_model_cost(request_model, pricing_info, len(input_text), 0)

        record_completion_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_LANGUAGE_IDENTIFICATION,
            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
            server_address=server_address,
            server_port=server_port,
            request_model=request_model,
            response_model=request_model,
            environment=environment,
            application_name=application_name,
            input_tokens=len(input_text),
            output_tokens=0,  # No output tokens for language identification
            tbt=0,
            ttft=0,
            start_time=start_time,
            end_time=end_time,
            cost=cost,
        )

    return response


def process_speech_to_text_translate_response(
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
    capture_message_content,
    disable_metrics,
    version,
    **kwargs,
):
    """
    Processes speech-to-text translate response from Sarvam AI API.

    Args:
        response: The API response object.
        request_model: The model used for the request.
        pricing_info: Information about model pricing.
        server_port: The server port.
        server_address: The server address.
        environment: The environment name.
        application_name: The application name.
        metrics: Metrics collection object.
        start_time: The request start time.
        span: The OpenTelemetry span.
        capture_message_content: Whether to capture message content.
        disable_metrics: Whether to disable metrics collection.
        version: The version of the instrumentation.
        **kwargs: Additional keyword arguments.

    Returns:
        The processed response object.
    """
    end_time = time.time()
    response_dict = response_as_dict(response)

    # Create scope object for common framework attributes
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    # Common Framework Span Attributes
    common_framework_span_attributes(
        scope=scope,
        framework_system=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
        server_address=server_address,
        server_port=server_port,
        environment=environment,
        application_name=application_name,
        version=version,
        endpoint=SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT_TRANSLATE,
    )

    # Set specific attributes for speech-to-text translate
    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, request_model)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )

    # Optional speech-to-text translate attributes (only set if provided)
    if kwargs.get("prompt"):
        span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_SPEECH_PROMPT, kwargs.get("prompt")
        )

    # Speech-to-text translate response attributes
    if response_dict.get("transcript"):
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            response_dict.get("transcript"),
        )

    if response_dict.get("request_id"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID,
            response_dict.get("request_id"),
        )

    if response_dict.get("language_code"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SPEECH_DETECTED_LANGUAGE,
            response_dict.get("language_code"),
        )

    # Optional response attributes (only set if present)
    if response_dict.get("diarized_transcript"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_SPEECH_DIARIZED_TRANSCRIPT,
            str(
                response_dict.get("diarized_transcript")
            ),  # Convert to string for telemetry
        )

    # Set content attributes if capture is enabled
    if capture_message_content:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, kwargs.get("file", "audio_file")
        )

    span.set_status(Status(StatusCode.OK))

    # Record metrics for speech-to-text translate
    if not disable_metrics:
        # Calculate cost based on audio duration for speech-to-text translate
        cost = get_audio_model_cost(
            request_model, pricing_info, "", end_time - start_time
        )

        record_audio_metrics(
            metrics=metrics,
            gen_ai_operation=SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT_TRANSLATE,
            GEN_AI_PROVIDER_NAME=SemanticConvention.GEN_AI_SYSTEM_SARVAM,
            server_address=server_address,
            server_port=server_port,
            request_model=request_model,
            response_model=request_model,
            environment=environment,
            application_name=application_name,
            start_time=start_time,
            end_time=end_time,
            cost=cost,
        )

    return response
