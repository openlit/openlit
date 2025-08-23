#!/usr/bin/env python3
"""
Instrumented MCP Server with OpenLIT
This demonstrates server-side instrumentation that developers control.
"""

import asyncio
import logging
import json

# Initialize OpenLIT instrumentation
import openlit
openlit.init(
    application_name="mcp-server-demo",
    environment="development",
    detailed_tracing=True,
    otlp_endpoint="http://localhost:4318",  # Send to local OpenLIT instance
    collect_gpu_stats=False
)

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    ListToolsResult, 
    Tool, 
    CallToolResult, 
    TextContent,
    ListResourcesResult,
    Resource,
    ReadResourceResult
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-server")

# Create MCP server
server = Server("demo-mcp-server")

@server.list_tools()
async def list_tools() -> ListToolsResult:
    """List available tools - this generates spans with tool metadata."""
    logger.info("📋 Server: Listing available tools")
    
    tools = [
        Tool(
            name="calculator", 
            description="Perform basic math calculations",
            inputSchema={
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "enum": ["add", "subtract", "multiply", "divide"]},
                    "a": {"type": "number"},
                    "b": {"type": "number"}
                },
                "required": ["operation", "a", "b"]
            }
        ),
        Tool(
            name="echo", 
            description="Echo back any message",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string"}
                },
                "required": ["message"]
            }
        ),
        Tool(
            name="uuid_generator",
            description="Generate a random UUID",
            inputSchema={"type": "object", "properties": {}}
        )
    ]
    
    return ListToolsResult(tools=tools)

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> CallToolResult:
    """Handle tool calls - generates spans with execution results."""
    logger.info(f"🔧 Server: Executing tool '{name}' with args: {arguments}")
    
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
                    content=[TextContent(type="text", text="Error: Division by zero")]
                )
            result = a / b
        else:
            return CallToolResult(
                content=[TextContent(type="text", text=f"Error: Unknown operation '{operation}'")]
            )
        
        return CallToolResult(
            content=[TextContent(
                type="text", 
                text=f"Calculator result: {a} {operation} {b} = {result}"
            )]
        )
    
    elif name == "echo":
        message = arguments.get("message", "")
        return CallToolResult(
            content=[TextContent(type="text", text=f"Echo: {message}")]
        )
    
    elif name == "uuid_generator":
        import uuid
        new_uuid = str(uuid.uuid4())
        return CallToolResult(
            content=[TextContent(type="text", text=f"Generated UUID: {new_uuid}")]
        )
    
    else:
        return CallToolResult(
            content=[TextContent(type="text", text=f"Error: Unknown tool '{name}'")]
        )

@server.list_resources()
async def list_resources() -> ListResourcesResult:
    """List available resources - generates spans with resource metadata."""
    logger.info("📚 Server: Listing available resources")
    
    resources = [
        Resource(
            uri="file://demo.txt",
            name="Demo Text File",
            description="A sample text resource"
        ),
        Resource(
            uri="config://server.json",
            name="Server Configuration",
            description="Server configuration data"
        )
    ]
    
    return ListResourcesResult(resources=resources)

@server.read_resource()
async def read_resource(uri: str) -> ReadResourceResult:
    """Read resource content - generates spans with resource data."""
    logger.info(f"📖 Server: Reading resource '{uri}'")
    
    if uri == "file://demo.txt":
        content = "This is a sample text file content from the MCP server!"
    elif uri == "config://server.json":
        config = {
            "server_name": "demo-mcp-server",
            "version": "1.0.0",
            "capabilities": ["tools", "resources"],
            "max_connections": 10
        }
        content = json.dumps(config, indent=2)
    else:
        return ReadResourceResult(
            contents=[TextContent(type="text", text=f"Error: Resource '{uri}' not found")]
        )
    
    return ReadResourceResult(
        contents=[TextContent(type="text", text=content)]
    )

async def main():
    """Run the instrumented MCP server as a standalone service."""
    logger.info("🚀 Starting Standalone MCP Server with OpenLIT instrumentation...")
    logger.info("🔍 Server operations will generate telemetry spans with detailed_tracing=True")
    logger.info("🔧 This server represents a tool/service (like Grafana MCP Server)")
    
    try:
        # Start stdio server - this is how production MCP servers work
        async with stdio_server() as (read_stream, write_stream):
            logger.info("✅ MCP Server started and ready for client connections")
            logger.info("📊 OpenLIT will capture server-side spans for:")
            logger.info("   - Tool operations (list_tools, call_tool)")
            logger.info("   - Resource operations (list_resources, read_resource)")
            logger.info("   - Server initialization and JSONRPC communication")
            logger.info("🔌 Server running - clients can connect via stdio transport...")
            
            # Run the server - this generates spans when clients connect and make requests
            await server.run(read_stream, write_stream, server.create_initialization_options())
            
    except KeyboardInterrupt:
        logger.info("🛑 Server stopped by user")
    except Exception as e:
        logger.error(f"❌ Server error: {e}")
        raise
    
    logger.info("🏁 MCP Server stopped")

if __name__ == "__main__":
    asyncio.run(main())
