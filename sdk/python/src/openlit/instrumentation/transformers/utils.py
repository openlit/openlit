"""
HF Transformers OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    general_tokens,
    get_chat_model_cost,
    common_span_attributes,
    otel_event,
    record_completion_metrics,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(content):
    """
    Format content to a consistent structure.
    """
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        # Check if its a list of chat messages (like in the test case)
        if (
            len(content) > 0
            and isinstance(content[0], dict)
            and "role" in content[0]
            and "content" in content[0]
        ):
            # Handle chat message format like Groq
            formatted_messages = []
            for message in content:
                role = message["role"]
                msg_content = message["content"]

                if isinstance(msg_content, list):
                    content_str = ", ".join(
                        f"{item['type']}: {item['text'] if 'text' in item else item.get('image_url', str(item))}"
                        if isinstance(item, dict) and "type" in item
                        else str(item)
                        for item in msg_content
                    )
                    formatted_messages.append(f"{role}: {content_str}")
                else:
                    formatted_messages.append(f"{role}: {msg_content}")
            return "\n".join(formatted_messages)
        else:
            # Handle other list formats (transformers responses)
            formatted_content = []
            for item in content:
                if isinstance(item, str):
                    formatted_content.append(item)
                elif isinstance(item, dict):
                    # Handle dict format for transformers
                    if "generated_text" in item:
                        formatted_content.append(str(item["generated_text"]))
                    else:
                        formatted_content.append(str(item))
                else:
                    formatted_content.append(str(item))
            return " ".join(formatted_content)
    else:
        return str(content)


def build_input_messages(messages):
    """
    Convert Transformers request to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    if not messages:
        return []
    if isinstance(messages, str):
        return [{"role": "user", "parts": [{"type": "text", "content": messages}]}]
    if isinstance(messages, list) and len(messages) > 0:
        if (
            isinstance(messages[0], dict)
            and "role" in messages[0]
            and "content" in messages[0]
        ):
            otel_messages = []
            for message in messages:
                role = message.get("role", "user")
                content = message.get("content", "")
                if isinstance(content, list):
                    parts = []
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            parts.append(
                                {"type": "text", "content": item.get("text", "")}
                            )
                    if parts:
                        otel_messages.append({"role": role, "parts": parts})
                elif content:
                    otel_messages.append(
                        {
                            "role": role,
                            "parts": [{"type": "text", "content": str(content)}],
                        }
                    )
            return (
                otel_messages
                if otel_messages
                else [
                    {
                        "role": "user",
                        "parts": [{"type": "text", "content": str(messages)}],
                    }
                ]
            )
    return [{"role": "user", "parts": [{"type": "text", "content": str(messages)}]}]


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Transformers response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    if response_text:
        parts.append({"type": "text", "content": str(response_text)})
    return [
        {
            "role": "assistant",
            "parts": parts,
            "finish_reason": finish_reason or "stop",
        }
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
    forward_params = getattr(scope._instance, "_forward_params", {}) or {}
    request_model = scope._instance.model.config.name_or_path

    input_tokens = getattr(scope, "_input_tokens", 0)
    output_tokens = getattr(scope, "_output_tokens", 0)

    # Compute cost
    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
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

    # Transformers pipeline (no additional API type attribute)

    # Span Attributes for Request parameters
    if forward_params.get("temperature") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
            forward_params["temperature"],
        )
    if forward_params.get("top_k") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TOP_K, forward_params["top_k"]
        )
    if forward_params.get("top_p") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TOP_P, forward_params["top_p"]
        )
    if forward_params.get("max_length") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
            forward_params["max_length"],
        )

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [getattr(scope, "_finish_reason", "stop")],
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "text")

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
    if capture_message_content:
        input_msgs = build_input_messages(scope._prompt)
        output_msgs = build_output_messages(
            scope._completion, getattr(scope, "_finish_reason", "stop")
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                extra = {
                    "response_id": getattr(scope, "_response_id", ""),
                    "finish_reasons": [getattr(scope, "_finish_reason", "stop")],
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
                if forward_params.get("temperature") is not None:
                    extra["temperature"] = forward_params["temperature"]
                if forward_params.get("top_p") is not None:
                    extra["top_p"] = forward_params["top_p"]
                if forward_params.get("max_length") is not None:
                    extra["max_tokens"] = forward_params["max_length"]
                emit_inference_event(
                    event_provider,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model,
                    request_model,
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
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
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


def process_chat_response(
    instance,
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
    Process chat request and generate Telemetry
    """

    scope = type("GenericScope", (), {})()
    scope._instance = instance
    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._server_address = server_address
    scope._server_port = server_port
    scope._kwargs = kwargs
    scope._args = args

    # Extract prompt from args or kwargs
    if args and len(args) > 0:
        scope._prompt = args[0]
    else:
        scope._prompt = (
            kwargs.get("text_inputs")
            or (
                kwargs.get("image")
                and kwargs.get("question")
                and (
                    "image: "
                    + kwargs.get("image")
                    + " question:"
                    + kwargs.get("question")
                )
            )
            or kwargs.get("fallback")
            or ""
        )
    scope._prompt = format_content(scope._prompt)

    # Process response based on task type
    task = kwargs.get("task", "text-generation")

    if task == "text-generation":
        # Handle text generation responses
        if isinstance(response, list) and len(response) > 0:
            first_entry = response[0]
            if isinstance(first_entry, dict):
                if isinstance(first_entry.get("generated_text"), list):
                    # Handle nested list format
                    last_element = first_entry.get("generated_text")[-1]
                    scope._completion = last_element.get("content", str(last_element))
                else:
                    # Handle standard format
                    scope._completion = first_entry.get("generated_text", "")
            else:
                scope._completion = str(first_entry)
        else:
            scope._completion = ""

    elif task == "automatic-speech-recognition":
        scope._completion = (
            response.get("text", "") if isinstance(response, dict) else ""
        )

    elif task == "image-classification":
        scope._completion = (
            str(response[0]) if isinstance(response, list) and len(response) > 0 else ""
        )

    elif task == "visual-question-answering":
        if (
            isinstance(response, list)
            and len(response) > 0
            and isinstance(response[0], dict)
        ):
            scope._completion = response[0].get("answer", "")
        else:
            scope._completion = ""
    else:
        # Default handling for other tasks
        scope._completion = format_content(response)

    # Initialize timing attributes
    scope._tbt = 0
    scope._ttft = scope._end_time - scope._start_time

    # Handle token usage including reasoning tokens and cached tokens
    scope._input_tokens = general_tokens(scope._prompt)
    scope._output_tokens = general_tokens(scope._completion)
    scope._cache_read_input_tokens = 0
    scope._cache_creation_input_tokens = 0
    scope._response_id = ""
    scope._finish_reason = "stop"

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
