"""
Microsoft Agent Framework async wrappers — OTel GenAI semantic convention
compliant.

Handles AF's ``Agent.run()`` which is a sync method returning either
``Awaitable[AgentResponse]`` (stream=False) or ``ResponseStream``
(stream=True).  Also handles ``Workflow.run`` for invoke_workflow spans
and ``FunctionTool.invoke`` for execute_tool spans.
"""

import time
from opentelemetry import context as context_api
from opentelemetry import trace as trace_api
from opentelemetry.trace import Link, Status, StatusCode

from openlit.__helpers import handle_exception
from openlit.instrumentation.agent_framework.utils import (
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    process_agent_framework_response,
    _capture_input_messages,
    _capture_output_messages,
    _extract_response_attributes,
    _set_tool_attributes,
    _record_metrics,
    SemanticConvention,
)


def _serialize_content_list(result):
    """Serialize AF ``list[Content]`` to a human-readable string.

    ``Content.__str__`` already returns the text for text-type items, a
    formatted error string for error items, etc.  We join multiple items
    with newlines so the attribute stays readable.
    """
    if result is None:
        return None
    if isinstance(result, list):
        parts = [str(item) for item in result if item is not None]
        return "\n".join(parts) if parts else None
    return str(result)


def agent_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    agent_registry,
):
    """Create a wrapper for ``Agent.run()``.

    Agent.run() is a sync method that returns either:
    - Awaitable[AgentResponse] when stream=False
    - ResponseStream when stream=True

    We wrap it to intercept both paths.
    """

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        operation_type = OPERATION_MAP.get(
            gen_ai_endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
        )
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        links = []
        agent_name = getattr(instance, "name", None) or getattr(instance, "id", None)
        if agent_name:
            creation_ctx = agent_registry.get(str(agent_name))
            if creation_ctx:
                links = [Link(creation_ctx)]

        is_stream = kwargs.get("stream", False)

        if is_stream:
            return _wrap_stream(
                wrapped,
                instance,
                args,
                kwargs,
                tracer,
                span_name,
                span_kind,
                links,
                gen_ai_endpoint,
                version,
                environment,
                application_name,
                capture_message_content,
                metrics,
                disable_metrics,
            )

        return _wrap_awaitable(
            wrapped,
            instance,
            args,
            kwargs,
            tracer,
            span_name,
            span_kind,
            links,
            gen_ai_endpoint,
            version,
            environment,
            application_name,
            capture_message_content,
            metrics,
            disable_metrics,
        )

    return wrapper


