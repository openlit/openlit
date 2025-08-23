#!/usr/bin/env python3
"""
FastMCP Server Example - Showcasing OpenLIT's Enhanced MCP Instrumentation

This example demonstrates:
1. FastMCP high-level framework instrumentation
2. Enhanced attribute collection (server config, tool metadata, etc.)
3. Manager-level business intelligence
4. Advanced session and performance tracking

The server will generate comprehensive telemetry spans with 67+ attributes.
"""

import asyncio
import openlit

# Initialize OpenLIT with detailed tracing to capture all our new FastMCP attributes
openlit.init(
    application_name="fastmcp-server-demo",
    environment="development",
    detailed_tracing=True,  # Enable FastMCP manager-level instrumentation
    otlp_endpoint="http://localhost:4318",  # Send to local OpenLIT instance
    collect_gpu_stats=False
)

# Import FastMCP after OpenLIT initialization to ensure instrumentation
from mcp.server.fastmcp import FastMCP, Context
from pydantic import BaseModel


class CalculationInput(BaseModel):
    """Input schema for calculation tool."""
    expression: str
    description: str = "A mathematical expression to evaluate"


class WeatherInput(BaseModel):  
    """Input schema for weather tool."""
    city: str
    units: str = "celsius"


# Create FastMCP server with comprehensive configuration
# This will trigger our FastMCP framework instrumentation
server = FastMCP(
    name="Enhanced FastMCP Demo",
    instructions="A comprehensive FastMCP server showcasing OpenLIT's enhanced instrumentation",
    debug=True,  # Will be captured in mcp.fastmcp.server.debug_mode attribute
    log_level="INFO",  # Will be captured in mcp.fastmcp.server.log_level attribute  
    host="127.0.0.1",  # Will be captured in mcp.fastmcp.server.host attribute
    port=8000,  # Will be captured in mcp.fastmcp.server.port attribute
    warn_on_duplicate_tools=True,  # Will be captured in manager attributes
    warn_on_duplicate_resources=True,  # Will be captured in manager attributes
)

print("🚀 Starting Enhanced FastMCP Server with OpenLIT instrumentation...")
print("🔍 This server showcases all new instrumentation features:")
print("   - FastMCP framework operations (run, add_tool, add_resource, etc.)")  
print("   - Manager-level business intelligence (tool counts, configurations)")
print("   - Enhanced attribute collection (67+ new attributes)")
print("   - Performance & reliability metrics")
print("✅ FastMCP Server configured and ready")


@server.tool(
    title="Advanced Calculator", 
    description="Evaluates mathematical expressions with error handling"
)
async def calculate(expression: str, ctx: Context) -> dict:
    """Enhanced calculator tool with comprehensive telemetry."""
    await ctx.info(f"🧮 Calculating: {expression}")
    
    try:
        # This tool call will generate spans with:
        # - mcp.fastmcp.tool.annotations (our annotations)
        # - mcp.tool.execution_time (performance tracking)
        # - mcp.manager.type="tool" (manager-level data)
        result = eval(expression)  # Simple eval for demo
        
        await ctx.info(f"✅ Result: {result}")
        return {
            "expression": expression,
            "result": result,
            "status": "success"
        }
    except Exception as e:
        await ctx.error(f"❌ Calculation error: {str(e)}")
        return {
            "expression": expression, 
            "error": str(e),
            "status": "error"
        }


@server.tool(
    title="Weather Information",
    description="Gets weather information for a city"
)
async def get_weather(city: str, units: str = "celsius", ctx: Context = None) -> dict:
    """Weather tool showcasing FastMCP instrumentation."""
    if ctx:
        await ctx.info(f"🌤️  Getting weather for {city} in {units}")
    
    # Simulate weather data
    weather_data = {
        "city": city,
        "temperature": 22 if units == "celsius" else 72,
        "units": units,
        "condition": "sunny",
        "humidity": "65%"
    }
    
    if ctx:
        await ctx.info(f"✅ Weather retrieved for {city}")
    
    return weather_data


@server.resource(
    "resource://demo-config", 
    name="Demo Configuration",
    title="Server Configuration Data",
    description="Example resource showcasing FastMCP resource instrumentation"
)
async def get_config() -> dict:
    """Configuration resource with comprehensive instrumentation."""
    
    # This resource read will generate spans with:
    # - mcp.fastmcp.resource.mime_type
    # - mcp.resource.read_time (performance tracking)
    # - mcp.manager.type="resource" (manager-level data)
    return {
        "server_name": "Enhanced FastMCP Demo",
        "version": "1.0.0",
        "features": [
            "FastMCP framework instrumentation",
            "Manager-level business intelligence", 
            "Performance & reliability tracking",
            "67+ enhanced attributes"
        ],
        "telemetry": {
            "instrumentation": "OpenLIT Enhanced MCP",
            "attributes_count": "110+",
            "methods_instrumented": "70+"
        }
    }


@server.prompt(
    name="analysis_prompt",
    title="Data Analysis Prompt",
    description="Generates analysis prompts with comprehensive tracking"
)
async def create_analysis_prompt(data_type: str) -> list:
    """Analysis prompt showcasing FastMCP prompt instrumentation."""
    
    # This prompt generation will capture:
    # - mcp.fastmcp.prompt.arguments
    # - mcp.prompt.render_time (performance tracking)
    # - mcp.manager.type="prompt" (manager-level data)
    return [
        {
            "role": "user", 
            "content": f"As an expert {data_type} analyst, please analyze the provided data and provide insights, patterns, and recommendations. Focus on actionable findings and statistical significance."
        }
    ]


def main():
    """Run the FastMCP server with comprehensive instrumentation."""
    print("📊 All FastMCP operations will generate enhanced telemetry:")
    print("   - Server initialization spans") 
    print("   - Tool registration and execution spans")
    print("   - Resource management spans")
    print("   - Prompt handling spans")
    print("   - Manager-level business intelligence")
    print("   - Performance & reliability metrics")
    print("🔌 FastMCP server starting - ready for client connections...")
    
    # This FastMCP.run() call will trigger our enhanced instrumentation
    # generating spans with all our new FastMCP framework attributes
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
