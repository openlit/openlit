"""
CrewAI sync wrapper — OTel GenAI semantic convention compliant.

Uses dynamic SpanKind from SPAN_KIND_MAP and deduplication contextvars
to prevent sync→async double-spanning.
"""

import time
from opentelemetry import context as context_api
from opentelemetry.trace import Link
from openlit.__helpers import handle_exception
from openlit.instrumentation.crewai.utils import (
    process_crewai_response,
    emit_create_agent_spans,
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    set_server_address_and_port,
    _crewai_crew_active,
    _crewai_flow_active,
    _current_agent_model_info,
    _compute_agent_model_info,
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
    """Create a sync wrapper for a CrewAI operation."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # crew_init: emit create_agent spans, then return
        if gen_ai_endpoint == "crew_init":
            result = wrapped(*args, **kwargs)
            try:
                contexts = emit_create_agent_spans(
                    tracer,
                    instance,
                    version,
                    environment,
                    application_name,
                    capture_message_content,
                )
                if contexts:
                    instance._openlit_creation_contexts = contexts
            except Exception:
                pass
            return result

        server_address, server_port = set_server_address_and_port(instance)
        operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        # Deduplication: set flag so the async variant (called internally)
        # knows a span already exists.
        dedup_token = None
        if gen_ai_endpoint == "crew_kickoff":
            dedup_token = _crewai_crew_active.set(True)
        elif gen_ai_endpoint == "flow_kickoff":
            dedup_token = _crewai_flow_active.set(True)

        # Propagate agent model info to child execute_tool spans
        model_info_token = None
        if gen_ai_endpoint == "task_execute_core":
            model_info_token = _current_agent_model_info.set(
                _compute_agent_model_info(instance)
            )

        # Span links: connect invoke_workflow back to create_agent spans
        links = []
        if gen_ai_endpoint in (
            "crew_kickoff",
            "crew_kickoff_for_each",
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
                    response = wrapped(*args, **kwargs)

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
            if gen_ai_endpoint == "crew_kickoff" and dedup_token is not None:
                _crewai_crew_active.reset(dedup_token)
            elif gen_ai_endpoint == "flow_kickoff" and dedup_token is not None:
                _crewai_flow_active.reset(dedup_token)
            if model_info_token is not None:
                _current_agent_model_info.reset(model_info_token)

    return wrapper
