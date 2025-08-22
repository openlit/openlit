# pylint: disable=broad-exception-caught
"""
Utility functions for MCP instrumentation with optimized context caching and performance enhancements.
"""

import json
import time
import inspect
from typing import Dict, Any, Optional
from opentelemetry.sdk.resources import SERVICE_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.trace.status import Status, StatusCode

from openlit.semcov import SemanticConvention
from openlit.__helpers import (
    handle_exception,
    record_framework_metrics,
    record_mcp_metrics,
)


class MCPInstrumentationContext:
    """
    Context object to cache expensive extractions and reduce performance overhead.
    Uses __slots__ for memory optimization following OpenLIT patterns.
    """

    __slots__ = (
        "instance",
        "args",
        "kwargs",
        "version",
        "environment",
        "application_name",
        "pricing_info",
        "capture_message_content",
        "_method_name",
        "_message_id",
        "_tool_name",
        "_resource_uri",
        "_server_name",
        "_transport_type",
        "_error_info",
        "_params",
        "_result",
        "_server_info",
        "_wrapped_function_name",
        "_endpoint_method",
        "_request_payload",
        "_response_payload",
    )

    def __init__(
        self,
        instance,
        args,
        kwargs,
        version,
        environment,
        application_name,
        pricing_info,
        capture_message_content,
    ):
        self.instance = instance
        self.args = args
        self.kwargs = kwargs
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self.pricing_info = pricing_info
        self.capture_message_content = capture_message_content

        # Cache expensive operations with lazy loading
        self._method_name = None
        self._message_id = None
        self._tool_name = None
        self._resource_uri = None
        self._server_name = None
        self._transport_type = None
        self._error_info = None
        self._wrapped_function_name = None
        self._endpoint_method = None
        self._params = None
        self._result = None
        self._server_info = None
        self._request_payload = None
        self._response_payload = None

    @property
    def method_name(self) -> str:
        """Get MCP method name with caching."""
        if self._method_name is None:
            self._method_name = self._extract_method_name()
        return self._method_name

    @property
    def message_id(self) -> Optional[str]:
        """Get MCP message ID with caching."""
        if self._message_id is None:
            self._message_id = self._extract_message_id()
        return self._message_id

    @property
    def tool_name(self) -> Optional[str]:
        """Get tool name with caching."""
        if self._tool_name is None:
            self._tool_name = self._extract_tool_name()
        return self._tool_name

    @property
    def resource_uri(self) -> Optional[str]:
        """Get resource URI with caching."""
        if self._resource_uri is None:
            self._resource_uri = self._extract_resource_uri()
        return self._resource_uri

    @property
    def transport_type(self) -> str:
        """Get transport type with caching."""
        if self._transport_type is None:
            self._transport_type = self._extract_transport_type()
        return self._transport_type

    @property
    def server_info(self) -> Dict[str, Any]:
        """Get server info with caching."""
        if self._server_info is None:
            self._server_info = self._extract_server_info()
        return self._server_info

    @property
    def request_payload(self) -> Optional[str]:
        """Get request payload with caching."""
        if self._request_payload is None:
            self._request_payload = self._extract_request_payload()
        return self._request_payload

    @property
    def response_payload(self) -> Optional[str]:
        """Get response payload with caching."""
        return self._response_payload

    def set_response_payload(self, response_payload: str) -> None:
        """Set response payload after execution."""
        self._response_payload = response_payload

    def _extract_method_name(self) -> str:
        """Extract MCP method name from request or context."""
        try:
            # Check for MCP-specific method patterns
            # For call_tool operations, try to get tool name
            if "name" in self.kwargs:
                tool_name = self.kwargs["name"]
                if isinstance(tool_name, str):
                    return tool_name
            
            # Try to get from method parameter in kwargs
            if "method" in self.kwargs:
                return str(self.kwargs["method"])

            # Try to get from args - check for tool name in call_tool
            if self.args:
                # For call_tool, the first arg is usually the tool name
                if len(self.args) >= 1 and isinstance(self.args[0], str):
                    # Check if it's a known MCP tool name pattern
                    first_arg = self.args[0]
                    if first_arg in ['calculator', 'text_analyzer', 'data_processor', 'add', 'analyze']:
                        return first_arg
                    elif first_arg in ['list_tools', 'call_tool', 'list_resources', 'read_resource', 
                                     'list_prompts', 'get_prompt']:
                        return first_arg

            # Try to get from instance method name
            if hasattr(self.instance, "__name__"):
                return self.instance.__name__
            
            # Try to detect from endpoint method
            if hasattr(self, '_endpoint_method'):
                return self._endpoint_method
            
            # Try to detect from function being wrapped
            if hasattr(self, '_wrapped_function_name'):
                func_name = self._wrapped_function_name
                if func_name in ['list_tools', 'call_tool', 'list_resources', 'read_resource',
                               'list_prompts', 'get_prompt']:
                    return func_name

            return "unknown"
        except Exception:
            return "unknown"

    def _extract_message_id(self) -> Optional[str]:
        """Extract message ID from MCP request."""
        try:
            # Check kwargs for id
            if "id" in self.kwargs:
                return str(self.kwargs["id"])

            # Check if first arg is a message object with id
            if self.args and hasattr(self.args[0], "id"):
                return str(self.args[0].id)

            return None
        except Exception:
            return None

    def _extract_tool_name(self) -> Optional[str]:
        """Extract tool name for tool operations."""
        try:
            # Check kwargs
            if "name" in self.kwargs:
                return str(self.kwargs["name"])

            # Check params for tool name
            if "params" in self.kwargs and isinstance(self.kwargs["params"], dict):
                params = self.kwargs["params"]
                if "name" in params:
                    return str(params["name"])

            return None
        except Exception:
            return None

    def _extract_resource_uri(self) -> Optional[str]:
        """Extract resource URI for resource operations."""
        try:
            # Check kwargs
            if "uri" in self.kwargs:
                return str(self.kwargs["uri"])

            # Check params for URI
            if "params" in self.kwargs and isinstance(self.kwargs["params"], dict):
                params = self.kwargs["params"]
                if "uri" in params:
                    return str(params["uri"])

            return None
        except Exception:
            return None

    def _extract_transport_type(self) -> str:
        """Extract transport type from instance."""
        try:
            # Check instance class name for transport type
            if self.instance:
                instance_class = self.instance.__class__.__name__.lower()
                instance_module = getattr(self.instance.__class__, '__module__', '').lower()
                
                # Check for stdio transport patterns
                if ("stdio" in instance_class or "stdio" in instance_module or
                    "clientsession" in instance_class):
                    return SemanticConvention.MCP_TRANSPORT_STDIO
                # Check for SSE transport
                elif "sse" in instance_class or "sse" in instance_module:
                    return SemanticConvention.MCP_TRANSPORT_SSE
                # Check for WebSocket transport
                elif "websocket" in instance_class or "ws" in instance_class:
                    return SemanticConvention.MCP_TRANSPORT_WEBSOCKET
            
            # Check kwargs for transport hints
            if self.kwargs:
                # Look for transport-related parameters
                if any(key in self.kwargs for key in ['command', 'args', 'stdio']):
                    return SemanticConvention.MCP_TRANSPORT_STDIO
                elif any(key in self.kwargs for key in ['url', 'endpoint']) and 'sse' in str(self.kwargs):
                    return SemanticConvention.MCP_TRANSPORT_SSE
                elif any(key in self.kwargs for key in ['ws_url', 'websocket']):
                    return SemanticConvention.MCP_TRANSPORT_WEBSOCKET
            
            # Default to stdio for most MCP implementations
            return SemanticConvention.MCP_TRANSPORT_STDIO
        except Exception:
            return "unknown"

    def _extract_server_info(self) -> Dict[str, Any]:
        """Extract server information."""
        try:
            server_info = {}

            # Try to get server name from instance
            if hasattr(self.instance, "name"):
                server_info["name"] = str(self.instance.name)
            elif hasattr(self.instance, "server_name"):
                server_info["name"] = str(self.instance.server_name)

            # Try to get server version
            if hasattr(self.instance, "version"):
                server_info["version"] = str(self.instance.version)

            return server_info
        except Exception:
            return {}

    def _extract_request_payload(self) -> Optional[str]:
        """Extract request payload from args/kwargs in JSON format like OpenLLMetry."""
        try:
            import json
            
            # Build request payload similar to OpenLLMetry's traceloop.entity.input
            payload = {}
            
            # Try to get method name
            method = self.method_name if self.method_name != "unknown" else None
            if method:
                payload["method"] = method
            
            # Extract parameters from kwargs and args
            params = {}
            
            # Get common MCP parameters
            if "name" in self.kwargs:
                params["name"] = self.kwargs["name"]
            if "arguments" in self.kwargs:
                params["arguments"] = self.kwargs["arguments"]
            if "uri" in self.kwargs:
                params["uri"] = self.kwargs["uri"]
                
            # Add other kwargs that look like MCP parameters
            for key, value in self.kwargs.items():
                if key in ["topic", "meta", "protocolVersion", "capabilities", "clientInfo"]:
                    params[key] = value
            
            # If we have args and no specific params, include args
            if not params and self.args:
                if len(self.args) == 1:
                    params = self.args[0] if isinstance(self.args[0], dict) else {"value": self.args[0]}
                else:
                    params = {"args": list(self.args)}
            
            if params:
                payload["params"] = params
            elif not payload:
                # Fallback if no clear structure
                return None
                
            return json.dumps(payload, default=str)
            
        except Exception:
            return None

    def get_enhanced_span_name(self, operation_type: str) -> str:
        """Generate span names following operation_type operation_name convention (e.g., 'mcp tools/list', 'mcp resources/read')."""
        method = self.method_name
        
        # Map operations to operation_type operation_name convention
        if "list_tools" in method or (operation_type == "tool" and "list" in method):
            return "mcp tools/list"
        elif "call_tool" in method or (operation_type == "tool" and any(x in method for x in ["calculator", "text_analyzer", "data_processor"])):
            return "mcp tools/call"
        elif "list_resources" in method or (operation_type == "resource" and "list" in method):
            return "mcp resources/list"
        elif "read_resource" in method or (operation_type == "resource" and "read" in method):
            return "mcp resources/read"
        elif "list_prompts" in method or (operation_type == "prompt" and "list" in method):
            return "mcp prompts/list"
        elif "get_prompt" in method or (operation_type == "prompt" and "get" in method):
            return "mcp prompts/get"
        elif "initialize" in method:
            return "mcp initialize"
        else:
            # Fallback to operation_type operation_name convention
            return f"mcp {operation_type}/{method}"


def set_mcp_span_attributes(
    span,
    operation_name: str,
    ctx: MCPInstrumentationContext,
    endpoint: str,
    response: Any = None,
    error: Optional[Exception] = None,
    **kwargs,
):
    """
    Optimized attribute setting with context caching and comprehensive MCP attributes.
    """

    # Set core MCP attributes using cached context
    span.set_attribute(SemanticConvention.MCP_OPERATION, operation_name)
    span.set_attribute(SemanticConvention.MCP_SYSTEM, "mcp")

    # Set environment attributes
    span.set_attribute(DEPLOYMENT_ENVIRONMENT, ctx.environment)
    span.set_attribute(SERVICE_NAME, ctx.application_name)
    span.set_attribute(SemanticConvention.MCP_SDK_VERSION, ctx.version)

    # Set MCP-specific attributes
    span.set_attribute(SemanticConvention.MCP_METHOD, ctx.method_name)

    # Capture request payload (OpenLLMetry-style enhancement)
    if ctx.request_payload and ctx.capture_message_content:
        span.set_attribute(SemanticConvention.MCP_REQUEST_PAYLOAD, ctx.request_payload)

    if ctx.message_id:
        span.set_attribute(SemanticConvention.MCP_MESSAGE_ID, ctx.message_id)

    span.set_attribute(SemanticConvention.MCP_TRANSPORT_TYPE, ctx.transport_type)

    # Set tool-specific attributes
    if ctx.tool_name:
        span.set_attribute(SemanticConvention.MCP_TOOL_NAME, ctx.tool_name)

    # Set resource-specific attributes
    if ctx.resource_uri:
        span.set_attribute(SemanticConvention.MCP_RESOURCE_URI, ctx.resource_uri)

    # Set server information
    server_info = ctx.server_info
    if server_info.get("name"):
        span.set_attribute(
            SemanticConvention.MCP_SERVER_NAME, server_info["name"]
        )
    if server_info.get("version"):
        span.set_attribute(
            SemanticConvention.MCP_SERVER_VERSION, server_info["version"]
        )

    # Capture request/response content if enabled
    if ctx.capture_message_content:
        _capture_mcp_content(span, ctx, response, **kwargs)

    # Handle errors
    if error:
        _capture_mcp_error(span, error)


