"""Sync TypeSafe System One wrapper."""

import time

from opentelemetry.trace import SpanKind

from openlit.instrumentation.typesafe.utils import (
    extract_request,
    handle_exception,
    process_system_one_response,
    question_metadata,
    record_error_metrics,
    server_address_and_port,
    set_request_span_attributes,
)
from openlit.semcov import SemanticConvention


def system_one(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """Wrap TypeSafeClient.system_one with a decision CLIENT span."""

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = server_address_and_port(instance)
        state, questions, request_model = extract_request(instance, args, kwargs)
        question_count, question_ids, question_types = question_metadata(questions)
        # OTel GenAI inference span name: `{gen_ai.operation.name} {gen_ai.request.model}`
        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_DECISION} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_request_span_attributes(
                span,
                request_model,
                server_address,
                server_port,
                environment,
                application_name,
                version,
                question_count,
                question_ids,
                question_types,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                record_error_metrics(
                    metrics,
                    disable_metrics,
                    server_address,
                    server_port,
                    request_model,
                    environment,
                    application_name,
                    start_time,
                    e,
                )
                raise

            try:
                return process_system_one_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                    state=state,
                    questions=questions,
                )
            except Exception as e:
                handle_exception(span, e)
                record_error_metrics(
                    metrics,
                    disable_metrics,
                    server_address,
                    server_port,
                    request_model,
                    environment,
                    application_name,
                    start_time,
                    e,
                )
                return response

    return wrapper
