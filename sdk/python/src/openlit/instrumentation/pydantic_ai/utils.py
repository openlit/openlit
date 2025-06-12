"""
Pydantic AI OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    extract_and_format_input,
    get_chat_model_cost,
    create_metrics_attributes,
    otel_event,
    concatenate_all_contents
)
from openlit.semcov import SemanticConvention

def common_agent_run(wrapped, instance, args, kwargs, tracer, version, environment, application_name,
                         capture_message_content, response):
    server_address, server_port = instance.model.base_url, 443
    agent_name = instance.name or "pydantic_agent"
    request_model = str(instance.model.model_name)
    span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK} {agent_name}'
    
    with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
        try:
            start_time = time.time()
            end_time = time.time()
            set_span_attributes(span, version, SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK,
                                environment, application_name, server_address, server_port, request_model, agent_name)
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(instance._system_prompts))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, request_model)

            if capture_message_content:
                span.add_event(
                    name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                    attributes={
                        SemanticConvention.GEN_AI_CONTENT_COMPLETION: response.output,
                    },
                )

            span.set_status(Status(StatusCode.OK))

            return response

        except Exception as e:
            handle_exception(span, e)
            logger.error('Error in trace creation: %s', e)
            return response



