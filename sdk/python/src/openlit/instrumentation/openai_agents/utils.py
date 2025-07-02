"""
OpenAI Agents OpenTelemetry instrumentation utility functions
"""
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    common_span_attributes,
)
from openlit.semcov import SemanticConvention

def common_agent_logic(scope, pricing_info, environment, application_name, metrics,
    capture_message_content, disable_metrics, version, operation_type):
    """
    Process OpenAI agent request and generate Telemetry
    """

    # Common Span Attributes
    common_span_attributes(scope,
        operation_type, SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        scope._server_address, scope._server_port, scope._request_model, scope._response_model,
        environment, application_name, False, 0, scope._end_time - scope._start_time, version)

    # Span Attributes for Agent-specific parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, scope._agent_name)
    
    # Set agent description for create agent operation
    if hasattr(scope, "_agent_description"):
        scope._span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, scope._agent_description)

    scope._span.set_status(Status(StatusCode.OK))

def process_agent_creation(agent_name, agent_model, agent_instructions, pricing_info, server_port, server_address,
    environment, application_name, metrics, start_time, span, capture_message_content=False,
    disable_metrics=False, version="1.0.0", **kwargs):
    """
    Process OpenAI agent creation and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()
    
    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._agent_name = agent_name
    scope._request_model = agent_model
    scope._response_model = agent_model
    scope._agent_description = agent_instructions
    scope._server_address, scope._server_port = server_address, server_port

    common_agent_logic(scope, pricing_info, environment, application_name, metrics,
        capture_message_content, disable_metrics, version, SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT) 