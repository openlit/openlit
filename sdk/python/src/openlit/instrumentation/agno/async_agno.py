"""
Agno async wrapper — OTel GenAI semantic convention compliant.

Mirrors the sync wrapper with async/await support and checks
deduplication flags set by the sync wrapper to prevent double-spanning.
Handles streaming via async generator wrappers.
"""

import logging
import time
from opentelemetry import context as context_api
from opentelemetry.trace import Link
from openlit.__helpers import handle_exception
from openlit.instrumentation.agno.utils import (
    process_agno_response,
    OPERATION_MAP,
    get_span_kind,
    generate_span_name,
    _agno_team_active,
    _agno_workflow_active,
    _current_agent_model_info,
    _compute_agent_model_info,
    _agno_parent_agent,
)

logger = logging.getLogger(__name__)


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
    """Create an async wrapper for an Agno operation."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # Deduplication: if the sync variant already created a span, pass through
        if gen_ai_endpoint == "team_arun" and _agno_team_active.get():
            return wrapped(*args, **kwargs)
        if gen_ai_endpoint == "workflow_arun" and _agno_workflow_active.get():
            return wrapped(*args, **kwargs)

        # Streaming agent/team runs: return async generator wrapper
        if gen_ai_endpoint in ("agent_arun", "agent_acontinue_run") and kwargs.get("stream", False):
            return _arun_stream_wrapper(
                wrapped, instance, args, kwargs, gen_ai_endpoint,
                tracer, version, environment, application_name,
                pricing_info, capture_message_content, metrics,
                disable_metrics,
            )

        if gen_ai_endpoint == "team_arun" and kwargs.get("stream", False):
            return _team_arun_stream_wrapper(
                wrapped, instance, args, kwargs, gen_ai_endpoint,
                tracer, version, environment, application_name,
                pricing_info, capture_message_content, metrics,
                disable_metrics,
            )

        # Non-streaming: return coroutine
        return _async_invoke(
            wrapped, instance, args, kwargs, gen_ai_endpoint,
            tracer, version, environment, application_name,
            pricing_info, capture_message_content, metrics,
            disable_metrics,
        )

    return wrapper


async def _async_invoke(
    wrapped, instance, args, kwargs, gen_ai_endpoint,
    tracer, version, environment, application_name,
    pricing_info, capture_message_content, metrics,
    disable_metrics,
):
    """Coroutine helper for non-streaming async operations."""
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    # Propagate agent model info and instance to child execute_tool spans
    model_info_token = None
    parent_agent_token = None
    if gen_ai_endpoint.startswith("agent_"):
        model_info_token = _current_agent_model_info.set(
            _compute_agent_model_info(instance)
        )
        parent_agent_token = _agno_parent_agent.set(instance)

    # Dedup tokens
    dedup_token = None
    if gen_ai_endpoint == "team_arun":
        dedup_token = _agno_team_active.set(True)
    elif gen_ai_endpoint == "workflow_arun":
        dedup_token = _agno_workflow_active.set(True)

    # Span links: connect back to create_agent spans
    links = []
    if gen_ai_endpoint == "team_arun":
        members = getattr(instance, "members", None) or getattr(
            instance, "agents", None
        ) or []
        for member in members:
            creation_ctx = getattr(member, "_openlit_creation_context", None)
            if creation_ctx:
                links.append(Link(creation_ctx))
    elif gen_ai_endpoint.startswith("agent_"):
        creation_ctx = getattr(instance, "_openlit_creation_context", None)
        if creation_ctx:
            links.append(Link(creation_ctx))

    try:
        with tracer.start_as_current_span(
            span_name, kind=span_kind, links=links
        ) as span:
            start_time = time.time()
            try:
                response = await wrapped(*args, **kwargs)

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
        if gen_ai_endpoint == "team_arun" and dedup_token is not None:
            _agno_team_active.reset(dedup_token)
        elif gen_ai_endpoint == "workflow_arun" and dedup_token is not None:
            _agno_workflow_active.reset(dedup_token)
        if model_info_token is not None:
            _current_agent_model_info.reset(model_info_token)
        if parent_agent_token is not None:
            _agno_parent_agent.reset(parent_agent_token)


async def _arun_stream_wrapper(
    wrapped, instance, args, kwargs, gen_ai_endpoint,
    tracer, version, environment, application_name,
    pricing_info, capture_message_content, metrics,
    disable_metrics,
):
    """Async generator wrapper for Agent.arun(stream=True).

    Injects yield_run_output=True to capture the final RunOutput for
    telemetry extraction, then keeps the span open for the full duration.
    """
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_agent")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    model_info_token = None
    parent_agent_token = None
    if gen_ai_endpoint.startswith("agent_"):
        model_info_token = _current_agent_model_info.set(
            _compute_agent_model_info(instance)
        )
        parent_agent_token = _agno_parent_agent.set(instance)

    links = []
    if gen_ai_endpoint.startswith("agent_"):
        creation_ctx = getattr(instance, "_openlit_creation_context", None)
        if creation_ctx:
            links.append(Link(creation_ctx))

    with tracer.start_as_current_span(span_name, kind=span_kind, links=links) as span:
        start_time = time.time()
        final_response = None
        try:
            try:
                from agno.run.agent import RunOutput  # noqa: WPS433
            except Exception:
                RunOutput = None

            yield_run_output = kwargs.get("yield_run_output", None) or kwargs.get(
                "yield_run_response", None
            )
            new_kwargs = dict(kwargs)
            new_kwargs["yield_run_output"] = True

            async for response in wrapped(*args, **new_kwargs):
                if RunOutput and isinstance(response, RunOutput):
                    final_response = response
                    if yield_run_output:
                        yield response
                else:
                    yield response

            if not RunOutput:
                final_response = getattr(instance, "run_response", None)
        except GeneratorExit:
            pass
        except Exception as e:
            handle_exception(span, e)
            logger.error("Error in async agent stream: %s", e)
            raise
        finally:
            try:
                process_agno_response(
                    final_response,
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
            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in async agent stream telemetry: %s", e)
            if model_info_token is not None:
                _current_agent_model_info.reset(model_info_token)
            if parent_agent_token is not None:
                _agno_parent_agent.reset(parent_agent_token)


async def _team_arun_stream_wrapper(
    wrapped, instance, args, kwargs, gen_ai_endpoint,
    tracer, version, environment, application_name,
    pricing_info, capture_message_content, metrics,
    disable_metrics,
):
    """Async generator wrapper for Team._arun_stream / Team.arun(stream=True)."""
    operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_workflow")
    span_kind = get_span_kind(operation_type)
    span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

    # Span links
    links = []
    members = getattr(instance, "members", None) or getattr(
        instance, "agents", None
    ) or []
    for member in members:
        creation_ctx = getattr(member, "_openlit_creation_context", None)
        if creation_ctx:
            links.append(Link(creation_ctx))

    with tracer.start_as_current_span(
        span_name, kind=span_kind, links=links
    ) as span:
        start_time = time.time()
        final_response = None
        try:
            try:
                from agno.run.team import TeamRunOutput  # noqa: WPS433
            except Exception:
                TeamRunOutput = None

            yield_run_response = kwargs.get("yield_run_response", None)
            new_kwargs = dict(kwargs)
            new_kwargs["yield_run_response"] = True

            async for response in wrapped(*args, **new_kwargs):
                if TeamRunOutput and isinstance(response, TeamRunOutput):
                    final_response = response
                    if yield_run_response:
                        yield response
                else:
                    yield response

            if not TeamRunOutput:
                final_response = getattr(instance, "run_response", None)
        except GeneratorExit:
            pass
        except Exception as e:
            handle_exception(span, e)
            logger.error("Error in team stream run: %s", e)
            raise
        finally:
            try:
                process_agno_response(
                    final_response,
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
            except Exception as e:
                handle_exception(span, e)
                logger.error("Error creating team stream trace: %s", e)


def async_workflow_wrap(
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
    """Wrapper for Workflow.arun which may return an async iterator."""

    async def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            result = wrapped(*args, **kwargs)
            if hasattr(result, "__aiter__"):
                async for item in result:
                    yield item
                return
            yield await result
            return

        if _agno_workflow_active.get():
            result = wrapped(*args, **kwargs)
            if hasattr(result, "__aiter__"):
                async for item in result:
                    yield item
                return
            yield await result
            return

        operation_type = OPERATION_MAP.get(gen_ai_endpoint, "invoke_workflow")
        span_kind = get_span_kind(operation_type)
        span_name = generate_span_name(gen_ai_endpoint, instance, args, kwargs)

        with tracer.start_as_current_span(span_name, kind=span_kind) as span:
            start_time = time.time()
            result = wrapped(*args, **kwargs)

            if hasattr(result, "__aiter__"):
                final_response = None
                try:
                    async for event in result:
                        final_response = event
                        yield event
                except Exception as e:
                    handle_exception(span, e)
                    raise
                finally:
                    try:
                        process_agno_response(
                            final_response,
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
                    except Exception as e:
                        handle_exception(span, e)
            else:
                try:
                    response = await result
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
                    yield response
                except Exception as e:
                    handle_exception(span, e)
                    raise

    return wrapper
