# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, too-many-branches
"""
Module for monitoring LiteLLM calls.
"""

import logging
import json
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def _parse_tools(tools):
    result = []
    for tool in tools:
        res = {}
        if hasattr(tool, "name") and tool.name is not None:
            res["name"] = tool.name
        if hasattr(tool, "description") and tool.description is not None:
            res["description"] = tool.description
        if res:
            result.append(res)
    return json.dumps(result)

def crew_wrap(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the CrewAI Agent.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of CrewAI usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat.completions' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat.completions' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat.completions' method.
            kwargs: Keyword arguments for the 'chat.completions' method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_CREWAI)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)

                instance_class = instance.__class__.__name__

                if instance_class == "Task":
                    task = {}
                    for key, value in instance.__dict__.items():
                        if value is None:
                            continue
                        if key == "tools":
                            value = _parse_tools(value)
                            task[key] = value
                        elif key == "agent":
                            task[key] = value.role
                        else:
                            task[key] = str(value)

                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_TASK_ID,
                                        task.get('id', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_TASK,
                                        task.get('description', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_EXPECTED_OUTPUT,
                                        task.get('expected_output', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ACTUAL_OUTPUT,
                                        task.get('output', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_HUMAN_INPUT,
                                        task.get('human_input', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_TASK_ASSOCIATION,
                                       str(task.get('processed_by_agents', '')))

                elif instance_class == "Agent":
                    agent = {}
                    for key, value in instance.__dict__.items():
                        if key == "tools":
                            value = _parse_tools(value)
                        if value is None:
                            continue
                        agent[key] = str(value)

                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID,
                                        agent.get('id', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ROLE,
                                        agent.get('role', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_GOAL,
                                        agent.get('goal', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_CONTEXT,
                                        agent.get('backstory', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ENABLE_CACHE,
                                        agent.get('cache', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ALLOW_DELEGATION,
                                        agent.get('allow_delegation', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_ALLOW_CODE_EXECUTION,
                                        agent.get('allow_code_execution', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_MAX_RETRY_LIMIT,
                                        agent.get('max_retry_limit', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_TOOLS,
                                        str(agent.get('tools', '')))
                    span.set_attribute(SemanticConvention.GEN_AI_AGENT_TOOL_RESULTS,
                                        str(agent.get('tools_results', '')))

                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
