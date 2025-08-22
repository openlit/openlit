#!/usr/bin/env python3
"""
OpenLLMetry (OpenTelemetry) MCP instrumentation test.
Tests OpenLLMetry's MCP instrumentation with real MCP operations.
"""

import sys
import os
import asyncio
import time
import json

# Import OpenTelemetry components for proper setup
try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry import metrics
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import ConsoleMetricExporter, PeriodicExportingMetricReader
    OTEL_AVAILABLE = True
except ImportError as e:
    print(f"❌ OpenTelemetry not available: {e}")
    OTEL_AVAILABLE = False

# Import real MCP components
try:
    from mcp.server import Server, NotificationOptions
    from mcp.server.models import InitializationOptions
    import mcp.server.stdio
    import mcp.types as types
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    REAL_MCP = True
except ImportError as e:
    print(f"❌ MCP SDK not available: {e}")
    REAL_MCP = False

# Import OpenLLMetry (OpenTelemetry MCP)
try:
    from opentelemetry.instrumentation.mcp import McpInstrumentor
    OPENLLMETRY_AVAILABLE = True
except ImportError as e:
    print(f"❌ OpenLLMetry MCP not available: {e}")
    OPENLLMETRY_AVAILABLE = False


async def run_mcp_operations():
    """Run the same MCP operations as other tests"""
    if not REAL_MCP:
        return False
    
    try:
        server_params = StdioServerParameters(
            command="python",
            args=["-c", """
import asyncio
from mcp.server import Server, NotificationOptions
from mcp.server.models import InitializationOptions
import mcp.server.stdio
import mcp.types as types

server = Server('openllmetry-test-server')

@server.list_tools()
async def list_tools():
    return [
        types.Tool(name='calculator', description='Calculate numbers', inputSchema={"type": "object"}),
        types.Tool(name='text_analyzer', description='Analyze text content', inputSchema={"type": "object"}),
        types.Tool(name='data_processor', description='Process data arrays', inputSchema={"type": "object"})
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == 'calculator':
        result = arguments.get('a', 0) + arguments.get('b', 0)
        return [types.TextContent(type='text', text=f'Calculation result: {result}')]
    elif name == 'text_analyzer':
        text = arguments.get('text', '')
        words = len(text.split())
        chars = len(text)
        return [types.TextContent(type='text', text=f'Analysis: {words} words, {chars} characters')]
    elif name == 'data_processor':
        data = arguments.get('data', [])
        total = sum(data) if isinstance(data, list) else 0
        avg = total / len(data) if isinstance(data, list) and len(data) > 0 else 0
        return [types.TextContent(type='text', text=f'Processing: sum={total}, avg={avg:.2f}')]
    return [types.TextContent(type='text', text='Tool not found')]

@server.list_resources()
async def list_resources():
    return [
        types.Resource(uri='file://openllmetry_test.txt', name='OpenLLMetry Test File', description='Test resource'),
        types.Resource(uri='file://openllmetry_data.json', name='OpenLLMetry Data', description='JSON data')
    ]

@server.read_resource()
async def read_resource(uri: str):
    if uri == 'file://openllmetry_test.txt':
        return 'OpenLLMetry MCP instrumentation test content for comparison with OpenLIT comprehensive observability.'
    elif uri == 'file://openllmetry_data.json':
        return '{"framework": "OpenLLMetry", "capabilities": ["basic_spans", "limited_attributes"], "limitations": ["no_business_intelligence", "minimal_mcp_awareness"]}'
    return 'Resource not available'

@server.list_prompts()
async def list_prompts():
    return [
        types.Prompt(name='openllmetry_analysis', description='OpenLLMetry analysis prompt'),
        types.Prompt(name='openllmetry_summary', description='OpenLLMetry summary prompt')
    ]

@server.get_prompt()
async def get_prompt(name: str, arguments: dict):
    if name == 'openllmetry_analysis':
        topic = arguments.get('topic', 'general')
        return types.GetPromptResult(
            description=f'OpenLLMetry analysis prompt for {topic}',
            messages=[types.PromptMessage(role='user', content=types.TextContent(type='text', text=f'Analyze this {topic} with OpenLLMetry'))]
        )
    elif name == 'openllmetry_summary':
        return types.GetPromptResult(
            description='OpenLLMetry summary prompt',
            messages=[types.PromptMessage(role='user', content=types.TextContent(type='text', text='Summarize with OpenLLMetry'))]
        )
    raise ValueError(f'Prompt not found: {name}')

async def main():
    async with mcp.server.stdio.stdio_server() as (read, write):
        await server.run(read, write, InitializationOptions(
            server_name='openllmetry-test',
            server_version='1.0.0',
            capabilities=server.get_capabilities(
                notification_options=NotificationOptions(),
                experimental_capabilities={}
            )
        ))

asyncio.run(main())
            """]
        )
        
        print("🚀 Starting OpenLLMetry MCP Operations Test")
        
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                
                # Same operations as other tests
                print("  📋 1. Listing tools...")
                tools = await session.list_tools()
                print(f"    ✅ Found {len(tools.tools)} tools")
                
                print("  🔢 2. Calling calculator tool...")
                calc_result = await session.call_tool("calculator", {"a": 42, "b": 58})
                print(f"    ✅ Calculator result received")
                
                print("  📝 3. Calling text analyzer tool...")
                text_result = await session.call_tool("text_analyzer", {
                    "text": "OpenLLMetry provides basic MCP instrumentation with standard OpenTelemetry spans but lacks OpenLIT's advanced business intelligence and MCP-specific observability."
                })
                print(f"    ✅ Text analyzer result received")
                
                print("  📊 4. Calling data processor tool...")
                data_result = await session.call_tool("data_processor", {
                    "data": [10, 25, 33, 47, 52, 68, 75, 82, 91, 100]
                })
                print(f"    ✅ Data processor result received")
                
                print("  📚 5. Listing resources...")
                resources = await session.list_resources()
                print(f"    ✅ Found {len(resources.resources)} resources")
                
                print("  📖 6. Reading text resource...")
                text_content = await session.read_resource("file://openllmetry_test.txt")
                print(f"    ✅ Text resource read")
                
                print("  🗂️  7. Reading JSON resource...")
                json_content = await session.read_resource("file://openllmetry_data.json")
                print(f"    ✅ JSON resource read")
                
                print("  💬 8. Listing prompts...")
                prompts = await session.list_prompts()
                print(f"    ✅ Found {len(prompts.prompts)} prompts")
                
                print("  📋 9. Getting analysis prompt...")
                analysis_prompt = await session.get_prompt("openllmetry_analysis", {"topic": "standard_telemetry"})
                print(f"    ✅ Analysis prompt retrieved")
                
                print("  📄 10. Getting summary prompt...")
                summary_prompt = await session.get_prompt("openllmetry_summary", {})
                print(f"    ✅ Summary prompt retrieved")
                
        print("✅ All OpenLLMetry MCP operations completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ OpenLLMetry MCP operations failed: {e}")
        return False


