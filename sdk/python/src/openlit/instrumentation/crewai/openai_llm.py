"""LLM span for CrewAI's native OpenAI provider.

CrewAI 1.15 calls ``responses.create`` and ``chat.completions.create`` on its
own OpenAI client. LiteLLM, LangChain, and Strands are the only other setters
of ``openlit_framework_llm_span_active``, and none of them run on this path.
Without a span owned here, the provider wrappers either emit a second LLM span
or, once guarded, emit nothing and the prompt disappears from the crew trace.

The flag stays set for the entire ``call`` / ``acall``. CrewAI consumes a
Responses stream inside that method, so clearing the flag before it returns
would let the provider wrapper open a span again during iteration.
"""

import json
import logging
import time
from urllib.parse import urlparse

from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_span_attributes,
    format_input_message,
    format_output_message,
    get_chat_model_cost,
    get_server_address_for_provider,
    handle_exception,
    is_framework_llm_active,
    record_completion_metrics,
    reset_framework_llm_active,
    set_framework_llm_active,
)
from openlit.instrumentation.crewai.utils import _infer_provider_from_model
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

_USAGE_KEYS = (
    "prompt_tokens",
    "completion_tokens",
    "reasoning_tokens",
    "cached_prompt_tokens",
    "cache_creation_tokens",
)


