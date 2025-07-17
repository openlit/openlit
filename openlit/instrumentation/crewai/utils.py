"""
CrewAI instrumentation utilities for processing spans and telemetry data.
"""

import json
import time
from typing import Any, Dict, Optional

from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
    record_framework_metrics,
    get_chat_model_cost
)
from openlit.semcov import SemanticConvention

# Operation mapping for CrewAI components following semantic conventions
OPERATION_MAP = {
    # Crew operations - workflow level
    "crew.kickoff": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "crew.kickoff_async": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "crew.kickoff_for_each": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "crew.kickoff_for_each_async": SemanticConvention.GEN_AI_OPERATION_CHAT,

    # Agent operations - agent level
    "agent.execute_task": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "agent.execute_task_async": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "agent.ask_question": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "agent.ask_question_async": SemanticConvention.GEN_AI_OPERATION_CHAT,

    # Task operations - task level
    "task.execute": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "task.execute_async": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "task.execute_sync": SemanticConvention.GEN_AI_OPERATION_CHAT,

    # Tool operations - tool level
    "tool.run": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "tool.run_async": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "tool._run": SemanticConvention.GEN_AI_OPERATION_CHAT,
    "tool._arun": SemanticConvention.GEN_AI_OPERATION_CHAT,
}


def _get_span_name(endpoint: str, instance: Any = None,
                   args: tuple = None, kwargs: dict = None) -> str:
    """
    Generate semantic span name following OpenTelemetry conventions.

    Args:
        endpoint: The operation endpoint
        instance: The instance being operated on
        args: Positional arguments (currently unused)
        kwargs: Keyword arguments (currently unused)

    Returns:
        Formatted span name
    """
    try:
        # Extract operation and target for naming
        parts = endpoint.split('.')
        if len(parts) >= 2:
            operation = parts[-1]  # Last part is operation
            target = parts[-2]     # Second to last is target type

            # Get specific name from instance
            if hasattr(instance, 'role'):
                return f"{operation} {instance.role}"
            if hasattr(instance, 'description') and instance.description:
                # Truncate long descriptions
                desc = str(instance.description)[:50]
                return f"{operation} {desc}"
            if hasattr(instance, '__class__'):
                return f"{operation} {instance.__class__.__name__}"

            return f"{operation} {target}"

        return endpoint

    except Exception:  # pylint: disable=broad-exception-caught
        return endpoint


def general_wrap(endpoint, version, environment, application_name, tracer,
                 pricing_info, capture_message_content, metrics,
                 disable_metrics):
    """
    General wrapper function for CrewAI operations using OpenTelemetry tracing.
    """
    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # Create scope object for common attributes
        scope = type("GenericScope", (), {})()
        scope._span = None  # pylint: disable=protected-access
        scope._start_time = None  # pylint: disable=protected-access
        scope._end_time = None  # pylint: disable=protected-access

        # ... existing code ...

class _ScopeWrapper:
    """Scope wrapper for telemetry data."""

    def __init__(self, span, start_time, end_time):
        self._span = span
        self._start_time = start_time
        self._end_time = end_time


def _get_operation_name(endpoint: str) -> str:
    """Get operation name from endpoint."""
    return OPERATION_MAP.get(endpoint, SemanticConvention.GEN_AI_OPERATION_CHAT)


