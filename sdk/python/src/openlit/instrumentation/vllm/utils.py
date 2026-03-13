"""
vLLM OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    general_tokens,
    get_chat_model_cost,
    common_span_attributes,
    record_completion_metrics,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def get_inference_config(args, kwargs):
    """
    Safely extract inference configuration from args or kwargs.
    """

    if "sampling_params" in kwargs:
        return kwargs["sampling_params"]
    if len(args) > 1:
        return args[1]
    return None


def format_content(prompts):
    """
    Process a list of prompts to extract content.
    """

    if isinstance(prompts, str):
        return prompts
    elif isinstance(prompts, list):
        return "\n".join(str(prompt) for prompt in prompts)
    else:
        return str(prompts)


def build_input_messages(prompts):
    """
    Convert vLLM request prompts to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    content = format_content(prompts) if prompts else ""
    return [{"role": "user", "parts": [{"type": "text", "content": content}]}]


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert vLLM response to OTel output message structure.
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

    request_model = scope._request_model
    response_model = getattr(scope, "_response_model", request_model)

    # Extract prompts and completions from vLLM response; set scope._input_tokens / _output_tokens
    input_tokens = 0
    output_tokens = 0
    prompt = ""
    completion = ""
    finish_reason = "stop"

    for output in scope._response:
        prompt += output.prompt + "\n"
        if output.outputs and len(output.outputs) > 0:
            out = output.outputs[0]
            completion += out.text + "\n"
            if finish_reason == "stop" and getattr(out, "finish_reason", None):
                finish_reason = out.finish_reason
            input_tokens += general_tokens(output.prompt)
            output_tokens += general_tokens(out.text)

    scope._input_tokens = input_tokens
    scope._output_tokens = output_tokens

    # Compute cost
    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_VLLM,
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
    inference_config = get_inference_config(scope._args, scope._kwargs)
    if inference_config:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
            getattr(inference_config, "max_tokens", -1),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
            getattr(inference_config, "stop_sequences", []),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
            getattr(inference_config, "temperature", 1.0),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TOP_P,
            getattr(inference_config, "top_p", 1.0),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TOP_K,
            getattr(inference_config, "top_k", -1),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
            getattr(inference_config, "presence_penalty", 0.0),
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
            getattr(inference_config, "frequency_penalty", 0.0),
        )

    # Span Attributes for Response parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finish_reason]
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
    input_msgs = build_input_messages(
        scope._kwargs.get("prompts") or (scope._args[0] if scope._args else "")
    )
    output_msgs = build_output_messages(completion, finish_reason)
    _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
    if capture_message_content and event_provider:

        def _get_attr(obj, name, default=None):
            return getattr(obj, name, default) if obj else default

        extra = {
            "response_id": getattr(scope, "_response_id", None),
            "finish_reasons": [finish_reason],
            "output_type": "text",
            "temperature": _get_attr(inference_config, "temperature"),
            "max_tokens": _get_attr(inference_config, "max_tokens"),
            "top_p": _get_attr(inference_config, "top_p"),
            "top_k": _get_attr(inference_config, "top_k"),
            "frequency_penalty": _get_attr(inference_config, "frequency_penalty"),
            "presence_penalty": _get_attr(inference_config, "presence_penalty"),
            "stop_sequences": _get_attr(inference_config, "stop_sequences"),
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
            response_model,
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
            SemanticConvention.GEN_AI_SYSTEM_VLLM,
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

    scope._response = response
    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address = server_address
    scope._server_port = server_port
    scope._request_model = request_model
    scope._timestamps = []
    scope._args = args
    scope._kwargs = kwargs

    # Handle token usage including reasoning tokens and cached tokens
    scope._cache_read_input_tokens = 0
    scope._cache_creation_input_tokens = 0

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
