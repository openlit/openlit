"""
Module for monitoring AG2 API calls.
"""

import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port
)
from openlit.instrumentation.ag2.utils import (
    process_agent_creation,
    process_agent_run,
)
from openlit.semcov import SemanticConvention

def conversable_agent(version, environment, application_name, tracer, pricing_info,
    capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for AG2 conversable agent creation.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the AG2 conversable agent creation call.
        """

        server_address, server_port = set_server_address_and_port(instance, "127.0.0.1", 80)
        agent_name = kwargs.get("name", "NOT_FOUND")
        llm_config = kwargs.get("llm_config", {})
        system_message = kwargs.get("system_message", "")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)

            try:
                process_agent_creation(
                    agent_name=agent_name,
                    llm_config=llm_config,
                    system_message=system_message,
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
                    version=version
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper

def agent_run(version, environment, application_name, tracer, pricing_info,
    capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for AG2 agent run execution.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the AG2 agent run execution call.
        """

        server_address, server_port = set_server_address_and_port(instance, "127.0.0.1", 80)

        # Extract agent name from instance
        agent_name = getattr(instance, "name", "NOT_FOUND")

        # Extract model from instance llm_config
        request_model = "gpt-4o"
        if hasattr(instance, "llm_config") and isinstance(instance.llm_config, dict):
            request_model = instance.llm_config.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK} {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)

            try:
                response = process_agent_run(
                    response=response,
                    agent_name=agent_name,
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
                    version=version
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper
