"""
Smolagents sync wrappers — OTel GenAI semantic convention compliant.

Handles agent runs (including streaming generators), LLM model calls,
tool execution, and per-step tracing.
"""

import time
import json
from opentelemetry import context as context_api
from opentelemetry.trace import Link, Status, StatusCode
from openlit.__helpers import (
    format_input_message,
    format_output_message,
    handle_exception,
)
from openlit.instrumentation.smolagents.utils import (
    process_smolagents_response,
    emit_create_agent_span,
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    set_server_address_and_port,
    compute_model_info,
    _smolagents_agent_active,
    _smolagents_tool_call_active,
    _current_model_info,
    _extract_model_name,
    _record_smolagents_metrics,
    SemanticConvention,
)


def general_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Create a sync wrapper for a smolagents operation."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # --- agent_init: agent construction → create_agent span ---
        if gen_ai_endpoint == "agent_init":
            result = wrapped(*args, **kwargs)
            try:
                ctx = emit_create_agent_span(
                    tracer,
                    instance,
                    version,
                    environment,
                    application_name,
                    capture_message_content,
                )
                if ctx is not None:
                    instance._openlit_creation_context = ctx
            except Exception:
                pass
            return result

        # --- agent_run: root agent invocation ---
        if gen_ai_endpoint == "agent_run":
            return _handle_agent_run(
                wrapped,
                instance,
                args,
                kwargs,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        # --- execute_tool_call: ToolCallingAgent dispatching a tool ---
        if gen_ai_endpoint == "execute_tool_call":
            return _handle_tool_call(
                wrapped,
                instance,
                args,
                kwargs,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                tracer,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        # --- tool_call: Tool.__call__ low-level ---
        if gen_ai_endpoint == "tool_call":
            if _smolagents_tool_call_active.get():
                return wrapped(*args, **kwargs)
            return _handle_tool_call(
                wrapped,
                instance,
                args,
                kwargs,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                tracer,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        # --- step-level spans ---
        if gen_ai_endpoint in ("code_step", "tool_calling_step"):
            return _handle_step(
                wrapped,
                instance,
                args,
                kwargs,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                tracer,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        # --- planning step ---
        if gen_ai_endpoint == "planning_step":
            return _handle_planning_step(
                wrapped,
                instance,
                args,
                kwargs,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                tracer,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        # --- managed_agent_call: __call__ on managed sub-agent ---
        if gen_ai_endpoint == "managed_agent_call":
            if _smolagents_agent_active.get():
                return wrapped(*args, **kwargs)
            return _handle_agent_run(
                wrapped,
                instance,
                args,
                kwargs,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        # Fallback: pass through
        return wrapped(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Agent run handler (supports streaming generators)
# ---------------------------------------------------------------------------


def _handle_agent_run(
    wrapped,
    instance,
    args,
    kwargs,
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Handle MultiStepAgent.run() with streaming and non-streaming paths."""
    server_address, server_port = set_server_address_and_port(instance)
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    # Propagate model info to child tool spans
    model_info_token = _current_model_info.set(compute_model_info(instance))
    agent_active_token = _smolagents_agent_active.set(True)

    # Span links: connect invoke_agent back to create_agent
    links = []
    creation_ctx = getattr(instance, "_openlit_creation_context", None)
    if creation_ctx:
        links = [Link(creation_ctx)]

    # Detect if stream=True from kwargs (or second positional arg)
    is_stream = kwargs.get("stream", False)
    if not is_stream and len(args) > 1:
        is_stream = args[1] if isinstance(args[1], bool) else False

    if is_stream:
        return _handle_agent_stream(
            wrapped,
            instance,
            args,
            kwargs,
            span_name,
            span_kind,
            tracer,
            operation_type,
            server_address,
            server_port,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            gen_ai_endpoint,
            model_info_token,
            agent_active_token,
            links,
        )

    try:
        with tracer.start_as_current_span(
            span_name, kind=span_kind, links=links
        ) as span:
            start_time = time.time()
            try:
                response = wrapped(*args, **kwargs)

                # Aggregate token usage from agent monitor
                _set_agent_token_usage(span, instance)

                process_smolagents_response(
                    response,
                    operation_type,
                    server_address,
                    server_port,
                    environment,
                    application_name,
                    metrics,
                    start_time,
                    span,
                    capture_message_content,
                    disable_metrics,
                    version,
                    instance,
                    args,
                    endpoint=gen_ai_endpoint,
                    **kwargs,
                )
                return response

            except Exception as e:
                handle_exception(span, e)
                raise
    finally:
        _current_model_info.reset(model_info_token)
        _smolagents_agent_active.reset(agent_active_token)


def _handle_agent_stream(
    wrapped,
    instance,
    args,
    kwargs,
    span_name,
    span_kind,
    tracer,
    operation_type,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    gen_ai_endpoint,
    model_info_token,
    agent_active_token,
    links=None,
):
    """Wrap agent.run(stream=True) — hold span open across generator iteration."""

    def stream_wrapper():
        with tracer.start_as_current_span(
            span_name, kind=span_kind, links=links or []
        ) as span:
            start_time = time.time()

            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                operation_type,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_SMOLAGENTS,
            )

            model_name = _extract_model_name(instance)
            if model_name:
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)

            agent_name = getattr(instance, "name", None) or type(instance).__name__
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))

            description = getattr(instance, "description", None)
            if description:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(description)
                )

            max_steps = getattr(instance, "max_steps", None)
            if max_steps is not None:
                span.set_attribute("gen_ai.smolagents.max_steps", max_steps)

            tools = getattr(instance, "tools", None)
            if tools:
                from openlit.instrumentation.smolagents.utils import (
                    _set_tool_definitions,
                )

                _set_tool_definitions(span, tools)

            if args:
                task = args[0]
                if task and capture_message_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_INPUT_MESSAGES,
                        json.dumps([format_input_message("user", task)]),
                    )

            span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
            span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
            span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
            span.set_attribute(
                SemanticConvention.GEN_AI_APPLICATION_NAME,
                application_name,
            )
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

            step_count = 0
            last_output = None

            try:
                stream_gen = wrapped(*args, **kwargs)
                for event in stream_gen:
                    step_count += 1
                    if hasattr(event, "action_output"):
                        output = getattr(event, "action_output", None)
                        if output is not None:
                            last_output = output
                    elif hasattr(event, "is_final_answer") and getattr(
                        event, "is_final_answer", False
                    ):
                        last_output = getattr(event, "output", event)
                    yield event

                # Finalize span after generator exhausted
                _set_agent_token_usage(span, instance)
                span.set_attribute("gen_ai.smolagents.step_count", step_count)

                if capture_message_content:
                    output_text = None
                    if last_output is not None:
                        output_text = str(getattr(last_output, "output", last_output))
                    elif hasattr(instance, "output") and instance.output is not None:
                        output_text = str(instance.output)
                    if output_text:
                        span.set_attribute(
                            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                            json.dumps([format_output_message(output_text)]),
                        )

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                    time.time() - start_time,
                )
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_TYPE,
                    SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
                )
                span.set_status(Status(StatusCode.OK))

                if not disable_metrics and metrics:
                    _record_smolagents_metrics(
                        metrics,
                        operation_type,
                        time.time() - start_time,
                        environment,
                        application_name,
                        model_name,
                        server_address,
                        server_port,
                    )

            except Exception as e:
                handle_exception(span, e)
                raise
            finally:
                _current_model_info.reset(model_info_token)
                _smolagents_agent_active.reset(agent_active_token)

    return stream_wrapper()


# ---------------------------------------------------------------------------
# Tool call handler
# ---------------------------------------------------------------------------


def _handle_tool_call(
    wrapped,
    instance,
    args,
    kwargs,
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Handle tool execution spans."""
    server_address, server_port = set_server_address_and_port(instance)
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "execute_tool")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    # Set dedup flag so Tool.__call__ doesn't create a second span
    tool_active_token = None
    if gen_ai_endpoint == "execute_tool_call":
        tool_active_token = _smolagents_tool_call_active.set(True)

    try:
        with tracer.start_as_current_span(span_name, kind=span_kind) as span:
            start_time = time.time()
            try:
                response = wrapped(*args, **kwargs)

                process_smolagents_response(
                    response,
                    operation_type,
                    server_address,
                    server_port,
                    environment,
                    application_name,
                    metrics,
                    start_time,
                    span,
                    capture_message_content,
                    disable_metrics,
                    version,
                    instance,
                    args,
                    endpoint=gen_ai_endpoint,
                    **kwargs,
                )
                return response

            except Exception as e:
                handle_exception(span, e)
                raise
    finally:
        if tool_active_token is not None:
            _smolagents_tool_call_active.reset(tool_active_token)


# ---------------------------------------------------------------------------
# Per-step handler
# ---------------------------------------------------------------------------


def _handle_step(
    wrapped,
    instance,
    args,
    kwargs,
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Handle per-step spans for CodeAgent._step_stream / ToolCallingAgent._step_stream.

    _step_stream is a generator; we wrap it to hold the span open.
    """
    _server_address, _server_port = set_server_address_and_port(instance)
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    def step_generator():
        with tracer.start_as_current_span(span_name, kind=span_kind) as span:
            start_time = time.time()
            span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_SMOLAGENTS,
            )
            agent_name = getattr(instance, "name", None) or type(instance).__name__
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))

            model_name = _extract_model_name(instance)
            if model_name:
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)

            # Step number from ActionStep arg
            if args:
                step = args[0]
                step_number = getattr(step, "step_number", None)
                if step_number is not None:
                    span.set_attribute(
                        "gen_ai.smolagents.step_number",
                        step_number,
                    )

            try:
                yield from wrapped(*args, **kwargs)

                # After generator completes, capture step results
                if args:
                    step = args[0]
                    token_usage = getattr(step, "token_usage", None)
                    if token_usage:
                        input_tokens = getattr(token_usage, "input_tokens", None)
                        output_tokens = getattr(token_usage, "output_tokens", None)
                        if input_tokens is not None:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                input_tokens,
                            )
                        if output_tokens is not None:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                output_tokens,
                            )

                    error = getattr(step, "error", None)
                    if error:
                        span.set_attribute(
                            SemanticConvention.ERROR_TYPE,
                            type(error).__name__,
                        )

                    observations = getattr(step, "observations", None)
                    if observations and capture_message_content:
                        span.set_attribute(
                            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                            json.dumps([format_output_message(observations)]),
                        )

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                    time.time() - start_time,
                )
                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                raise

    return step_generator()


# ---------------------------------------------------------------------------
# Planning step handler
# ---------------------------------------------------------------------------


def _handle_planning_step(
    wrapped,
    instance,
    args,
    kwargs,
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Handle planning step spans."""
    _server_address, _server_port = set_server_address_and_port(instance)
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    # _generate_planning_step is also a generator
    def planning_generator():
        with tracer.start_as_current_span(span_name, kind=span_kind) as span:
            start_time = time.time()
            span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_SMOLAGENTS,
            )
            agent_name = getattr(instance, "name", None) or type(instance).__name__
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))
            span.set_attribute("gen_ai.smolagents.planning", True)

            try:
                yield from wrapped(*args, **kwargs)

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                    time.time() - start_time,
                )
                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                handle_exception(span, e)
                raise

    return planning_generator()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_agent_token_usage(span, instance):
    """Aggregate token usage from agent monitor and set on span."""
    try:
        monitor = getattr(instance, "monitor", None)
        if monitor:
            total_usage = getattr(monitor, "get_total_token_counts", None)
            if total_usage:
                usage = total_usage()
                input_tokens = getattr(usage, "input_tokens", None)
                output_tokens = getattr(usage, "output_tokens", None)
                if input_tokens:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                        input_tokens,
                    )
                if output_tokens:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                        output_tokens,
                    )
            else:
                input_count = getattr(monitor, "total_input_token_count", None)
                output_count = getattr(monitor, "total_output_token_count", None)
                if input_count:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                        input_count,
                    )
                if output_count:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                        output_count,
                    )
    except Exception:
        pass