async def main():
    """Main test function for OpenLLMetry MCP instrumentation"""
    print("🧠 OPENLLMETRY MCP INSTRUMENTATION TEST")
    print("=" * 50)
    
    if not REAL_MCP:
        print("❌ MCP SDK not available")
        return
    
    if not OPENLLMETRY_AVAILABLE:
        print("❌ OpenLLMetry MCP instrumentation not available")
        print("ℹ️  Package: opentelemetry-instrumentation-mcp")
        return
    
    if not OTEL_AVAILABLE:
        print("❌ OpenTelemetry not available")
        return
    
    # Set up OpenTelemetry infrastructure
    print("✅ Setting up OpenTelemetry TracerProvider and MeterProvider...")
    
    # Create resource
    resource = Resource.create({
        "service.name": "openllmetry-mcp-test",
        "service.version": "1.0.0"
    })
    
    # Set up tracer provider with console exporter
    tracer_provider = TracerProvider(resource=resource)
    console_exporter = ConsoleSpanExporter()
    span_processor = SimpleSpanProcessor(console_exporter)
    tracer_provider.add_span_processor(span_processor)
    trace.set_tracer_provider(tracer_provider)
    
    # Set up meter provider with console exporter
    metric_reader = PeriodicExportingMetricReader(
        ConsoleMetricExporter(), export_interval_millis=5000
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    metrics.set_meter_provider(meter_provider)
    
    print("✅ OpenTelemetry providers configured")
    
    # Initialize OpenLLMetry
    print("✅ Initializing OpenLLMetry MCP instrumentation...")
    try:
        instrumentor = McpInstrumentor()
        instrumentor.instrument()
        print("✅ OpenLLMetry instrumentation active")
    except Exception as e:
        print(f"❌ Failed to initialize OpenLLMetry: {e}")
        return
    
    # Run comprehensive MCP operations
    success = await run_mcp_operations()
    
    # Wait for metrics to be exported
    print("⏳ Waiting for metrics export...")
    await asyncio.sleep(2)
    
    # Force metric export
    try:
        meter_provider.force_flush(30000)  # 30 second timeout
    except:
        pass
    
    # Cleanup
    try:
        instrumentor.uninstrument()
    except:
        pass
    
    # Results
    print(f"\n📊 OpenLLMetry MCP Test Results:")
    print(f"  Status: {'✅ SUCCESS' if success else '❌ FAILED'}")
    print(f"  Operations: {'10/10 completed' if success else 'Failed during execution'}")
    print(f"  Instrumentation: {'✅ Active' if success else '❌ Inactive'}")
    
    if success:
        print(f"\n📈 OpenLLMetry MCP Analysis:")
        print(f"  📊 Check spans output above for actual telemetry captured")
        print(f"  ✅ Basic span generation expected")
        print(f"  ⚠️  Limited attribute capture vs OpenLIT")
        print(f"  ⚠️  Standard OpenTelemetry conventions only")
        print(f"  ⚠️  No business intelligence like OpenLIT")
        print(f"  ⚠️  No mcp.* namespace like OpenLIT")
        print(f"  ⚠️  No performance or cost tracking")
        
        print(f"\n💡 Spans Generated:")
        print(f"  • Check console output above for actual spans")
        print(f"  • Compare span count and attributes vs OpenLIT")
        print(f"  • Look for gen_ai.* vs mcp.* attributes")
        print(f"  • Standard OpenTelemetry format expected")
    else:
        print(f"\n❌ OpenLLMetry MCP instrumentation did not work")


if __name__ == "__main__":
    asyncio.run(main())