def _capture_mcp_content(span, ctx: MCPInstrumentationContext, response: Any, **kwargs):
    """Capture MCP request and response content with MIME types (OpenLIT enhancement)."""
    try:
        # Capture request parameters
        if "params" in ctx.kwargs:
            params_str = json.dumps(ctx.kwargs["params"], default=str)
            span.set_attribute(SemanticConvention.MCP_PARAMS, params_str)

        # Capture response content
        if response is not None:
            if hasattr(response, "result"):
                result_str = json.dumps(response.result, default=str)
                span.set_attribute(SemanticConvention.MCP_RESULT, result_str)
            elif isinstance(response, (dict, list, str, int, float, bool)):
                result_str = json.dumps(response, default=str)
                span.set_attribute(SemanticConvention.MCP_RESULT, result_str)

        # Capture tool arguments for tool calls
        if ctx.tool_name and "arguments" in ctx.kwargs:
            args_str = json.dumps(ctx.kwargs["arguments"], default=str)
            span.set_attribute(SemanticConvention.MCP_TOOL_ARGUMENTS, args_str)

    except Exception:
        # Silently ignore content capture errors
        pass


def _capture_mcp_error(span, error: Exception):
    """Capture MCP error information."""
    try:
        # Set error attributes
        span.set_attribute(SemanticConvention.MCP_ERROR_MESSAGE, str(error))

        # Try to extract MCP-specific error details
        if hasattr(error, "code"):
            span.set_attribute(
                SemanticConvention.MCP_ERROR_CODE, str(error.code)
            )

        if hasattr(error, "data"):
            error_data = json.dumps(error.data, default=str)
            span.set_attribute(SemanticConvention.MCP_ERROR_DATA, error_data)

    except Exception:
        # Silently ignore error capture errors
        pass


