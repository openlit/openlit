"""
OpenLIT OpenAI Agents Instrumentation - Native TracingProcessor Implementation
"""

import time
from typing import Any, Dict, Optional

from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind, Status, StatusCode, set_span_in_context
from opentelemetry.context import detach

from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
    record_framework_metrics
)
from openlit.semcov import SemanticConvention

# Try to import agents framework components with fallback
try:
    from agents import TracingProcessor, Trace, Span
    TRACING_AVAILABLE = True
except ImportError:
    # Create dummy classes for when agents is not available
    class TracingProcessor:
        def force_flush(self): pass
        def shutdown(self): pass
    class Trace: pass  
    class Span: pass
    TRACING_AVAILABLE = False


class OpenLITTracingProcessor(TracingProcessor):
    """
    OpenLIT processor that integrates with OpenAI Agents' native tracing system
    Provides superior business intelligence while maintaining perfect hierarchy
    """
    
    def __init__(self, tracer: Any, version: str, environment: str,
                 application_name: str, pricing_info: dict, capture_message_content: bool,
                 metrics: Optional[Any], disable_metrics: bool, detailed_tracing: bool):
        if not TRACING_AVAILABLE:
            return
            
        self._tracer = tracer
        self._version = version
        self._environment = environment
        self._application_name = application_name
        self._pricing_info = pricing_info
        self._capture_message_content = capture_message_content
        self._metrics = metrics
        self._disable_metrics = disable_metrics
        self._detailed_tracing = detailed_tracing
        
        # Track spans for hierarchy
        self._root_spans: Dict[str, Any] = {}
        self._otel_spans: Dict[str, Any] = {}
        self._tokens: Dict[str, object] = {}
        self._span_start_times: Dict[str, float] = {}
        
        # Track handoff context for better span naming
        self._last_handoff_from: Optional[str] = None

    def on_trace_start(self, trace: Trace) -> None:
        """Called when a trace is started - creates root workflow span"""
        if not TRACING_AVAILABLE:
            return
            
        # Create root workflow span with {operation_type} {operation_name} format
        workflow_name = getattr(trace, 'name', 'workflow')
        span_name = f"agent {workflow_name}"  # Follow {operation_type} {operation_name} pattern
        
        # Use tracer.start_span for TracingProcessor pattern with proper context
        otel_span = self._tracer.start_span(
            name=span_name,
            kind=SpanKind.CLIENT
        )
        
        # Set common framework attributes for root span
        self._set_common_attributes(otel_span, trace.trace_id)
        
        # Set agent name for root span using semantic conventions  
        if hasattr(trace, 'name') and trace.name:
            otel_span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, trace.name)
            
        # Set default model for root span
        otel_span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, "gpt-4o")
        
        self._root_spans[trace.trace_id] = otel_span
        self._span_start_times[trace.trace_id] = time.time()

    def on_span_start(self, span: Span[Any]) -> None:
        """Called when a span is started - creates child spans with proper hierarchy"""
        if not TRACING_AVAILABLE or not hasattr(span, 'started_at') or not span.started_at:
            return
            
        start_time = self._parse_timestamp(span.started_at)
        
        # Determine parent span for proper hierarchy
        parent_span = None
        if span.parent_id and span.parent_id in self._otel_spans:
            parent_span = self._otel_spans[span.parent_id]
        elif span.trace_id in self._root_spans:
            parent_span = self._root_spans[span.trace_id]
            
        # Set context for parent-child relationship
        context = set_span_in_context(parent_span) if parent_span else None
        
        # Get semantic span name and operation type
        span_name = self._get_span_name(span)
        operation_type = self._get_operation_type(span.span_data)
        
        # Create span with proper context
        otel_span = self._tracer.start_span(
            name=span_name,
            context=context,
            start_time=self._as_utc_nano(start_time),
            kind=SpanKind.CLIENT
        )
        
        # Set common framework attributes for all spans
        self._set_common_framework_attributes(otel_span, operation_type)
        
        # Set span-specific attributes
        self._set_span_attributes(otel_span, span)
        
        # Track span and context
        self._otel_spans[span.span_id] = otel_span
        self._tokens[span.span_id] = context_api.attach(set_span_in_context(otel_span))
        self._span_start_times[span.span_id] = time.time()

    def on_span_end(self, span: Span[Any]) -> None:
        """Called when a span is finished - adds business intelligence and ends span"""
        if not TRACING_AVAILABLE or span.span_id not in self._otel_spans:
            return
            
        otel_span = self._otel_spans[span.span_id]
        
        try:
            # Add response data and business intelligence
            self._process_span_completion(otel_span, span)
            
            # Set successful status
            otel_span.set_status(Status(StatusCode.OK))
            
            # Record metrics if enabled
            if not self._disable_metrics and self._metrics and span.span_id in self._span_start_times:
                start_time = self._span_start_times[span.span_id]
                end_time = time.time()
                operation_type = self._get_operation_type(span.span_data)
                record_framework_metrics(
                    self._metrics, operation_type, SemanticConvention.GEN_AI_SYSTEM_OPENAI_AGENTS,
                    "localhost", 80, self._environment, self._application_name,
                    start_time, end_time
                )
                
        except Exception as e:
            handle_exception(otel_span, e)
        finally:
            # End span and cleanup
            otel_span.end()
            
            # Cleanup context
            if span.span_id in self._tokens:
                detach(self._tokens[span.span_id])
                del self._tokens[span.span_id]
            
            # Cleanup tracking
            if span.span_id in self._otel_spans:
                del self._otel_spans[span.span_id]
            if span.span_id in self._span_start_times:
                del self._span_start_times[span.span_id]

    def on_trace_end(self, trace: Trace) -> None:
        """Called when a trace is finished - ends root span with business intelligence"""
        if not TRACING_AVAILABLE or trace.trace_id not in self._root_spans:
            return
            
        root_span = self._root_spans[trace.trace_id]
        
        try:
            # Add trace-level business intelligence
            self._process_trace_completion(root_span, trace)
            root_span.set_status(Status(StatusCode.OK))
        except Exception as e:
            handle_exception(root_span, e)
        finally:
            root_span.end()
            
            # Cleanup
            if trace.trace_id in self._root_spans:
                del self._root_spans[trace.trace_id]
            if trace.trace_id in self._span_start_times:
                del self._span_start_times[trace.trace_id]

    def _get_span_name(self, span: Span[Any]) -> str:
        """Get semantic span name using {operation_type} {operation_name} format"""
        data = span.span_data
        operation_type = self._get_operation_type(data)
        
        # Extract operation name based on span type
        operation_name = "unknown"
        
        # Special handling for handoffs
        if hasattr(data, '__class__') and data.__class__.__name__ == 'HandoffSpanData':
            if hasattr(data, 'to_agent') and data.to_agent:
                operation_name = f"to {data.to_agent}"
            else:
                operation_name = "handoff"
                
        # Use agent name for agent spans
        elif hasattr(data, '__class__') and data.__class__.__name__ == 'AgentSpanData':
            # Try multiple possible attribute names for agent name
            agent_name = None
            
            for attr in ['agent_name', 'name', 'agent', 'agent_id']:
                if hasattr(data, attr):
                    agent_name = getattr(data, attr)
                    if agent_name and isinstance(agent_name, str):
                        break
            
            # If still no agent name, try looking in context or other attributes
            if not agent_name:
                # Try context or other nested attributes
                if hasattr(data, 'context') and hasattr(data.context, 'agent'):
                    agent_name = getattr(data.context.agent, 'name', None)
                elif hasattr(data, 'metadata') and hasattr(data.metadata, 'agent_name'):
                    agent_name = data.metadata.agent_name
                    
            if agent_name:
                operation_name = agent_name
            else:
                # If no agent name found, use a more descriptive fallback
                operation_name = "execution"
                
        # Use name if available for other spans
        elif hasattr(data, 'name') and isinstance(data.name, str):
            operation_name = data.name
            
        # Fallback to type-based names
        else:
            operation_name = getattr(data, 'type', 'operation')
        
        # Return formatted name: {operation_type} {operation_name}
        return f"{operation_type} {operation_name}"

    def _get_operation_type(self, data: Any) -> str:
        """Map span data to operation types"""
        class_name = data.__class__.__name__ if hasattr(data, '__class__') else str(type(data))
        
        mapping = {
            'AgentSpanData': SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            'GenerationSpanData': SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            'FunctionSpanData': SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
            'HandoffSpanData': SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            'ResponseSpanData': SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        }
        
        return mapping.get(class_name, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)

    def _set_common_framework_attributes(self, span: Any, operation_type: str) -> None:
        """Set common framework attributes using semantic conventions"""
        # Create scope object for common_framework_span_attributes
        scope = type("GenericScope", (), {})()
        scope._span = span
        scope._start_time = time.time()
        scope._end_time = time.time()
        
        # Use common framework attributes helper
        # For framework operations, use localhost like other agent frameworks (AG2, Pydantic AI)
        common_framework_span_attributes(
            scope, SemanticConvention.GEN_AI_SYSTEM_OPENAI_AGENTS,
            "localhost", 80, self._environment, self._application_name,
            self._version, operation_type, None
        )

    def _set_common_attributes(self, span: Any, trace_id: str) -> None:
        """Set common framework attributes for root spans"""
        self._set_common_framework_attributes(span, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)

    def _set_span_attributes(self, span: Any, agent_span: Span[Any]) -> None:
        """Set span-specific attributes based on span data using semantic conventions"""
        data = agent_span.span_data
        
        # Agent-specific attributes using semantic conventions
        if hasattr(data, 'agent_name') and data.agent_name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, data.agent_name)
        elif hasattr(data, 'name') and data.name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, data.name)
            
        # Enhanced model information extraction
        model = self._extract_model_info(data, agent_span)
        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))
            
        # Enhanced input/output capture with MIME types (OpenLIT enhancement)
        if self._capture_message_content:
            self._capture_input_output(span, data)
            
        # Enhanced token usage details (inspired by OpenInference)
        self._capture_detailed_token_usage(span, data)
        
        # Model invocation parameters as JSON (new feature from OpenInference)
        self._capture_model_parameters(span, data)
            
        # Tool/function information for tool calls
        if hasattr(data, '__class__') and 'Function' in data.__class__.__name__:
            if hasattr(data, 'function_name'):
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, data.function_name)
            if hasattr(data, 'arguments'):
                span.set_attribute(SemanticConvention.GEN_AI_TOOL_ARGS, str(data.arguments))
                
        # Enhanced handoff information extraction
        if hasattr(data, '__class__') and 'Handoff' in data.__class__.__name__:
            target_agent = self._extract_handoff_target(data, agent_span)
            if target_agent:
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, target_agent)
            else:
                # Fallback for handoff spans without clear target
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, "agent handoff")
                
        # Request/response IDs if available
        if hasattr(data, 'request_id'):
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, data.request_id)
        elif hasattr(data, 'response_id'):
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, data.response_id)
            
    def _extract_model_info(self, data: Any, agent_span: Span[Any]) -> Optional[str]:
        """Extract model information from span data or agent configuration"""
        # Try direct model attributes first
        model_attrs = ['model', 'model_name', 'model_id', 'llm_model', 'openai_model']
        for attr in model_attrs:
            if hasattr(data, attr):
                model_value = getattr(data, attr)
                if model_value and isinstance(model_value, str):
                    return model_value
                    
        # Try nested configuration objects
        config_attrs = ['config', 'configuration', 'client_config', 'llm_config']
        for config_attr in config_attrs:
            if hasattr(data, config_attr):
                config = getattr(data, config_attr)
                if config:
                    for model_attr in model_attrs:
                        if hasattr(config, model_attr):
                            model_value = getattr(config, model_attr)
                            if model_value and isinstance(model_value, str):
                                return model_value
                                
        # Try looking in the agent span itself
        if hasattr(agent_span, 'agent') and agent_span.agent:
            agent = agent_span.agent
            for attr in model_attrs + config_attrs:
                if hasattr(agent, attr):
                    value = getattr(agent, attr)
                    if isinstance(value, str) and value:
                        return value
                    elif hasattr(value, 'model'):
                        return getattr(value, 'model', None)
                        
        # Default OpenAI Agents model if no explicit model found
        return "gpt-4o"  # OpenAI Agents default model
        
    def _extract_handoff_target(self, data: Any, agent_span: Span[Any]) -> Optional[str]:
        """Extract target agent name from handoff span data"""
        
        # Track handoff context for flow analysis
        if hasattr(data, '__class__') and 'Handoff' in data.__class__.__name__:
            if hasattr(data, 'from_agent') and data.from_agent:
                # Store handoff context to use for next span
                self._last_handoff_from = data.from_agent
        
        # Try direct handoff target attributes first
        target_attrs = ['to_agent', 'target_agent', 'agent_name', 'target', 'handoff_to', 'agent']
        for attr in target_attrs:
            if hasattr(data, attr):
                target_value = getattr(data, attr)
                if target_value and isinstance(target_value, str) and target_value != "None":
                    return f"handoff to {target_value}"
                elif hasattr(target_value, 'name'):
                    # If target is an agent object with name attribute
                    agent_name = getattr(target_value, 'name', None)
                    if agent_name and isinstance(agent_name, str):
                        return f"handoff to {agent_name}"
                        
        # Try calling export method for additional data
        if hasattr(data, 'export') and callable(data.export):
            try:
                exported_data = data.export()
                if isinstance(exported_data, dict):
                    # Look for target agent in exported data
                    for key in ['to_agent', 'target_agent', 'target', 'handoff_to']:
                        if key in exported_data and exported_data[key]:
                            target_value = exported_data[key]
                            if isinstance(target_value, str) and target_value != "None":
                                return f"handoff to {target_value}"
                            elif hasattr(target_value, 'name'):
                                return f"handoff to {getattr(target_value, 'name', None)}"
            except Exception:
                pass  # Ignore export errors
        
        # If we have source agent info, we can indicate direction
        if hasattr(data, 'from_agent') and data.from_agent:
            return f"handoff from {data.from_agent}"  # Shows direction even without target
             
        return None
        
    def _capture_input_output(self, span: Any, data: Any) -> None:
        """Capture detailed input/output with MIME types (following OpenInference approach)"""
        try:
            # Handle ResponseSpanData with OpenAI Response object
            if hasattr(data, '__class__') and 'ResponseSpanData' in data.__class__.__name__:
                # Handle input data
                if hasattr(data, 'input') and data.input:
                    if isinstance(data.input, str):
                        span.set_attribute("gen_ai.prompt", data.input)
                        span.set_attribute("input.mime_type", "text/plain")
                    elif isinstance(data.input, list):
                        import json
                        span.set_attribute("gen_ai.prompt", json.dumps(data.input))
                        span.set_attribute("input.mime_type", "application/json")
                
                # Handle response/output data
                if hasattr(data, 'response') and data.response:
                    if hasattr(data.response, 'model_dump_json'):
                        # This is an OpenAI Response object
                        span.set_attribute("output.mime_type", "application/json")
                        span.set_attribute("gen_ai.completion", data.response.model_dump_json())
                    elif isinstance(data.response, str):
                        span.set_attribute("gen_ai.completion", data.response)
                        span.set_attribute("output.mime_type", "text/plain")
            else:
                # Fallback for other span types
                # Try generic input/output attributes
                if hasattr(data, 'input') and data.input:
                    if isinstance(data.input, str):
                        span.set_attribute("gen_ai.prompt", data.input)
                        span.set_attribute("input.mime_type", "text/plain")
                    elif isinstance(data.input, (list, dict)):
                        import json
                        span.set_attribute("gen_ai.prompt", json.dumps(data.input))
                        span.set_attribute("input.mime_type", "application/json")
                        
                if hasattr(data, 'output') and data.output:
                    if isinstance(data.output, str):
                        span.set_attribute("gen_ai.completion", data.output)
                        span.set_attribute("output.mime_type", "text/plain")
                    elif isinstance(data.output, (list, dict)):
                        import json
                        span.set_attribute("gen_ai.completion", json.dumps(data.output))
                        span.set_attribute("output.mime_type", "application/json")
                    
        except Exception:
            pass  # Don't fail instrumentation for I/O capture errors
            
    def _capture_detailed_token_usage(self, span: Any, data: Any) -> None:
        """Capture enhanced token usage details (following OpenInference approach)"""
        try:
            # Handle ResponseSpanData with OpenAI Response object
            if hasattr(data, '__class__') and 'ResponseSpanData' in data.__class__.__name__:
                if hasattr(data, 'response') and data.response and hasattr(data.response, 'usage'):
                    usage = data.response.usage
                    
                    # Basic token counts
                    if hasattr(usage, 'input_tokens'):
                        span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens)
                    if hasattr(usage, 'output_tokens'):
                        span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens)
                    if hasattr(usage, 'total_tokens'):
                        span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, usage.total_tokens)
                        
                    # Enhanced details (following OpenInference pattern)
                    if hasattr(usage, 'input_tokens_details') and usage.input_tokens_details:
                        if hasattr(usage.input_tokens_details, 'cached_tokens'):
                            span.set_attribute("gen_ai.usage.input_tokens.cache_read", usage.input_tokens_details.cached_tokens)
                            
                    if hasattr(usage, 'output_tokens_details') and usage.output_tokens_details:
                        if hasattr(usage.output_tokens_details, 'reasoning_tokens'):
                            span.set_attribute("gen_ai.usage.output_tokens.reasoning", usage.output_tokens_details.reasoning_tokens)
            
            # Fallback for other span types            
            elif hasattr(data, 'usage') and data.usage:
                usage = data.usage
                
                # Basic token counts
                if hasattr(usage, 'input_tokens'):
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens)
                if hasattr(usage, 'output_tokens'):
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens)
                if hasattr(usage, 'total_tokens'):
                    span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, usage.total_tokens)
                    
                # Enhanced details
                if hasattr(usage, 'input_tokens_details'):
                    details = usage.input_tokens_details
                    if hasattr(details, 'cached_tokens'):
                        span.set_attribute("gen_ai.usage.input_tokens.cache_read", details.cached_tokens)
                        
                if hasattr(usage, 'output_tokens_details'):
                    details = usage.output_tokens_details
                    if hasattr(details, 'reasoning_tokens'):
                        span.set_attribute("gen_ai.usage.output_tokens.reasoning", details.reasoning_tokens)
                        
        except Exception:
            pass  # Don't fail instrumentation for token capture errors
            
    def _capture_model_parameters(self, span: Any, data: Any) -> None:
        """Capture model invocation parameters as JSON (following OpenInference approach)"""
        try:
            # Handle ResponseSpanData with OpenAI Response object
            if hasattr(data, '__class__') and 'ResponseSpanData' in data.__class__.__name__:
                if hasattr(data, 'response') and data.response and hasattr(data.response, 'model_dump'):
                    # Use OpenInference exclusion pattern
                    params = data.response.model_dump(
                        exclude_none=True,
                        exclude={"object", "tools", "usage", "output", "error", "status"}
                    )
                    if params:
                        import json
                        span.set_attribute("gen_ai.invocation_parameters", json.dumps(params))
            
            # Fallback for other span types
            elif hasattr(data, 'model_dump') and callable(data.model_dump):
                # Use OpenInference exclusion pattern
                params = data.model_dump(
                    exclude_none=True,
                    exclude={"object", "tools", "usage", "output", "error", "status", "input"}
                )
                if params:
                    import json
                    span.set_attribute("gen_ai.invocation_parameters", json.dumps(params))
                    
        except Exception:
            pass  # Don't fail instrumentation for parameter capture errors

    def _process_span_completion(self, span: Any, agent_span: Span[Any]) -> None:
        """Process span completion with business intelligence"""
        data = agent_span.span_data
        
        # Handle response data for LLM operations
        if hasattr(data, '__class__') and 'Generation' in data.__class__.__name__:
            self._process_generation_data(span, data)
        elif hasattr(data, '__class__') and 'Response' in data.__class__.__name__:
            self._process_response_data(span, data)

    def _process_generation_data(self, span: Any, data: Any) -> None:
        """Process LLM generation data with cost tracking"""
        # Extract token usage and cost information
        if hasattr(data, 'usage'):
            usage = data.usage
            input_tokens = getattr(usage, 'prompt_tokens', 0)
            output_tokens = getattr(usage, 'completion_tokens', 0)
            
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
            span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens)
            
            # Calculate cost (OpenLIT's business intelligence advantage)
            model = getattr(data, 'model', 'gpt-4o')
            cost = get_chat_model_cost(model, self._pricing_info, input_tokens, output_tokens)
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    def _process_response_data(self, span: Any, data: Any) -> None:
        """Process response data with content capture"""
        if self._capture_message_content:
            if hasattr(data, 'content'):
                span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, str(data.content))

    def _process_trace_completion(self, span: Any, trace: Trace) -> None:
        """Process trace completion with workflow-level business intelligence"""
        # Add workflow completion information
        if hasattr(trace, 'name'):
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, trace.name)

    def _parse_timestamp(self, timestamp: str) -> float:
        """Parse ISO timestamp to float"""
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            return dt.timestamp()
        except:
            return time.time()

    def _as_utc_nano(self, timestamp: float) -> int:
        """Convert timestamp to nanoseconds"""
        return int(timestamp * 1_000_000_000)
    
    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """Force flush any pending traces (required by TracingProcessor)"""
        return True
    
    def shutdown(self) -> bool:
        """Shutdown the processor (required by TracingProcessor)"""
        return True 