def _wrap_awaitable(
    wrapped,
    instance,
    args,
    kwargs,
    tracer,
    span_name,
    span_kind,
    links,
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Wrap the non-streaming path: Agent.run(stream=False) -> Awaitable[AgentResponse]."""

    result_awaitable = wrapped(*args, **kwargs)

    async def _instrumented():
        with tracer.start_as_current_span(
            span_name, kind=span_kind, links=links
        ) as span:
            start_time = time.time()

            session = kwargs.get("session")
            if session:
                session_id = getattr(session, "service_session_id", None)
                if session_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID,
                        str(session_id),
                    )

            messages = kwargs.get("messages") or (args[0] if args else None)
            if capture_message_content and messages:
                _capture_input_messages(span, messages)

            try:
                response = await result_awaitable

                process_agent_framework_response(
                    span,
                    gen_ai_endpoint,
                    instance,
                    start_time,
                    version,
                    environment,
                    application_name,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                    response=response,
                )

                return response

            except Exception as e:
                handle_exception(span, e)
                raise

    return _instrumented()


def _wrap_stream(
    wrapped,
    instance,
    args,
    kwargs,
    tracer,
    span_name,
    span_kind,
    links,
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Wrap the streaming path: Agent.run(stream=True) -> ResponseStream.

    We activate the span in the OTel context *before* calling the original so
    that any child operations (e.g. OpenAI chat completions) created during
    stream iteration inherit this span as their parent.  The context token is
    detached when the stream finalizes or is garbage-collected.
    """

    span = tracer.start_span(span_name, kind=span_kind, links=links)
    ctx = trace_api.set_span_in_context(span)
    token = context_api.attach(ctx)
    start_time = time.time()

    try:
        result_stream = wrapped(*args, **kwargs)
    except Exception as e:
        handle_exception(span, e)
        context_api.detach(token)
        span.end()
        raise

    session = kwargs.get("session")
    if session:
        session_id = getattr(session, "service_session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID,
                str(session_id),
            )

    messages = kwargs.get("messages") or (args[0] if args else None)
    if capture_message_content and messages:
        _capture_input_messages(span, messages)

    span_state = {"closed": False}

    def _close_span():
        if span_state["closed"]:
            return
        span_state["closed"] = True
        try:
            context_api.detach(token)
        except Exception:
            pass
        span.end()

    async def _finalize_stream():
        try:
            response = await result_stream.get_final_response()
            _extract_response_attributes(span, response)
            if capture_message_content:
                _capture_output_messages(span, response)

            process_agent_framework_response(
                span,
                gen_ai_endpoint,
                instance,
                start_time,
                version,
                environment,
                application_name,
                capture_message_content,
                metrics,
                disable_metrics,
                response=response,
            )
        except Exception as e:
            handle_exception(span, e)
        finally:
            _close_span()

    try:
        wrapped_stream = result_stream.with_cleanup_hook(_finalize_stream)
    except (AttributeError, TypeError):
        _close_span()
        return result_stream

    import weakref

    weakref.finalize(wrapped_stream, _close_span)

    return wrapped_stream


def tool_execute_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    agent_registry,
):
    """Create a wrapper for ``FunctionTool.invoke()`` that emits ``execute_tool`` spans.

    The tool span is automatically a child of the active ``invoke_agent`` span
    because OTel context propagation is in effect during agent execution.
    """

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        operation_type = OPERATION_MAP.get(
            gen_ai_endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS
        )
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        tool_call_id = kwargs.get("tool_call_id")
        raw_arguments = kwargs.get("arguments")
        if raw_arguments is not None:
            if hasattr(raw_arguments, "model_dump"):
                tool_arguments = raw_arguments.model_dump()
            elif isinstance(raw_arguments, dict):
                tool_arguments = dict(raw_arguments)
            else:
                tool_arguments = raw_arguments
        else:
            tool_arguments = None

        async def _instrumented():
            with tracer.start_as_current_span(span_name, kind=span_kind) as span:
                start_time = time.time()

                span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)
                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_AGENT_FRAMEWORK,
                )
                span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
                span.set_attribute(
                    SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                )

                _set_tool_attributes(
                    span,
                    instance,
                    capture_message_content,
                    tool_call_id=tool_call_id,
                    arguments=tool_arguments,
                )

                try:
                    result = await wrapped(*args, **kwargs)

                    serialized_result = _serialize_content_list(result)
                    _set_tool_attributes(
                        span,
                        None,
                        capture_message_content,
                        result=serialized_result,
                    )

                    duration = time.time() - start_time

                    if not disable_metrics and metrics:
                        _record_metrics(
                            metrics,
                            operation_type,
                            duration,
                            environment,
                            application_name,
                            "unknown",
                            "",
                            0,
                        )

                    span.set_status(Status(StatusCode.OK))
                    return result

                except Exception as e:
                    handle_exception(span, e)
                    raise

        return _instrumented()

    return wrapper


def workflow_run_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    agent_registry,
):
    """Create a wrapper for ``Workflow.run()`` that emits ``invoke_workflow`` spans."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        operation_type = OPERATION_MAP.get(
            gen_ai_endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
        )
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        links = []
        all_contexts = agent_registry.get_all()
        if all_contexts:
            links = [Link(ctx) for ctx in all_contexts]

        async def _instrumented():
            with tracer.start_as_current_span(
                span_name, kind=span_kind, links=links
            ) as span:
                start_time = time.time()

                try:
                    response = await wrapped(*args, **kwargs)

                    process_agent_framework_response(
                        span,
                        gen_ai_endpoint,
                        instance,
                        start_time,
                        version,
                        environment,
                        application_name,
                        capture_message_content,
                        metrics,
                        disable_metrics,
                        response=response,
                    )

                    return response

                except Exception as e:
                    handle_exception(span, e)
                    raise

        return _instrumented()

    return wrapper
