"""
Agent SRE sync wrappers for OpenLIT instrumentation.

Wraps SLO evaluation, chaos experiments, error budget events, and SLI
recordings with OpenTelemetry spans and metrics.
"""

import time
from opentelemetry.trace import SpanKind, StatusCode
from opentelemetry import context as context_api
from openlit.__helpers import handle_exception
from openlit.instrumentation.agent_sre.utils import (
    set_slo_span_attributes,
    set_chaos_span_attributes,
    set_error_budget_span_attributes,
    set_sli_span_attributes,
    record_sre_metrics,
)


def wrap_slo_evaluate(
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
    """Wrapper for SLO.evaluate() — captures SLO status as a span."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        slo_name = getattr(instance, "name", "unknown")
        span_name = f"slo.evaluate {slo_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            start_time = time.time()

            try:
                response = wrapped(*args, **kwargs)

                set_slo_span_attributes(
                    span, instance, response, version, environment,
                    application_name,
                )

                if not disable_metrics and metrics:
                    record_sre_metrics(
                        metrics, "slo_evaluate", instance, response,
                        time.time() - start_time,
                    )

                return response
            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


def wrap_chaos_start(
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
    """Wrapper for ChaosExperiment.start() — creates chaos experiment span."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        exp_name = getattr(instance, "name", "unknown")
        span_name = f"chaos.start {exp_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            try:
                response = wrapped(*args, **kwargs)

                set_chaos_span_attributes(
                    span, instance, "start", version, environment,
                    application_name,
                )

                if not disable_metrics and metrics:
                    record_sre_metrics(
                        metrics, "chaos_start", instance, None,
                        0,
                    )

                return response
            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


def wrap_chaos_complete(
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
    """Wrapper for ChaosExperiment.complete()/abort() — records experiment result."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        exp_name = getattr(instance, "name", "unknown")
        action = "complete" if "complete" in gen_ai_endpoint else "abort"
        span_name = f"chaos.{action} {exp_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            start_time = time.time()

            try:
                response = wrapped(*args, **kwargs)

                set_chaos_span_attributes(
                    span, instance, action, version, environment,
                    application_name,
                )

                if not disable_metrics and metrics:
                    record_sre_metrics(
                        metrics, f"chaos_{action}", instance, None,
                        time.time() - start_time,
                    )

                return response
            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


def wrap_error_budget_record(
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
    """Wrapper for ErrorBudget.record_event() — tracks budget consumption."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        good = args[0] if args else kwargs.get("good", True)
        event_type = "good" if good else "bad"
        span_name = f"error_budget.record {event_type}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            try:
                response = wrapped(*args, **kwargs)

                set_error_budget_span_attributes(
                    span, instance, good, version, environment,
                    application_name,
                )

                if not disable_metrics and metrics:
                    record_sre_metrics(
                        metrics, "error_budget_record", instance,
                        {"good": good}, 0,
                    )

                return response
            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


def wrap_sli_record(
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
    """Wrapper for SLI.record() — captures individual SLI measurements."""

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        sli_name = getattr(instance, "name", gen_ai_endpoint)
        span_name = f"sli.record {sli_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.INTERNAL) as span:
            try:
                response = wrapped(*args, **kwargs)

                set_sli_span_attributes(
                    span, instance, args, version, environment,
                    application_name,
                )

                return response
            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper
