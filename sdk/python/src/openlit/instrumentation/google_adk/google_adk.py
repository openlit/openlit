"""
Google ADK sync wrapper — OTel GenAI semantic convention compliant.

Wraps ``Runner.run`` which is a synchronous method that internally
calls ``Runner.run_async`` via ``asyncio.run``.
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
    SemanticConvention,
)


def sync_runner_wrap(
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
    """Create a sync wrapper for ``Runner.run``."""

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

            tok = _ADK_WORKFLOW_ACTIVE.set(True)
            try:
                response = wrapped(*args, **kwargs)

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

                return response

            except Exception as e:
                handle_exception(span, e)
                raise
            finally:
                _ADK_WORKFLOW_ACTIVE.reset(tok)

    return wrapper