def openai_completion_call(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Wrap ``OpenAICompletion.call`` with one framework LLM span."""

    def wrapper(wrapped, instance, args, kwargs):
        if is_framework_llm_active():
            return wrapped(*args, **kwargs)

        return _run_sync(
            wrapped,
            instance,
            args,
            kwargs,
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )

    return wrapper


def async_openai_completion_call(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Wrap ``OpenAICompletion.acall`` with one framework LLM span."""

    async def wrapper(wrapped, instance, args, kwargs):
        if is_framework_llm_active():
            return await wrapped(*args, **kwargs)

        return await _run_async(
            wrapped,
            instance,
            args,
            kwargs,
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )

    return wrapper


def _run_sync(
    wrapped,
    instance,
    args,
    kwargs,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Start the span, hold the flag around the sync call, then record it."""
    request_model = _request_model(instance)
    span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"
    before = _usage_snapshot(instance)
    messages = _call_messages(args, kwargs)

    with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
        start_time = time.time()
        fw_token = set_framework_llm_active()
        try:
            response = wrapped(*args, **kwargs)
        except Exception as exc:
            handle_exception(span, exc)
            _record_error_metrics(
                metrics,
                disable_metrics,
                request_model,
                instance,
                environment,
                application_name,
                start_time,
                before,
                pricing_info,
                exc,
            )
            raise
        finally:
            reset_framework_llm_active(fw_token)

        _finish_span(
            span,
            instance,
            response,
            messages,
            request_model,
            before,
            start_time,
            version,
            environment,
            application_name,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )
        return response


async def _run_async(
    wrapped,
    instance,
    args,
    kwargs,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Start the span, hold the flag around the async call, then record it."""
    request_model = _request_model(instance)
    span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"
    before = _usage_snapshot(instance)
    messages = _call_messages(args, kwargs)

    with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
        start_time = time.time()
        fw_token = set_framework_llm_active()
        try:
            response = await wrapped(*args, **kwargs)
        except Exception as exc:
            handle_exception(span, exc)
            _record_error_metrics(
                metrics,
                disable_metrics,
                request_model,
                instance,
                environment,
                application_name,
                start_time,
                before,
                pricing_info,
                exc,
            )
            raise
        finally:
            reset_framework_llm_active(fw_token)

        _finish_span(
            span,
            instance,
            response,
            messages,
            request_model,
            before,
            start_time,
            version,
            environment,
            application_name,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )
        return response


def _finish_span(
    span,
    instance,
    response,
    messages,
    request_model,
    before,
    start_time,
    version,
    environment,
    application_name,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Record the call onto the span. Telemetry must not fail the LLM call."""
    try:
        usage = _usage_delta(before, _usage_snapshot(instance))
        server_address, server_port = _server_for_llm(instance)
        scope = type("GenericScope", (), {"_span": span})()
        common_span_attributes(
            scope,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            server_address,
            server_port,
            request_model,
            request_model,
            environment,
            application_name,
            _is_stream(instance),
            0,
            0,
            version,
        )
        _set_api_type(span, instance)
        _set_messages(span, messages, response, capture_message_content)
        _set_usage(span, usage)
        _record_metrics(
            metrics,
            disable_metrics,
            request_model,
            instance,
            environment,
            application_name,
            start_time,
            before,
            pricing_info,
            usage=usage,
        )
        span.set_status(Status(StatusCode.OK))
    except Exception:
        logger.debug("Failed to record CrewAI OpenAI LLM span", exc_info=True)


def _record_error_metrics(
    metrics,
    disable_metrics,
    request_model,
    instance,
    environment,
    application_name,
    start_time,
    before,
    pricing_info,
    exc,
):
    """Record the failed call without hiding the original exception."""
    try:
        _record_metrics(
            metrics,
            disable_metrics,
            request_model,
            instance,
            environment,
            application_name,
            start_time,
            before,
            pricing_info,
            error_type=type(exc).__name__ or "_OTHER",
        )
    except Exception:
        logger.debug("Failed to record CrewAI OpenAI error metrics", exc_info=True)


def _record_metrics(
    metrics,
    disable_metrics,
    request_model,
    instance,
    environment,
    application_name,
    start_time,
    before,
    pricing_info,
    usage=None,
    error_type=None,
):
    """Record one completion metric for this call, or nothing when disabled."""
    if disable_metrics or not metrics:
        return
    if usage is None:
        usage = _usage_delta(before, _usage_snapshot(instance))
    input_tokens = usage[0] if usage else 0
    output_tokens = usage[1] if usage else 0
    cache_read = usage[3] if usage else 0
    cache_creation = usage[4] if usage else 0
    server_address, server_port = _server_for_llm(instance)
    cost = 0
    if pricing_info:
        cost = get_chat_model_cost(
            request_model,
            pricing_info,
            input_tokens,
            output_tokens,
            cache_read_tokens=cache_read,
            cache_creation_tokens=cache_creation,
            prompt_tokens_include_cache=True,
        )
    record_completion_metrics(
        metrics,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        server_address,
        server_port,
        request_model,
        request_model,
        environment,
        application_name,
        start_time,
        time.time(),
        input_tokens,
        output_tokens,
        cost,
        None,
        None,
        error_type=error_type,
        is_stream=_is_stream(instance),
    )


def _set_usage(span, usage):
    """Write the per-call token delta. Lifetime counters are not the call."""
    if usage is None:
        return
    input_tokens, output_tokens, reasoning, cache_read, cache_creation = usage
    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens
    )
    if cache_read:
        span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, cache_read
        )
    if cache_creation:
        span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
            cache_creation,
        )
    if reasoning:
        span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS_REPORTED, True
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_REASONING_OUTPUT_TOKENS, reasoning
        )
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, reasoning)
        span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_DERIVED_COMPLETED_OUTPUT_TOKENS,
            max(output_tokens - reasoning, 0),
        )


def _set_messages(span, messages, response, capture_message_content):
    """Store prompt and output only when content capture is on."""
    if not capture_message_content:
        return
    incoming = _input_messages(messages)
    outgoing = _output_messages(response)
    if incoming is not None:
        span.set_attribute(
            SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(incoming)
        )
    if outgoing is not None:
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES, json.dumps(outgoing)
        )
        finish = outgoing[0].get("finish_reason")
        if finish:
            span.set_attribute(
                SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finish]
            )
    span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    )


def _set_api_type(span, instance):
    """Mark which OpenAI API this call used, when the provider says so."""
    api = _effective_api(instance)
    if api == "responses":
        span.set_attribute(SemanticConvention.OPENAI_API_TYPE, "responses")
    elif api == "completions":
        span.set_attribute(SemanticConvention.OPENAI_API_TYPE, "chat_completions")


def _effective_api(instance):
    """Return CrewAI's resolved API name, or None when it cannot be read."""
    effective = getattr(instance, "_effective_api", None)
    if callable(effective):
        try:
            return effective()
        except Exception:
            return getattr(instance, "api", None)
    return getattr(instance, "api", None)


def _call_messages(args, kwargs):
    """Return the messages argument from either position or keyword."""
    if args:
        return args[0]
    return kwargs.get("messages")


def _request_model(instance):
    """Return the model id CrewAI will send, or a stable fallback."""
    model = getattr(instance, "model", None)
    if model:
        return str(model)
    return "openai"


def _is_stream(instance):
    """Return the call-scoped stream flag when CrewAI exposes one."""
    effective = getattr(instance, "_effective_stream", None)
    if callable(effective):
        try:
            return bool(effective())
        except Exception:
            return bool(getattr(instance, "stream", False))
    return bool(getattr(instance, "stream", False))


def _server_for_llm(instance):
    """Resolve the endpoint from the LLM instance itself.

    ``set_server_address_and_port`` looks up ``instance.llm``. Here the
    instance is the LLM, so that lookup would miss ``api_base`` / ``base_url``.
    """
    api_base = getattr(instance, "api_base", None) or getattr(instance, "base_url", None)
    if api_base:
        parsed = urlparse(str(api_base))
        if parsed.hostname:
            port = parsed.port
            if port is None:
                port = 443 if parsed.scheme == "https" else 80
            return parsed.hostname, port
    provider = _infer_provider_from_model(_request_model(instance)) or "openai"
    return get_server_address_for_provider(provider)


def _usage_snapshot(instance):
    """Copy CrewAI's cumulative counters. The dict is mutated in place."""
    usage = getattr(instance, "_token_usage", None)
    if not isinstance(usage, dict):
        return None
    try:
        return {key: int(usage.get(key) or 0) for key in _USAGE_KEYS}
    except (TypeError, ValueError):
        return None


def _usage_delta(before, after):
    """Return per-call tokens, or None when the instance does not track them.

    ``_token_usage`` sums every call on the LLM object. Attributing the raw
    counter would put the lifetime total on each span.
    """
    if before is None or after is None:
        return None
    return tuple(max(after[key] - before[key], 0) for key in _USAGE_KEYS)


def _input_messages(messages):
    """Normalize a string or a list of role/content messages."""
    if messages is None:
        return None
    if isinstance(messages, str):
        return [format_input_message("user", messages)]
    if not isinstance(messages, list):
        return [format_input_message("user", messages)]
    formatted = []
    for message in messages:
        if isinstance(message, dict):
            role = str(message.get("role") or "user")
            content = message.get("content")
            if content is None:
                content = ""
            formatted.append(format_input_message(role, content))
            continue
        role = str(getattr(message, "role", None) or "user")
        content = getattr(message, "content", None)
        if content is None:
            content = str(message)
        formatted.append(format_input_message(role, content))
    return formatted or None


def _output_messages(response):
    """Normalize text, tool-call lists, and ResponsesAPIResult-like objects."""
    if isinstance(response, str):
        return [format_output_message(response, "stop")]
    if isinstance(response, list):
        parts = []
        for item in response:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            arguments = item.get("arguments")
            if arguments is None:
                arguments = {}
            parts.append(
                {
                    "type": "tool_call",
                    "id": str(item.get("id") or item.get("call_id") or ""),
                    "name": str(item.get("name")),
                    "arguments": arguments,
                }
            )
        if parts:
            return [
                {"role": "assistant", "parts": parts, "finish_reason": "tool_call"}
            ]
        return None
    text = getattr(response, "text", None)
    if isinstance(text, str):
        return [format_output_message(text, "stop")]
    if response is None:
        return None
    return [format_output_message(response, "stop")]