def process_mcp_response(
    response,
    ctx: MCPInstrumentationContext,
    span,
    start_time: float,
    endpoint: str,
    metrics,
    disable_metrics: bool = False,
    **kwargs,
):
    """
    Process MCP response with comprehensive business intelligence tracking.
    """

    try:
        end_time = time.time()

        # Set basic response attributes
        set_mcp_span_attributes(span, endpoint, ctx, endpoint, response, **kwargs)

        # Calculate performance metrics (OpenLIT business intelligence)
        duration = end_time - start_time
        span.set_attribute(
            SemanticConvention.MCP_CLIENT_OPERATION_DURATION, duration
        )

        # Capture response payload (OpenLLMetry-style enhancement)
        try:
            if response and ctx.capture_message_content:
                # Handle different response types intelligently
                if hasattr(response, '__await__'):
                    # It's a coroutine - extract meaningful info without awaiting
                    coroutine_name = getattr(response, '__name__', 'unknown')
                    if hasattr(response, 'cr_code'):
                        func_name = response.cr_code.co_name
                    else:
                        func_name = str(response).split('.')[-1].split(' ')[0]
                    
                    response_info = {
                        "type": "mcp_coroutine",
                        "function": func_name,
                        "awaitable": True,
                        "note": "Response data available after await"
                    }
                    response_json = json.dumps(response_info)
                elif hasattr(response, '__dict__'):
                    # It's a structured object - capture its content
                    try:
                        response_json = json.dumps(response.__dict__, default=str)
                    except:
                        response_json = json.dumps({"type": type(response).__name__, "value": str(response)})
                else:
                    # Regular response
                    response_json = json.dumps(response, default=str)
                
                ctx.set_response_payload(response_json)
                span.set_attribute(SemanticConvention.MCP_RESPONSE_PAYLOAD, response_json)
        except Exception:
            pass

        # Capture message size for performance analysis
        try:
            if response:
                response_size = len(json.dumps(response, default=str))
                span.set_attribute(
                    SemanticConvention.MCP_RESPONSE_SIZE, response_size
                )
        except Exception:
            pass

        # Record metrics (OpenLIT business intelligence)
        if metrics and not disable_metrics:
            record_framework_metrics(
                metrics=metrics,
                gen_ai_operation=endpoint,
                gen_ai_system=SemanticConvention.GEN_AI_SYSTEM_MCP,
                server_address="localhost",
                server_port=0,
                environment=ctx.environment,
                application_name=ctx.application_name,
                start_time=start_time,
                end_time=end_time,
            )

    except Exception as e:
        handle_exception(span, e)

    return response


