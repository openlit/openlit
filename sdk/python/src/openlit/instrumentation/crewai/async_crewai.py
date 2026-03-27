"""
CrewAI async wrapper — OTel GenAI semantic convention compliant.

Mirrors the sync wrapper with async/await support and checks
deduplication flags set by the sync wrapper to prevent double-spanning.
"""

import time
from opentelemetry import context as context_api
from opentelemetry.trace import Link
from openlit.__helpers import handle_exception
from openlit.instrumentation.crewai.utils import (
    process_crewai_response,
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    set_server_address_and_port,
    _crewai_crew_active,
    _crewai_flow_active,
    _current_agent_model_info,
    _compute_agent_model_info,
)


def async_general_wrap(
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
    """Create an async wrapper for a CrewAI operation."""

    async def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return await wrapped(*args, **kwargs)

        # Deduplication: if the sync variant already created a span, pass through.
        if gen_ai_endpoint == "crew_kickoff_async" and _crewai_crew_active.get():
            return await wrapped(*args, **kwargs)
        if gen_ai_endpoint == "flow_kickoff_async" and _crewai_flow_active.get():
            return await wrapped(*args, **kwargs)

        server_address, server_port = set_server_address_and_port(instance)
        operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        # Propagate agent model info to child execute_tool spans
        model_info_token = None
        if gen_ai_endpoint == "task_execute_core":
            model_info_token = _current_agent_model_info.set(
                _compute_agent_model_info(instance)
            )

        # Span links: connect invoke_workflow back to create_agent spans
        links = []
        if gen_ai_endpoint in (
            "crew_kickoff_async",
            "crew_kickoff_for_each_async",
        ):
            creation_ctxs = getattr(instance, "_openlit_creation_contexts", None)
            if creation_ctxs:
                links = [Link(ctx) for ctx in creation_ctxs]

        try:
            with tracer.start_as_current_span(
                span_name, kind=span_kind, links=links
            ) as span:
                start_time = time.time()
                try:
                    response = await wrapped(*args, **kwargs)

                    process_crewai_response(
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
            if model_info_token is not None:
                _current_agent_model_info.reset(model_info_token)

    return wrapper
