"""
OpenLIT Processor for OpenAI Agents instrumentation
Integrates with agents' native tracing system to provide enhanced telemetry
"""

import time
from typing import Any, Dict, Optional, List
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvention


class OpenLITTracingProcessor:
    """Enhanced tracing processor that integrates with OpenAI Agents' native tracing system"""
    
    def __init__(
        self,
        tracer: Optional[trace.Tracer] = None,
        version: str = "",
        environment: str = "default",
        application_name: str = "default",
        pricing_info: Dict = None,
        capture_message_content: bool = False,
        metrics: Any = None,
        disable_metrics: bool = False,
        detailed_tracing: bool = False
    ):
        self.tracer = tracer or trace.get_tracer(__name__)
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self.pricing_info = pricing_info or {}
        self.capture_message_content = capture_message_content
        self.metrics = metrics
        self.disable_metrics = disable_metrics
        self.detailed_tracing = detailed_tracing
        
    def process_trace(self, trace_data: Dict[str, Any]) -> None:
        """Process trace data from OpenAI Agents"""
        try:
            self._create_openlit_span(trace_data)
        except Exception as e:
            # Don't let tracing errors break the application
            pass
    
    def _create_openlit_span(self, trace_data: Dict[str, Any]) -> None:
        """Create OpenLIT enhanced span from agents trace data"""
        # Extract operation details
        operation_name = self._get_operation_name(trace_data)
        span_name = self._get_span_name(trace_data, operation_name)
        
        # Create span
        with self.tracer.start_as_current_span(span_name) as span:
            try:
                # Set basic attributes
                span.set_attribute(SemanticConvention.TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, self.version)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM, "openai_agents")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_name)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS, "localhost")
                span.set_attribute(SemanticConvention.SERVER_PORT, 80)
                span.set_attribute(SemanticConvention.DEPLOYMENT_ENVIRONMENT, self.environment)
                span.set_attribute(SemanticConvention.SERVICE_NAME, self.application_name)
                
                # Set operation-specific attributes
                self._set_operation_attributes(span, trace_data, operation_name)
                
                # Set timing
                if 'duration' in trace_data:
                    span.set_attribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, trace_data['duration'])
                
                span.set_status(Status(StatusCode.OK))
                
            except Exception as e:
                handle_exception(span, e)
                
    def _get_operation_name(self, trace_data: Dict[str, Any]) -> str:
        """Determine operation name from trace data"""
        if 'operation' in trace_data:
            return trace_data['operation']
        elif 'type' in trace_data:
            trace_type = trace_data['type']
            if 'agent' in trace_type.lower():
                return "invoke_agent"
            elif 'chat' in trace_type.lower():
                return "chat"
            elif 'tool' in trace_type.lower():
                return "execute_tool"
        return "workflow"
    
    def _get_span_name(self, trace_data: Dict[str, Any], operation_name: str) -> str:
        """Generate span name following OpenTelemetry conventions"""
        if operation_name == "invoke_agent" and 'agent_name' in trace_data:
            return f"invoke_agent {trace_data['agent_name']}"
        elif operation_name == "chat" and 'model' in trace_data:
            return f"chat {trace_data['model']}"
        elif operation_name == "execute_tool" and 'tool_name' in trace_data:
            return f"execute_tool {trace_data['tool_name']}"
        elif operation_name == "workflow" and 'workflow_name' in trace_data:
            return f"workflow {trace_data['workflow_name']}"
        else:
            return f"{operation_name} {trace_data.get('name', 'Unknown')}"
    
    def _set_operation_attributes(self, span: trace.Span, trace_data: Dict[str, Any], operation_name: str) -> None:
        """Set operation-specific attributes"""
        # Agent attributes
        if 'agent_name' in trace_data:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, trace_data['agent_name'])
        
        # Model attributes
        if 'model' in trace_data:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, trace_data['model'])
        
        # Usage attributes
        if 'input_tokens' in trace_data:
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, trace_data['input_tokens'])
        if 'output_tokens' in trace_data:
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, trace_data['output_tokens'])
        if 'total_tokens' in trace_data:
            span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, trace_data['total_tokens'])
        
        # Cost tracking
        if 'cost' in trace_data:
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, trace_data['cost'])
        
        # Content attributes (if enabled)
        if self.capture_message_content:
            if 'prompt' in trace_data:
                span.set_attribute(SemanticConvention.GEN_AI_PROMPT, str(trace_data['prompt']))
            if 'completion' in trace_data:
                span.set_attribute(SemanticConvention.GEN_AI_COMPLETION, str(trace_data['completion']))
    
    def on_agent_start(self, agent_data: Dict[str, Any]) -> None:
        """Handle agent start event"""
        self.process_trace({
            **agent_data,
            'operation': 'invoke_agent',
            'type': 'agent_start'
        })
    
    def on_agent_end(self, agent_data: Dict[str, Any]) -> None:
        """Handle agent end event"""
        self.process_trace({
            **agent_data,
            'operation': 'invoke_agent', 
            'type': 'agent_end'
        })
    
    def on_chat_start(self, chat_data: Dict[str, Any]) -> None:
        """Handle chat start event"""
        self.process_trace({
            **chat_data,
            'operation': 'chat',
            'type': 'chat_start'
        })
    
    def on_chat_end(self, chat_data: Dict[str, Any]) -> None:
        """Handle chat end event"""
        self.process_trace({
            **chat_data,
            'operation': 'chat',
            'type': 'chat_end'
        })
    
    def on_tool_start(self, tool_data: Dict[str, Any]) -> None:
        """Handle tool start event"""
        self.process_trace({
            **tool_data,
            'operation': 'execute_tool',
            'type': 'tool_start'
        })
    
    def on_tool_end(self, tool_data: Dict[str, Any]) -> None:
        """Handle tool end event"""
        self.process_trace({
            **tool_data,
            'operation': 'execute_tool',
            'type': 'tool_end'
        }) 