def create_mcp_scope(
    instance,
    args,
    kwargs,
    version,
    environment,
    application_name,
    pricing_info,
    capture_message_content,
    span,
    start_time: float,
):
    """
    Create optimized scope object for MCP operations following OpenLIT patterns.
    """

    # Create scope object using OpenLIT pattern
    scope = type("MCPScope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = None

    # Create instrumentation context
    scope._context = MCPInstrumentationContext(
        instance=instance,
        args=args,
        kwargs=kwargs,
        version=version,
        environment=environment,
        application_name=application_name,
        pricing_info=pricing_info,
        capture_message_content=capture_message_content,
    )

    return scope


def serialize_openllmetry_style(request, depth=0, max_depth=4):
    """
    Serialize input args to MCP server into JSON (OpenLLMetry-inspired).
    The function accepts input object and converts into JSON
    keeping depth in mind to prevent creating large nested JSON.
    """
    if depth > max_depth:
        return {}
    depth += 1

    def is_serializable(request):
        try:
            json.dumps(request)
            return True
        except Exception:
            return False

    if is_serializable(request):
        return json.dumps(request)
    else:
        result = {}
        try:
            if hasattr(request, "model_dump_json"):
                return request.model_dump_json()
            if hasattr(request, "__dict__"):
                for attrib in request.__dict__:
                    if not attrib.startswith("_"):
                        if type(request.__dict__[attrib]) in [
                            bool,
                            str,
                            int,
                            float,
                            type(None),
                        ]:
                            result[str(attrib)] = request.__dict__[attrib]
                        else:
                            result[str(attrib)] = serialize_openllmetry_style(
                                request.__dict__[attrib], depth
                            )
        except Exception:
            pass
        return json.dumps(result)


def create_jsonrpc_wrapper(endpoint, version, environment, application_name, tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Create OpenLLMetry-style JSONRPC wrapper that captures actual response data.
    This wraps BaseSession.send_request to get proper async handling.
    """
    def wrapper(wrapped, instance, args, kwargs):
        async def async_wrapper(*args, **kwargs):
            # Extract method and params from JSONRPC request (OpenLLMetry approach)
            meta = None
            method = None
            params = None
            if len(args) > 0 and hasattr(args[0], "root") and hasattr(args[0].root, "method"):
                method = args[0].root.method
            if len(args) > 0 and hasattr(args[0], "root") and hasattr(args[0].root, "params"):
                params = args[0].root.params
            if params:
                if hasattr(params, "meta"):
                    meta = params.meta

            # Create span name following operation_type operation_name convention
            span_name = f"mcp {method}" if method else "mcp send_request"
            
            with tracer.start_as_current_span(span_name) as span:
                # Set input attributes (OpenLLMetry approach)
                if capture_message_content and len(args) > 0:
                    input_serialized = serialize_openllmetry_style(args[0])
                    span.set_attribute(SemanticConvention.MCP_REQUEST_PAYLOAD, input_serialized)
                
                # Set method attribute
                if method:
                    span.set_attribute(SemanticConvention.MCP_METHOD, method)
                
                # Set OpenLIT business intelligence attributes
                span.set_attribute(SemanticConvention.MCP_SYSTEM, "mcp")
                span.set_attribute(SemanticConvention.MCP_SDK_VERSION, version)
                if environment:
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
                if application_name:
                    span.set_attribute(SERVICE_NAME, application_name)
                
                start_time = time.time()
                
                try:
                    # CRITICAL: Properly await the response (OpenLLMetry approach)
                    result = await wrapped(*args, **kwargs)
                    
                    # Capture response with OpenLLMetry approach
                    if result and capture_message_content:
                        output_serialized = serialize_openllmetry_style(result)
                        span.set_attribute(SemanticConvention.MCP_RESPONSE_PAYLOAD, output_serialized)
                    
                    # Set success status
                    if hasattr(result, "isError") and result.isError:
                        if hasattr(result, "content") and len(result.content) > 0:
                            span.set_status(Status(StatusCode.ERROR, f"{result.content[0].text}"))
                    
                    # OpenLIT business intelligence
                    end_time = time.time()
                    duration = end_time - start_time
                    span.set_attribute(SemanticConvention.MCP_CLIENT_OPERATION_DURATION, duration)
                    
                    # Record MCP-specific metrics for business intelligence
                    if not disable_metrics and metrics:
                        # Extract tool, resource, and prompt info from method and params
                        tool_name = None
                        resource_uri = None
                        prompt_name = None
                        
                        if method and method.startswith("tools/call") and params:
                            tool_name = str(getattr(params, 'name', None)) if getattr(params, 'name', None) else None
                        elif method and method.startswith("resources/read") and params:
                            resource_uri = str(getattr(params, 'uri', None)) if getattr(params, 'uri', None) else None
                        elif method and method.startswith("prompts/get") and params:
                            prompt_name = str(getattr(params, 'name', None)) if getattr(params, 'name', None) else None
                        
                        # Calculate payload sizes
                        request_size = len(serialize_openllmetry_style(args[0])) if len(args) > 0 else None
                        response_size = len(serialize_openllmetry_style(result)) if result else None
                        
                        record_mcp_metrics(
                            metrics=metrics,
                            mcp_operation=method or "send_request",
                            mcp_method=method or "unknown",
                            mcp_transport_type="stdio",  # Default, could be extracted from context
                            mcp_tool_name=tool_name,
                            mcp_resource_uri=resource_uri,
                            mcp_prompt_name=prompt_name,
                            environment=environment,
                            application_name=application_name,
                            start_time=start_time,
                            end_time=end_time,
                            request_size=request_size,
                            response_size=response_size,
                            is_error=False,
                        )
                    
                    return result
                    
                except Exception as e:
                    handle_exception(span, e)
                    
                    # Record error metrics
                    if not disable_metrics and metrics:
                        end_time = time.time()
                        
                        # Extract method info for error metrics
                        tool_name = None
                        resource_uri = None
                        prompt_name = None
                        
                        if method and method.startswith("tools/call") and params:
                            tool_name = str(getattr(params, 'name', None)) if getattr(params, 'name', None) else None
                        elif method and method.startswith("resources/read") and params:
                            resource_uri = str(getattr(params, 'uri', None)) if getattr(params, 'uri', None) else None
                        elif method and method.startswith("prompts/get") and params:
                            prompt_name = str(getattr(params, 'name', None)) if getattr(params, 'name', None) else None
                        
                        request_size = len(serialize_openllmetry_style(args[0])) if len(args) > 0 else None
                        
                        record_mcp_metrics(
                            metrics=metrics,
                            mcp_operation=method or "send_request",
                            mcp_method=method or "unknown",
                            mcp_transport_type="stdio",
                            mcp_tool_name=tool_name,
                            mcp_resource_uri=resource_uri,
                            mcp_prompt_name=prompt_name,
                            environment=environment,
                            application_name=application_name,
                            start_time=start_time,
                            end_time=end_time,
                            request_size=request_size,
                            response_size=None,
                            is_error=True,
                        )
                    
                    raise
        
        # Handle both sync and async contexts
        if inspect.iscoroutinefunction(wrapped):
            return async_wrapper(*args, **kwargs)
        else:
            # For sync calls, create an async wrapper and run it
            import asyncio
            try:
                loop = asyncio.get_running_loop()
                # We're in an async context
                return asyncio.create_task(async_wrapper(*args, **kwargs))
            except RuntimeError:
                # No running loop
                return asyncio.run(async_wrapper(*args, **kwargs))
    
    return wrapper
