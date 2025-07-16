"""
OpenLIT OpenAI Agents Instrumentation - Native TracingProcessor Implementation
"""

import json
import time
from datetime import datetime
from typing import Any, Dict, Optional

from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind, Status, StatusCode, set_span_in_context
from opentelemetry.context import detach

from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
    record_framework_metrics,
    get_chat_model_cost
)
from openlit.semcov import SemanticConvention

# Try to import agents framework components with fallback
try:
    from agents import TracingProcessor, Trace, Span
    TRACING_AVAILABLE = True
except ImportError:
    # Create dummy classes for when agents is not available
    class TracingProcessor:
        """Dummy TracingProcessor class for when agents is not available"""
        
        def force_flush(self):
            """Dummy force_flush method"""
            pass
        
        def shutdown(self):
            """Dummy shutdown method"""
            pass
    
    class Trace:
        """Dummy Trace class for when agents is not available"""
        pass
    
    class Span:
        """Dummy Span class for when agents is not available"""
        pass
    
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
        if hasattr(agent_span, 'model'):
            return str(agent_span.model)
            
        # Try agent_config if available
        if hasattr(agent_span, 'agent_config'):
            config = agent_span.agent_config
            for attr in model_attrs:
                if hasattr(config, attr):
                    model_value = getattr(config, attr)
                    if model_value and isinstance(model_value, str):
                        return model_value
                        
        # Default fallback
        return "gpt-4o"

    def _extract_handoff_target(self, data: Any, agent_span: Span[Any]) -> Optional[str]:
        """Extract handoff target information with enhanced logic"""
        # Try direct target attributes
        target_attrs = ['to_agent', 'target_agent', 'destination_agent', 'next_agent']
        for attr in target_attrs:
            if hasattr(data, attr):
                target = getattr(data, attr)
                if target and isinstance(target, str):
                    return f"to {target}"
                    
        # Try from_agent for better handoff description
        from_attrs = ['from_agent', 'source_agent', 'previous_agent']
        for attr in from_attrs:
            if hasattr(data, attr):
                source = getattr(data, attr)
                if source and isinstance(source, str):
                    return f"from {source}"
                    
        # Try nested objects
        if hasattr(data, 'handoff_info'):
            info = data.handoff_info
            for attr in target_attrs + from_attrs:
                if hasattr(info, attr):
                    value = getattr(info, attr)
                    if value and isinstance(value, str):
                        prefix = "to" if attr in target_attrs else "from"
                        return f"{prefix} {value}"
                        
        return None

    def _capture_input_output(self, span: Any, data: Any) -> None:
        """Capture input/output content with MIME type detection (OpenLIT enhancement)"""
        try:
            # Capture input content
            if hasattr(data, 'input') and data.input is not None:
                content = str(data.input)
                span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, content)
                # Set MIME type based on content structure
                if content.startswith('{') or content.startswith('['):
                    span.set_attribute("gen_ai.content.prompt.mime_type", "application/json")
                else:
                    span.set_attribute("gen_ai.content.prompt.mime_type", "text/plain")
                    
            # Capture output/response content
            if hasattr(data, 'response') and data.response is not None:
                content = str(data.response)
                span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, content)
                # Set MIME type based on content structure
                if content.startswith('{') or content.startswith('['):
                    span.set_attribute("gen_ai.content.completion.mime_type", "application/json")
                else:
                    span.set_attribute("gen_ai.content.completion.mime_type", "text/plain")
                    
        except Exception:
            pass  # Ignore export errors

    def _capture_detailed_token_usage(self, span: Any, data: Any) -> None:
        """Capture detailed token usage information (inspired by OpenInference)"""
        try:
            if hasattr(data, 'usage'):
                usage = data.usage
                
                # Standard token usage
                if hasattr(usage, 'input_tokens'):
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, usage.input_tokens)
                if hasattr(usage, 'output_tokens'):
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, usage.output_tokens)
                    
                # Enhanced token details (when available)
                if hasattr(usage, 'input_tokens_details'):
                    details = usage.input_tokens_details
                    if hasattr(details, 'cached_tokens'):
                        span.set_attribute("gen_ai.usage.input_tokens.cached", details.cached_tokens)
                    if hasattr(details, 'reasoning_tokens'):
                        span.set_attribute("gen_ai.usage.input_tokens.reasoning", details.reasoning_tokens)
                        
                if hasattr(usage, 'output_tokens_details'):
                    details = usage.output_tokens_details
                    if hasattr(details, 'reasoning_tokens'):
                        span.set_attribute("gen_ai.usage.output_tokens.reasoning", details.reasoning_tokens)
                        
        except Exception:
            pass  # Ignore export errors

    def _capture_model_parameters(self, span: Any, data: Any) -> None:
        """Capture model invocation parameters as JSON (new feature from OpenInference)"""
        try:
            # Look for model configuration parameters
            params = {}
            
            # Common parameter attributes
            param_attrs = ['temperature', 'max_tokens', 'top_p', 'frequency_penalty', 'presence_penalty']
            for attr in param_attrs:
                if hasattr(data, attr):
                    params[attr] = getattr(data, attr)
                    
            # Try nested config objects
            if hasattr(data, 'config'):
                config = data.config
                for attr in param_attrs:
                    if hasattr(config, attr):
                        params[attr] = getattr(config, attr)
                        
            # Try response object if available
            if hasattr(data, 'response') and hasattr(data.response, 'model_dump'):
                try:
                    response_dict = data.response.model_dump()
                    if response_dict and isinstance(response_dict, dict):
                        # Extract model parameters from response
                        if 'model' in response_dict:
                            params['model'] = response_dict['model']
                        if 'usage' in response_dict:
                            params['usage'] = response_dict['usage']
                except Exception:
                    pass
                    
            # Set as JSON if we found any parameters
            if params:
                span.set_attribute("gen_ai.request.parameters", json.dumps(params))
                
        except Exception:
            pass  # Ignore export errors

    def _process_span_completion(self, span: Any, agent_span: Span[Any]) -> None:
        """Process span completion with enhanced business intelligence"""
        data = agent_span.span_data
        
        # Process response data if available
        self._process_response_data(span, data)
        
        # Extract and set token usage for business intelligence
        self._extract_token_usage(span, data)

    def _extract_token_usage(self, span: Any, data: Any) -> None:
        """Extract token usage and calculate costs (OpenLIT's business intelligence)"""
        try:
            # Try to extract token usage from various possible locations
            input_tokens = 0
            output_tokens = 0
            
            # Check direct usage attributes
            if hasattr(data, 'usage'):
                usage = data.usage
                input_tokens = getattr(usage, 'input_tokens', 0) or getattr(usage, 'prompt_tokens', 0)
                output_tokens = getattr(usage, 'output_tokens', 0) or getattr(usage, 'completion_tokens', 0)
                
            # Check response object
            elif hasattr(data, 'response') and hasattr(data.response, 'usage'):
                usage = data.response.usage
                input_tokens = getattr(usage, 'input_tokens', 0) or getattr(usage, 'prompt_tokens', 0)
                output_tokens = getattr(usage, 'output_tokens', 0) or getattr(usage, 'completion_tokens', 0)
                
            # Set token attributes
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
            span.set_attribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens)

            # Calculate cost (OpenLIT's business intelligence advantage)
            model = getattr(data, 'model', 'gpt-4o')
            cost = get_chat_model_cost(model, self._pricing_info, input_tokens, output_tokens)
            span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
            
        except Exception:
            pass  # Ignore errors in token usage extraction

    def _process_response_data(self, span: Any, data: Any) -> None:
        """Process response data with content capture"""
        if self._capture_message_content:
            self._capture_input_output(span, data)

    def _process_trace_completion(self, span: Any, trace: Trace) -> None:
        """Process trace completion with business intelligence aggregation"""
        # Add trace-level metadata
        span.set_attribute(SemanticConvention.GEN_AI_OPERATION_NAME, "workflow")
        
        # Calculate total duration
        if trace.trace_id in self._span_start_times:
            start_time = self._span_start_times[trace.trace_id]
            duration = time.time() - start_time
            span.set_attribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration)

    def _parse_timestamp(self, timestamp: Any) -> float:
        """Parse timestamp from various formats"""
        if isinstance(timestamp, (int, float)):
            return float(timestamp)
        elif isinstance(timestamp, str):
            try:
                # Try parsing ISO format
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                return dt.timestamp()
            except ValueError:
                return time.time()
        else:
            return time.time()

    def _as_utc_nano(self, timestamp: float) -> int:
        """Convert timestamp to UTC nanoseconds for OpenTelemetry"""
        return int(timestamp * 1_000_000_000)

    def force_flush(self) -> bool:
        """Force flush any pending spans (required by TracingProcessor)"""
        return True

    def shutdown(self) -> bool:
        """Shutdown the processor (required by TracingProcessor)"""
        return True
