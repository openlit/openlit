"""
Module for monitoring OpenAI Agents API calls (async version).
"""

import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port
)
from openlit.instrumentation.openai_agents.utils import (
    process_agent_creation,
)
from openlit.semcov import SemanticConvention

def async_create_agent(version, environment, application_name, tracer, pricing_info,
    capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for OpenAI Agents async agent creation.
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI Agents async agent creation call.
        """

        server_address, server_port = set_server_address_and_port(instance, "127.0.0.1", 80)
        agent_name = kwargs.get("name", "openai_agent")
        agent_model = kwargs.get("model", "gpt-4o")
        agent_instructions = kwargs.get("instructions", "")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)

            try:
                process_agent_creation(
                    agent_name=agent_name,
                    agent_model=agent_model,
                    agent_instructions=agent_instructions,
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