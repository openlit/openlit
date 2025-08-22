# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""
Optimized Auto Instrumentation of MCP (Model Context Protocol) Functions following OpenLIT Framework Guide.
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.mcp.mcp import mcp_wrap
from openlit.instrumentation.mcp.async_mcp import async_mcp_wrap
from openlit.instrumentation.mcp.utils import create_jsonrpc_wrapper

_instruments = ("mcp >= 0.1.0",)

# CRITICAL: Following OpenLLMetry's superior approach - wrap at JSONRPC level
# This ensures proper async handling and response capture
CORE_JSONRPC_METHODS = [
    # === CORE JSONRPC COMMUNICATION (OpenLLMetry-inspired) ===
    {
        "package": "mcp.shared.session",
        "object": "BaseSession.send_request",
        "endpoint": "jsonrpc send_request",
        "priority": "critical",
        "wrapper_type": "jsonrpc",
    },
]

# Legacy method configuration (for fallback support)
SYNC_METHODS = [
    # === WORKFLOW OPERATIONS (Always enabled) - High priority ===
    # Client Operations
    {
        "package": "mcp.client.session",
        "object": "ClientSession.call_tool",
        "endpoint": "tool call_tool",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.list_tools",
        "endpoint": "tool list_tools",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.read_resource",
        "endpoint": "resource read_resource",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.list_resources",
        "endpoint": "resource list_resources",
        "priority": "high",
    },
    # Server Operations
    {
        "package": "mcp.server.session",
        "object": "ServerSession.send_result",
        "endpoint": "response mcp_response",
        "priority": "high",
    },
    {
        "package": "mcp.server.session",
        "object": "ServerSession.send_error",
        "endpoint": "response mcp_error",
        "priority": "high",
    },
    {
        "package": "mcp.server.session",
        "object": "ServerSession.request_handler",
        "endpoint": "server process_request",
        "priority": "critical",
    },
    # === COMPONENT OPERATIONS (Detailed tracing only) - Medium priority ===
    # Transport Operations
    {
        "package": "mcp.server.stdio",
        "object": "StdioServerTransport.start",
        "endpoint": "transport stdio_start",
        "priority": "medium",
    },
    {
        "package": "mcp.server.stdio",
        "object": "StdioServerTransport.send_message",
        "endpoint": "transport stdio_send",
        "priority": "medium",
    },
    {
        "package": "mcp.server.sse",
        "object": "SSEServerTransport.start",
        "endpoint": "transport sse_start",
        "priority": "medium",
    },
    {
        "package": "mcp.server.sse",
        "object": "SSEServerTransport.send_message",
        "endpoint": "transport sse_send",
        "priority": "medium",
    },
    # Message Processing
    {
        "package": "mcp.types",
        "object": "JSONRPCMessage.serialize",
        "endpoint": "message serialize",
        "priority": "low",
    },
    {
        "package": "mcp.types",
        "object": "JSONRPCMessage.deserialize",
        "endpoint": "message deserialize",
        "priority": "low",
    },
]

ASYNC_METHODS = [
    # === ASYNC WORKFLOW OPERATIONS (Always enabled) ===
    # Async Client Operations
    {
        "package": "mcp.client.session",
        "object": "ClientSession.acall_tool",
        "endpoint": "tool call_tool",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.alist_tools",
        "endpoint": "tool list_tools",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.aread_resource",
        "endpoint": "resource read_resource",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.alist_resources",
        "endpoint": "resource list_resources",
        "priority": "high",
    },
    {
        "package": "mcp.client.session",
        "object": "ClientSession.arequest",
        "endpoint": "request mcp_request",
        "priority": "critical",
    },
    # Async Server Operations
    {
        "package": "mcp.server.session",
        "object": "ServerSession.asend_result",
        "endpoint": "response mcp_response",
        "priority": "high",
    },
    {
        "package": "mcp.server.session",
        "object": "ServerSession.asend_error",
        "endpoint": "response mcp_error",
        "priority": "high",
    },
    {
        "package": "mcp.server.session",
        "object": "ServerSession.arequest_handler",
        "endpoint": "server process_request",
        "priority": "critical",
    },
    # === ASYNC COMPONENT OPERATIONS (Detailed tracing only) ===
    # Async Transport Operations
    {
        "package": "mcp.server.stdio",
        "object": "StdioServerTransport.astart",
        "endpoint": "transport stdio_start",
        "priority": "medium",
    },
    {
        "package": "mcp.server.stdio",
        "object": "StdioServerTransport.asend_message",
        "endpoint": "transport stdio_send",
        "priority": "medium",
    },
    {
        "package": "mcp.server.sse",
        "object": "SSEServerTransport.astart",
        "endpoint": "transport sse_start",
        "priority": "medium",
    },
    {
        "package": "mcp.server.sse",
        "object": "SSEServerTransport.asend_message",
        "endpoint": "transport sse_send",
        "priority": "medium",
    },
]


class MCPInstrumentor(BaseInstrumentor):
    """Optimized instrumentor for MCP's client and server libraries."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        """Optimized instrumentation with performance considerations and detailed tracing support."""
        # Extract configuration
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        capture_message_content = kwargs.get("capture_message_content")
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", True)

        # Cache version lookup
        try:
            version = importlib.metadata.version("mcp")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        # Pre-create wrapper args
        wrapper_args = (
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )

        # PRIORITY 1: Instrument JSONRPC level (OpenLLMetry approach)
        try:
            wrap_function_wrapper(
                "mcp.shared.session",
                "BaseSession.send_request", 
                create_jsonrpc_wrapper(
                    "jsonrpc send_request",  # endpoint
                    *wrapper_args
                )
            )
        except (ImportError, AttributeError):
            # Fallback to legacy approach if JSONRPC wrapping fails
            # Always instrument workflow operations (high priority)
            workflow_methods = [
                m for m in SYNC_METHODS if m["priority"] in ["critical", "high"]
            ]
            async_workflow_methods = [
                m for m in ASYNC_METHODS if m["priority"] in ["critical", "high"]
            ]

            self._wrap_methods(workflow_methods, mcp_wrap, wrapper_args)
            self._wrap_methods(async_workflow_methods, async_mcp_wrap, wrapper_args)

        # Only instrument component operations if detailed_tracing is enabled
        if detailed_tracing:
            component_methods = [
                m for m in SYNC_METHODS if m["priority"] in ["medium", "low"]
            ]
            async_component_methods = [
                m for m in ASYNC_METHODS if m["priority"] in ["medium", "low"]
            ]

            self._wrap_methods(component_methods, mcp_wrap, wrapper_args)
            self._wrap_methods(async_component_methods, async_mcp_wrap, wrapper_args)

    def _wrap_methods(self, methods, wrapper_func, wrapper_args):
        """Efficiently wrap methods with error handling following OpenLIT patterns."""
        for method_config in methods:
            try:
                wrap_function_wrapper(
                    method_config["package"],
                    method_config["object"],
                    wrapper_func(method_config["endpoint"], *wrapper_args),
                )
            except (ImportError, AttributeError):
                # Gracefully handle missing methods in different MCP versions
                pass

    @staticmethod
    def _uninstrument(self, **kwargs):
        """Uninstrument MCP."""
        # Currently no cleanup needed
