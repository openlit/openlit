"""
OCI GenAI OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    get_chat_model_cost,
    get_embed_model_cost,
    common_span_attributes,
    record_completion_metrics,
    record_embedding_metrics,
    general_tokens,
    handle_exception,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

# OCI GenAI finish reasons -> OTel standard finish reasons
_FINISH_REASON_MAP = {
    "COMPLETE": "stop",
    "complete": "stop",
    "stop": "stop",
    "MAX_TOKENS": "max_tokens",
    "max_tokens": "max_tokens",
    "length": "max_tokens",
    "tool_calls": "tool_calls",
    "TOOL_CALLS": "tool_calls",
    "ERROR": "error",
    "content_filter": "content_filter",
}


def _map_finish_reason(finish_reason):
    """Map an OCI finish reason to the OTel standard value."""
    if not finish_reason:
        return ""
    return _FINISH_REASON_MAP.get(finish_reason, finish_reason)


def _serving_model_id(details, default="unknown"):
    """Resolve the request model id from an OCI *Details request object."""
    serving_mode = getattr(details, "serving_mode", None)
    return (
        getattr(serving_mode, "model_id", None)
        or getattr(serving_mode, "endpoint_id", None)
        or default
    )


def _extract_generic_chat(chat_response):
    """Extract (text, finish_reason) from a GenericChatResponse."""
    text = ""
    finish_reason = ""
    choices = getattr(chat_response, "choices", None) or []
    if choices:
        choice = choices[0]
        finish_reason = getattr(choice, "finish_reason", "") or ""
        message = getattr(choice, "message", None)
        content = getattr(message, "content", None) or []
        for part in content:
            part_text = getattr(part, "text", None)
            if part_text:
                text += part_text
    return text, finish_reason


def _extract_cohere_chat(chat_response):
    """Extract (text, finish_reason) from a CohereChatResponse."""
    text = getattr(chat_response, "text", "") or ""
    finish_reason = getattr(chat_response, "finish_reason", "") or ""
    return text, finish_reason


def _extract_prompt_text(request):
    """Best-effort prompt string for content capture (GENERIC or COHERE request)."""
    if request is None:
        return ""
    # Cohere chat request carries a single prompt string.
    message = getattr(request, "message", None)
    if isinstance(message, str) and message:
        return message
    # Generic/Llama chat request carries a list of messages.
    parts = []
    for msg in getattr(request, "messages", None) or []:
        content = getattr(msg, "content", None) or []
        if isinstance(content, str):
            parts.append(content)
            continue
        for part in content:
            part_text = getattr(part, "text", None)
            if part_text:
                parts.append(part_text)
    return "\n".join(parts)


def _set_content(span, prompt_text, response_text):
    """Set gen_ai input/output message attributes (JSON arrays) when capturing content."""
    input_messages = [
        {"role": "user", "parts": [{"type": "text", "content": prompt_text}]}
    ]
    output_messages = [
        {
            "role": "assistant",
            "parts": [{"type": "text", "content": response_text}],
        }
    ]
    span.set_attribute(
        SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(input_messages)
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES, json.dumps(output_messages)
    )


def _set_request_params(span, request):
    """Set request-parameter span attributes present on the OCI chat request."""
    param_map = [
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "frequency_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, "presence_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_SEED, "seed"),
    ]
    for attribute, attr_name in param_map:
        value = getattr(request, attr_name, None)
        if value is not None:
            span.set_attribute(attribute, value)


def common_chat_logic(
    scope,
    request_model,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    operation_type,
):
    """Set common chat/completion span attributes, cost, and metrics."""
    scope._end_time = getattr(scope, "_end_time", None) or time.time()

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    common_span_attributes(
        scope,
        operation_type,
        SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        False,
        0,
        scope._ttft,
        version,
    )

    _set_request_params(scope._span, getattr(scope, "_request", None))

    # Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [_map_finish_reason(scope._finish_reason)],
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "text")

    # Tokens and cost
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

    # OCI has no cache-token concept today; stamp 0 for parity with other providers.
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0
    )

    if capture_message_content:
        _set_content(
            scope._span,
            getattr(scope, "_prompt", ""),
            scope._llmresponse,
        )

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics and metrics:
        record_completion_metrics(
            metrics,
            operation_type,
            SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
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
            0,
            scope._ttft,
            is_stream=False,
        )


def process_chat_response(
    response,
    request,
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
):
    """Process a non-streaming OCI chat response and generate telemetry."""
    try:
        data = getattr(response, "data", None)
        chat_response = getattr(data, "chat_response", None)
        api_format = getattr(chat_response, "api_format", None)

        if api_format == "COHERE":
            llmresponse, finish_reason = _extract_cohere_chat(chat_response)
        else:
            llmresponse, finish_reason = _extract_generic_chat(chat_response)

        usage = getattr(chat_response, "usage", None)
        input_tokens = getattr(usage, "prompt_tokens", 0) or 0
        output_tokens = getattr(usage, "completion_tokens", 0) or 0

        scope = type("GenericScope", (), {})()
        scope._start_time = start_time
        scope._end_time = time.time()
        scope._span = span
        scope._llmresponse = llmresponse
        scope._finish_reason = finish_reason
        scope._response_id = getattr(data, "id", "") or ""
        scope._response_model = getattr(data, "model_id", None) or request_model
        scope._input_tokens = input_tokens
        scope._output_tokens = output_tokens
        scope._ttft = scope._end_time - scope._start_time
        scope._server_address, scope._server_port = server_address, server_port
        scope._request = request
        scope._prompt = (
            _extract_prompt_text(request) if capture_message_content else ""
        )

        common_chat_logic(
            scope,
            request_model,
            pricing_info,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        )
        return response
    except Exception as e:
        # Telemetry processing must never break the caller's API call.
        handle_exception(span, e)
        return response


def process_generate_text_response(
    response,
    request,
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
):
    """Process a non-streaming OCI generate_text (legacy completion) response."""
    try:
        data = getattr(response, "data", None)
        inference_response = getattr(data, "inference_response", None)
        runtime_type = getattr(inference_response, "runtime_type", None)

        llmresponse = ""
        finish_reason = ""
        if runtime_type == "COHERE":
            generated = getattr(inference_response, "generated_texts", None) or []
            if generated:
                llmresponse = getattr(generated[0], "text", "") or ""
                finish_reason = getattr(generated[0], "finish_reason", "") or ""
        else:
            # Llama / other legacy runtimes expose OpenAI-style choices; read
            # defensively so an unexpected shape degrades to best-effort text.
            choices = getattr(inference_response, "choices", None) or []
            if choices:
                choice = choices[0]
                finish_reason = getattr(choice, "finish_reason", "") or ""
                message = getattr(choice, "message", None)
                content = getattr(message, "content", None)
                if isinstance(content, str):
                    llmresponse = content
                elif content:
                    for part in content:
                        part_text = getattr(part, "text", None)
                        if part_text:
                            llmresponse += part_text
                else:
                    llmresponse = getattr(choice, "text", "") or ""

        # generate_text carries the prompt on the inference_request, not on
        # a chat-style messages/message field.
        inference_request = getattr(request, "inference_request", None)
        prompt_text = getattr(inference_request, "prompt", "") or ""
        # generate_text responses do not carry token usage; estimate.
        input_tokens = general_tokens(prompt_text) if prompt_text else 0
        output_tokens = general_tokens(llmresponse) if llmresponse else 0

        scope = type("GenericScope", (), {})()
        scope._start_time = start_time
        scope._end_time = time.time()
        scope._span = span
        scope._llmresponse = llmresponse
        scope._finish_reason = finish_reason
        scope._response_id = getattr(data, "id", "")
        scope._response_model = getattr(data, "model_id", None) or request_model
        scope._input_tokens = input_tokens
        scope._output_tokens = output_tokens
        scope._ttft = scope._end_time - scope._start_time
        scope._server_address, scope._server_port = server_address, server_port
        scope._request = inference_request
        scope._prompt = prompt_text if capture_message_content else ""

        common_chat_logic(
            scope,
            request_model,
            pricing_info,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
        )
        return response
    except Exception as e:
        # Telemetry processing must never break the caller's API call.
        handle_exception(span, e)
        return response


def process_embedding_response(
    response,
    request,
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
):
    """Process an OCI embed_text response and generate telemetry."""
    try:
        data = getattr(response, "data", None)
        usage = getattr(data, "usage", None)
        inputs = getattr(request, "inputs", None) or []

        input_tokens = getattr(usage, "prompt_tokens", None)
        if input_tokens is None:
            input_tokens = sum(
                general_tokens(text) for text in inputs if isinstance(text, str)
            )

        response_model = getattr(data, "model_id", None) or request_model
        cost = get_embed_model_cost(request_model, pricing_info, input_tokens)

        scope = type("GenericScope", (), {})()
        scope._start_time = start_time
        scope._end_time = time.time()
        scope._span = span
        scope._response_model = response_model
        scope._ttft = scope._end_time - scope._start_time
        scope._server_address, scope._server_port = server_address, server_port

        common_span_attributes(
            scope,
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
            server_address,
            server_port,
            request_model,
            response_model,
            environment,
            application_name,
            False,
            0,
            scope._ttft,
            version,
        )

        span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens
        )
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "float")

        if capture_message_content:
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES, str(inputs)
            )

        span.set_status(Status(StatusCode.OK))

        if not disable_metrics and metrics:
            record_embedding_metrics(
                metrics,
                SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                SemanticConvention.GEN_AI_SYSTEM_OCI_GENAI,
                server_address,
                server_port,
                request_model,
                response_model,
                environment,
                application_name,
                scope._start_time,
                scope._end_time,
                input_tokens,
                cost,
            )
        return response
    except Exception as e:
        # Telemetry processing must never break the caller's API call.
        handle_exception(span, e)
        return response
