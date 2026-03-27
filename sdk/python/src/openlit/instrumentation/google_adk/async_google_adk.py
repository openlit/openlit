"""
Google ADK async wrappers — OTel GenAI semantic convention compliant.

Handles the async-generator pattern used by ``Runner.run_async``,
``Runner.run_live``, and ``BaseAgent.run_async``.
"""

import time
from opentelemetry import context as context_api
from opentelemetry.trace import Link

from openlit.__helpers import handle_exception
from openlit.instrumentation.google_adk.utils import (
    _ADK_WORKFLOW_ACTIVE,
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    process_google_adk_response,
    capture_event_output,
    SemanticConvention,
)


def async_runner_wrap(
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
    """Create an async-generator wrapper for ``Runner.run_async`` / ``Runner.run_live``."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        if _ADK_WORKFLOW_ACTIVE.get(False):
            return wrapped(*args, **kwargs)

        operation_type = OPERATION_MAP.get(
            gen_ai_endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
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

                session_id = kwargs.get("session_id")
                if session_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_CONVERSATION_ID,
                        str(session_id),
                    )

                try:
                    generator = wrapped(*args, **kwargs)
                    async for event in generator:
                        if (
                            hasattr(event, "is_final_response")
                            and event.is_final_response()
                        ):
                            capture_event_output(span, event, capture_message_content)
                        yield event

                    process_google_adk_response(
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
                    )

                except Exception as e:
                    handle_exception(span, e)
                    raise

        return _instrumented()

    return wrapper


def async_agent_wrap(
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
    """Create an async-generator wrapper for ``BaseAgent.run_async``."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        operation_type = OPERATION_MAP.get(
            gen_ai_endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
        )
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        links = []
        agent_name = getattr(instance, "name", None)
        if agent_name:
            creation_ctx = agent_registry.get(str(agent_name))
            if creation_ctx:
                links = [Link(creation_ctx)]

        async def _instrumented():
            with tracer.start_as_current_span(
                span_name, kind=span_kind, links=links
            ) as span:
                start_time = time.time()

                ctx = args[0] if args else kwargs.get("ctx")
                if ctx:
                    session = getattr(ctx, "session", None)
                    if session:
                        session_id = getattr(session, "id", None)
                        if session_id:
                            span.set_attribute(
                                SemanticConvention.GEN_AI_CONVERSATION_ID,
                                str(session_id),
                            )

                try:
                    generator = wrapped(*args, **kwargs)
                    async for event in generator:
                        if (
                            hasattr(event, "is_final_response")
                            and event.is_final_response()
                        ):
                            capture_event_output(span, event, capture_message_content)
                        yield event

                    process_google_adk_response(
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
                    )

                except Exception as e:
                    handle_exception(span, e)
                    raise

        return _instrumented()

    return wrapper
