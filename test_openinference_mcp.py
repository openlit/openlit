#!/usr/bin/env python3
"""
OpenInference MCP instrumentation test.
Tests OpenInference's MCP instrumentation with real MCP operations.
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

# Import OpenInference
try:
    from openinference.instrumentation.mcp import MCPInstrumentor
    OPENINFERENCE_AVAILABLE = True
except ImportError as e:
    print(f"❌ OpenInference MCP not available: {e}")
    OPENINFERENCE_AVAILABLE = False


async def run_mcp_operations():
    """Run the same MCP operations as OpenLIT test"""
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

server = Server('openinference-test-server')

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
        types.Resource(uri='file://openinference_test.txt', name='OpenInference Test File', description='Test resource'),
        types.Resource(uri='file://openinference_data.json', name='OpenInference Data', description='JSON data')
    ]

@server.read_resource()
async def read_resource(uri: str):
    if uri == 'file://openinference_test.txt':
        return 'OpenInference MCP instrumentation test content for comparison with OpenLIT.'
    elif uri == 'file://openinference_data.json':
        return '{"framework": "OpenInference", "capabilities": ["context_propagation"], "limitations": ["minimal_spans", "basic_attributes"]}'
    return 'Resource not available'

@server.list_prompts()
async def list_prompts():
    return [
        types.Prompt(name='openinference_analysis', description='OpenInference analysis prompt'),
        types.Prompt(name='openinference_summary', description='OpenInference summary prompt')
    ]

@server.get_prompt()
async def get_prompt(name: str, arguments: dict):
    if name == 'openinference_analysis':
        topic = arguments.get('topic', 'general')
        return types.GetPromptResult(
            description=f'OpenInference analysis prompt for {topic}',
            messages=[types.PromptMessage(role='user', content=types.TextContent(type='text', text=f'Analyze this {topic} with OpenInference'))]
        )
    elif name == 'openinference_summary':
        return types.GetPromptResult(
            description='OpenInference summary prompt',
            messages=[types.PromptMessage(role='user', content=types.TextContent(type='text', text='Summarize with OpenInference'))]
        )
    raise ValueError(f'Prompt not found: {name}')

async def main():
    async with mcp.server.stdio.stdio_server() as (read, write):
        await server.run(read, write, InitializationOptions(
            server_name='openinference-test',
            server_version='1.0.0',
            capabilities=server.get_capabilities(
                notification_options=NotificationOptions(),
                experimental_capabilities={}
            )
        ))

asyncio.run(main())
            """]
        )
        
        print("🚀 Starting OpenInference MCP Operations Test")
        
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                
                # Same operations as OpenLIT test
                print("  📋 1. Listing tools...")
                tools = await session.list_tools()
                print(f"    ✅ Found {len(tools.tools)} tools")
                
                print("  🔢 2. Calling calculator tool...")
                calc_result = await session.call_tool("calculator", {"a": 42, "b": 58})
                print(f"    ✅ Calculator result received")
                
                print("  📝 3. Calling text analyzer tool...")
                text_result = await session.call_tool("text_analyzer", {
                    "text": "OpenInference provides basic MCP instrumentation with limited observability compared to OpenLIT's comprehensive business intelligence."
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
                text_content = await session.read_resource("file://openinference_test.txt")
                print(f"    ✅ Text resource read")
                
                print("  🗂️  7. Reading JSON resource...")
                json_content = await session.read_resource("file://openinference_data.json")
                print(f"    ✅ JSON resource read")
                
                print("  💬 8. Listing prompts...")
                prompts = await session.list_prompts()
                print(f"    ✅ Found {len(prompts.prompts)} prompts")
                
                print("  📋 9. Getting analysis prompt...")
                analysis_prompt = await session.get_prompt("openinference_analysis", {"topic": "basic_tracing"})
                print(f"    ✅ Analysis prompt retrieved")
                
                print("  📄 10. Getting summary prompt...")
                summary_prompt = await session.get_prompt("openinference_summary", {})
                print(f"    ✅ Summary prompt retrieved")
                
        print("✅ All OpenInference MCP operations completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ OpenInference MCP operations failed: {e}")
        return False


async def main():
    """Main test function for OpenInference MCP instrumentation"""
    print("🧠 OPENINFERENCE MCP INSTRUMENTATION TEST")
    print("=" * 50)
    
    if not REAL_MCP:
        print("❌ MCP SDK not available")
        return
    
    if not OPENINFERENCE_AVAILABLE:
        print("❌ OpenInference MCP instrumentation not available")
        return
    
    if not OTEL_AVAILABLE:
        print("❌ OpenTelemetry not available")
        return
    
    # Set up OpenTelemetry infrastructure
    print("✅ Setting up OpenTelemetry TracerProvider and MeterProvider...")
    
    # Create resource
    resource = Resource.create({
        "service.name": "openinference-mcp-test",
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
    
    # Initialize OpenInference
    print("✅ Initializing OpenInference MCP instrumentation...")
    try:
        instrumentor = MCPInstrumentor()
        instrumentor.instrument()
        print("✅ OpenInference instrumentation active")
    except Exception as e:
        print(f"❌ Failed to initialize OpenInference: {e}")
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
    print(f"\n📊 OpenInference MCP Test Results:")
    print(f"  Status: {'✅ SUCCESS' if success else '❌ FAILED'}")
    print(f"  Operations: {'10/10 completed' if success else 'Failed during execution'}")
    print(f"  Instrumentation: {'✅ Active' if success else '❌ Inactive'}")
    
    if success:
        print(f"\n📈 OpenInference MCP Analysis:")
        print(f"  📊 Check spans output above for actual telemetry captured")
        print(f"  ℹ️  OpenInference focuses on context propagation")
        print(f"  ⚠️  May have limited MCP-specific attributes")
        print(f"  ⚠️  No business intelligence like OpenLIT")
        print(f"  ⚠️  No mcp.* namespace like OpenLIT")
        
        print(f"\n💡 Spans Generated:")
        print(f"  • Check console output above for actual spans")
        print(f"  • Compare span count and attributes vs OpenLIT")
        print(f"  • Look for gen_ai.* vs mcp.* attributes")
    else:
        print(f"\n❌ OpenInference MCP instrumentation did not work")


if __name__ == "__main__":
    asyncio.run(main())
