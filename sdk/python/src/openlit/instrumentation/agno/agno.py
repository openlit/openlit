"""
Agno sync wrapper — OTel GenAI semantic convention compliant.

Uses dynamic SpanKind from SPAN_KIND_MAP and deduplication contextvars
to prevent double-spanning (Team.run -> Agent.run internally).
"""

import time
from opentelemetry import context as context_api
from opentelemetry.trace import Link
from openlit.__helpers import handle_exception
from openlit.instrumentation.agno.utils import (
    process_agno_response,
    emit_create_agent_spans,
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    _agno_team_active,
    _agno_workflow_active,
    _current_agent_model_info,
    _compute_agent_model_info,
    _agno_parent_agent,
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
    """Create a sync wrapper for an Agno operation."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # agent_init: emit create_agent span, then return
        if gen_ai_endpoint == "agent_init":
            result = wrapped(*args, **kwargs)
            try:
                ctx = emit_create_agent_spans(
                    tracer,
                    instance,
                    version,
                    environment,
                    application_name,
                    capture_message_content,
                )
                if ctx:
                    instance._openlit_creation_context = ctx
            except Exception:
                pass
            return result

        operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        # Deduplication: set flag so nested calls know a span already exists
        dedup_token = None
        if gen_ai_endpoint == "team_run":
            dedup_token = _agno_team_active.set(True)
        elif gen_ai_endpoint == "workflow_run":
            dedup_token = _agno_workflow_active.set(True)

        # Propagate agent model info and instance to child execute_tool spans
        model_info_token = None
        parent_agent_token = None
        if gen_ai_endpoint.startswith("agent_"):
            model_info_token = _current_agent_model_info.set(
                _compute_agent_model_info(instance)
            )
            parent_agent_token = _agno_parent_agent.set(instance)

        # Span links: connect back to create_agent spans
        links = []
        if gen_ai_endpoint == "team_run":
            members = (
                getattr(instance, "members", None)
                or getattr(instance, "agents", None)
                or []
            )
            for member in members:
                creation_ctx = getattr(member, "_openlit_creation_context", None)
                if creation_ctx:
                    links.append(Link(creation_ctx))
        elif gen_ai_endpoint.startswith("agent_") and gen_ai_endpoint != "agent_init":
            creation_ctx = getattr(instance, "_openlit_creation_context", None)
            if creation_ctx:
                links.append(Link(creation_ctx))

        try:
            with tracer.start_as_current_span(
                span_name, kind=span_kind, links=links
            ) as span:
                start_time = time.time()
                try:
                    response = wrapped(*args, **kwargs)

                    process_agno_response(
                        response,
                        gen_ai_endpoint,
                        span,
                        instance,
                        args,
                        kwargs,
                        start_time,
                        environment,
                        application_name,
                        metrics,
                        capture_message_content,
                        disable_metrics,
                        version,
                    )

                    return response

                except Exception as e:
                    handle_exception(span, e)
                    raise
        finally:
            if gen_ai_endpoint == "team_run" and dedup_token is not None:
                _agno_team_active.reset(dedup_token)
            elif gen_ai_endpoint == "workflow_run" and dedup_token is not None:
                _agno_workflow_active.reset(dedup_token)
            if model_info_token is not None:
                _current_agent_model_info.reset(model_info_token)
            if parent_agent_token is not None:
                _agno_parent_agent.reset(parent_agent_token)

    return wrapper
