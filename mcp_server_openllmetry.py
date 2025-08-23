#!/usr/bin/env python3
"""
MCP Server with OpenLLMetry instrumentation for comparison with OpenLIT.
This demonstrates OpenLLMetry's approach to MCP observability.
"""

import asyncio
import logging
import json

# Initialize OpenLLMetry instrumentation
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.mcp import McpInstrumentor

# Set up OpenTelemetry for OpenLLMetry
resource = Resource.create(
    {"service.name": "mcp-server-openllmetry", "deployment.environment": "development"}
)

trace.set_tracer_provider(TracerProvider(resource=resource))
tracer_provider = trace.get_tracer_provider()

# Configure OTLP exporter to send to local OpenLIT instance
otlp_exporter = OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces", headers={})

span_processor = BatchSpanProcessor(otlp_exporter)
tracer_provider.add_span_processor(span_processor)

# Initialize OpenLLMetry MCP instrumentation
McpInstrumentor().instrument()

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    ListToolsResult,
    Tool,
    CallToolResult,
    TextContent,
    ListResourcesResult,
    Resource as MCPResource,
    ReadResourceResult,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-server-openllmetry")

# Create MCP server
server = Server("openllmetry-mcp-server")


@server.list_tools()
async def list_tools() -> ListToolsResult:
    """List available tools - instrumented by OpenLLMetry."""
    logger.info("📋 OpenLLMetry Server: Listing available tools")

    tools = [
        Tool(
            name="calculator",
            description="Perform basic math calculations (OpenLLMetry instrumented)",
            inputSchema={
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": ["add", "subtract", "multiply", "divide"],
                    },
                    "a": {"type": "number"},
                    "b": {"type": "number"},
                },
                "required": ["operation", "a", "b"],
            },
        ),
        Tool(
            name="echo",
            description="Echo back any message (OpenLLMetry instrumented)",
            inputSchema={
                "type": "object",
                "properties": {"message": {"type": "string"}},
                "required": ["message"],
            },
        ),
        Tool(
            name="uuid_generator",
            description="Generate a random UUID (OpenLLMetry instrumented)",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]

    return ListToolsResult(tools=tools)


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> CallToolResult:
    """Handle tool calls - instrumented by OpenLLMetry."""
    logger.info(
        f"🔧 OpenLLMetry Server: Executing tool '{name}' with args: {arguments}"
    )

    if name == "calculator":
        operation = arguments.get("operation")
        a = arguments.get("a", 0)
        b = arguments.get("b", 0)

        if operation == "add":
            result = a + b
        elif operation == "subtract":
            result = a - b
        elif operation == "multiply":
            result = a * b
        elif operation == "divide":
            if b == 0:
                return CallToolResult(
                    content=[
                        TextContent(
                            type="text", text="Error: Division by zero (OpenLLMetry)"
                        )
                    ]
                )
            result = a / b
        else:
            return CallToolResult(
                content=[
                    TextContent(
                        type="text",
                        text=f"Error: Unknown operation '{operation}' (OpenLLMetry)",
                    )
                ]
            )

        return CallToolResult(
            content=[
                TextContent(
                    type="text",
                    text=f"OpenLLMetry Calculator result: {a} {operation} {b} = {result}",
                )
            ]
        )

    elif name == "echo":
        message = arguments.get("message", "")
        return CallToolResult(
            content=[TextContent(type="text", text=f"OpenLLMetry Echo: {message}")]
        )

    elif name == "uuid_generator":
        import uuid

        new_uuid = str(uuid.uuid4())
        return CallToolResult(
            content=[
                TextContent(type="text", text=f"OpenLLMetry Generated UUID: {new_uuid}")
            ]
        )

    else:
        return CallToolResult(
            content=[
                TextContent(
                    type="text", text=f"Error: Unknown tool '{name}' (OpenLLMetry)"
                )
            ]
        )


@server.list_resources()
async def list_resources() -> ListResourcesResult:
    """List available resources - instrumented by OpenLLMetry."""
    logger.info("📚 OpenLLMetry Server: Listing available resources")

    resources = [
        MCPResource(
            uri="file://openllmetry-demo.txt",
            name="OpenLLMetry Demo Text File",
            description="A sample text resource from OpenLLMetry server",
        ),
        MCPResource(
            uri="config://openllmetry-server.json",
            name="OpenLLMetry Server Configuration",
            description="OpenLLMetry server configuration data",
        ),
    ]

    return ListResourcesResult(resources=resources)


@server.read_resource()
async def read_resource(uri: str) -> ReadResourceResult:
    """Read resource content - instrumented by OpenLLMetry."""
    logger.info(f"📖 OpenLLMetry Server: Reading resource '{uri}'")

    if uri == "file://openllmetry-demo.txt":
        content = "This is a sample text file content from the OpenLLMetry MCP server! Comparison data for telemetry analysis."
    elif uri == "config://openllmetry-server.json":
        config = {
            "server_name": "openllmetry-mcp-server",
            "version": "1.0.0",
            "instrumentation": "OpenLLMetry",
            "capabilities": ["tools", "resources"],
            "max_connections": 10,
            "telemetry_backend": "OpenLIT",
        }
        content = json.dumps(config, indent=2)
    else:
        return ReadResourceResult(
            contents=[
                TextContent(
                    type="text", text=f"Error: Resource '{uri}' not found (OpenLLMetry)"
                )
            ]
        )

    return ReadResourceResult(contents=[TextContent(type="text", text=content)])


async def main():
    """Run the OpenLLMetry instrumented MCP server."""
    logger.info("🚀 Starting OpenLLMetry MCP Server...")
    logger.info("🔍 OpenLLMetry will capture MCP operations")
    logger.info("🔧 This server uses OpenLLMetry's MCP instrumentation approach")
    logger.info("📊 Telemetry comparison: OpenLLMetry vs OpenLIT")

    try:
        # Start stdio server
        async with stdio_server() as (read_stream, write_stream):
            logger.info("✅ OpenLLMetry MCP Server started and ready")
            logger.info("📡 Instrumentation: OpenLLMetry MCP Instrumentor")
            logger.info("🎯 Sending telemetry to OpenLIT for comparison")
            logger.info("🔌 Server running - waiting for client connections...")

            # Run the server - OpenLLMetry will instrument MCP operations
            await server.run(
                read_stream, write_stream, server.create_initialization_options()
            )

    except KeyboardInterrupt:
        logger.info("🛑 OpenLLMetry Server stopped by user")
    except Exception as e:
        logger.error(f"❌ OpenLLMetry Server error: {e}")
        raise

    logger.info("🏁 OpenLLMetry MCP Server stopped")


if __name__ == "__main__":
    asyncio.run(main())