def _format_content(content: Any) -> str:
    """Format content for telemetry."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return json.dumps(content)
    return str(content)


def process_crew_kickoff(scope, endpoint=None, instance=None,
                         result=None, **kwargs):
    """
    Process crew kickoff operation telemetry.

    Args:
        scope: Telemetry scope object
        endpoint: Operation endpoint (currently unused)
        instance: Crew instance
        result: Operation result
        **kwargs: Additional arguments
    """
    try:
        span = scope._span  # pylint: disable=protected-access

        # Set crew-level attributes
        if hasattr(instance, 'process'):
            span.set_attribute(
                SemanticConvention.GEN_AI_CREW_PROCESS,
                str(instance.process)
            )

        if hasattr(instance, 'agents'):
            span.set_attribute(
                SemanticConvention.GEN_AI_CREW_AGENTS_COUNT,
                len(instance.agents)
            )

            # Add agent roles
            agent_roles = [getattr(agent, 'role', 'Unknown')
                          for agent in instance.agents]
            span.set_attribute(
                "gen_ai.crew.agent_roles",
                json.dumps(agent_roles)
            )

        if hasattr(instance, 'tasks'):
            span.set_attribute(
                SemanticConvention.GEN_AI_CREW_TASKS_COUNT,
                len(instance.tasks)
            )

        # Process result
        if result:
            result_str = str(result)[:1000]  # Limit result size
            span.set_attribute(
                SemanticConvention.GEN_AI_RESPONSE_CONTENT,
                result_str
            )

    except Exception as e:  # pylint: disable=broad-exception-caught
        handle_exception(span, e)


def process_agent_execution(scope, endpoint=None, instance=None,
                           result=None, **kwargs):
    """
    Process agent execution telemetry.

    Args:
        scope: Telemetry scope object
        endpoint: Operation endpoint (currently unused)
        instance: Agent instance
        result: Operation result
        **kwargs: Additional arguments
    """
    try:
        span = scope._span  # pylint: disable=protected-access

        # Set agent-level attributes
        if hasattr(instance, 'role'):
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME,
                              instance.role)

        if hasattr(instance, 'goal'):
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_GOAL,
                              str(instance.goal))

        if hasattr(instance, 'backstory'):
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                              str(instance.backstory))

        if hasattr(instance, 'llm') and hasattr(instance.llm, 'model'):
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                              instance.llm.model)

        # Process result
        if result:
            result_str = str(result)[:1000]
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_CONTENT,
                              result_str)

    except Exception as e:  # pylint: disable=broad-exception-caught
        handle_exception(span, e)


def process_task_execution(scope, endpoint=None, instance=None,
                          result=None, **kwargs):
    """
    Process task execution telemetry.

    Args:
        scope: Telemetry scope object
        endpoint: Operation endpoint (currently unused)
        instance: Task instance
        result: Operation result
        **kwargs: Additional arguments
    """
    try:
        span = scope._span  # pylint: disable=protected-access

        # Set task-level attributes
        if hasattr(instance, 'description'):
            span.set_attribute(SemanticConvention.GEN_AI_TASK_DESCRIPTION,
                              str(instance.description))

        if hasattr(instance, 'expected_output'):
            span.set_attribute(SemanticConvention.GEN_AI_TASK_EXPECTED_OUTPUT,
                              str(instance.expected_output))

        if hasattr(instance, 'agent') and hasattr(instance.agent, 'role'):
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME,
                              instance.agent.role)

        # Process result
        if result:
            result_str = str(result)[:1000]
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_CONTENT,
                              result_str)

    except Exception as e:  # pylint: disable=broad-exception-caught
        handle_exception(span, e)


def process_tool_execution(scope, endpoint=None, instance=None,
                          result=None, **kwargs):
    """
    Process tool execution telemetry.

    Args:
        scope: Telemetry scope object
        endpoint: Operation endpoint (currently unused)
        instance: Tool instance
        result: Operation result
        **kwargs: Additional arguments
    """
    try:
        span = scope._span  # pylint: disable=protected-access

        # Set tool-level attributes
        if hasattr(instance, 'name'):
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME,
                              instance.name)

        if hasattr(instance, 'description'):
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                              str(instance.description))

        # Process result
        if result:
            result_str = str(result)[:1000]
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_CONTENT,
                              result_str)

    except Exception as e:  # pylint: disable=broad-exception-caught
        handle_exception(span, e)


def process_generic_operation(scope, endpoint=None, instance=None,
                             result=None, **kwargs):
    """
    Process generic operation telemetry for unknown operation types.

    Args:
        scope: Telemetry scope object
        endpoint: Operation endpoint (currently unused)
        instance: Operation instance
        result: Operation result
        **kwargs: Additional arguments
    """
    try:
        span = scope._span  # pylint: disable=protected-access

        # Add generic attributes based on available instance data
        if hasattr(instance, '__class__'):
            span.set_attribute("gen_ai.component.type",
                              instance.__class__.__name__)

        # Try to extract useful attributes from instance
        for attr in ['name', 'role', 'description']:
            if hasattr(instance, attr):
                value = getattr(instance, attr)
                if value:
                    span.set_attribute(f"gen_ai.component.{attr}",
                                      str(value))

        # Process result
        if result:
            result_str = str(result)[:1000]
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_CONTENT,
                              result_str)

    except Exception as e:  # pylint: disable=broad-exception-caught
        handle_exception(span, e)


def process_response(scope, endpoint=None, instance=None, result=None,
                    **kwargs):
    """
    Main response processor that routes to specific handlers.

    Args:
        scope: Telemetry scope object
        endpoint: Operation endpoint
        instance: Operation instance
        result: Operation result
        **kwargs: Additional arguments
    """
    try:
        # Route to specific processor based on endpoint
        if endpoint and 'crew' in endpoint.lower():
            process_crew_kickoff(scope, endpoint, instance, result, **kwargs)
        elif endpoint and 'agent' in endpoint.lower():
            process_agent_execution(scope, endpoint, instance,
                                   result, **kwargs)
        elif endpoint and 'task' in endpoint.lower():
            process_task_execution(scope, endpoint, instance,
                                  result, **kwargs)
        elif endpoint and 'tool' in endpoint.lower():
            process_tool_execution(scope, endpoint, instance,
                                  result, **kwargs)
        else:
            process_generic_operation(scope, endpoint, instance,
                                     result, **kwargs)

    except Exception as e:  # pylint: disable=broad-exception-caught
        handle_exception(scope._span, e)  # pylint: disable=protected-access 