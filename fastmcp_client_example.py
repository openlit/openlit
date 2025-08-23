#!/usr/bin/env python3
"""
FastMCP Client Example - Testing Enhanced OpenLIT MCP Instrumentation

This client connects to our FastMCP server to demonstrate:
1. All new FastMCP framework instrumentation in action
2. Enhanced attribute collection across operations
3. Manager-level business intelligence capture
4. Performance & reliability metric generation

The client is NOT instrumented (simulates external apps like Claude Desktop).
Only the FastMCP server generates comprehensive telemetry spans.
"""

import asyncio
import sys
import logging
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.session import ClientSession

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fastmcp-client")

async def test_fastmcp_server():
    """Test our enhanced FastMCP server instrumentation."""
    
    logger.info("🚀 FastMCP Client Demo Starting...")
    logger.info("🎯 This client is NOT instrumented (simulates external apps)")
    logger.info("📡 Only the FastMCP server generates enhanced telemetry spans")
    logger.info("🔌 Starting FastMCP Client to connect to instrumented server...")
    
    # Define server parameters to spawn our FastMCP example
    server_params = StdioServerParameters(
        command=sys.executable,
        args=["fastmcp_server_example.py"]
    )
    
    try:
        # Connect to FastMCP server (this will trigger server.run() instrumentation)
        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                logger.info("🔗 Connected to Enhanced FastMCP server")
                
                # Initialize session (triggers initialize instrumentation)
                logger.info("\n=== Test 1: Initialize Session ===")
                init_result = await session.initialize()
                logger.info(f"✅ Server initialized: {init_result.serverInfo.name}")
                logger.info(f"📋 Protocol version: {init_result.protocolVersion}")
                
                # List tools (triggers FastMCP list_tools + manager instrumentation)
                logger.info("\n=== Test 2: List Tools (FastMCP + Manager Intelligence) ===")
                tools_result = await session.list_tools()
                logger.info(f"🔧 Available tools: {len(tools_result.tools)}")
                for tool in tools_result.tools:
                    logger.info(f"   - {tool.name}: {tool.description}")
                
                # Call calculator tool (triggers FastMCP call_tool + performance tracking)
                logger.info("\n=== Test 3: Call Calculator Tool (Performance Tracking) ===")
                calc_result = await session.call_tool("calculate", {"expression": "2 + 2 * 3"})
                if not calc_result.isError:
                    logger.info("✅ Calculator tool executed successfully")
                    if calc_result.content:
                        logger.info(f"📊 Result: {calc_result.content[0].text if calc_result.content else 'N/A'}")
                else:
                    logger.error("❌ Calculator tool failed")
                
                # Call weather tool (triggers more FastMCP tool instrumentation)  
                logger.info("\n=== Test 4: Call Weather Tool (Enhanced Attributes) ===")
                weather_result = await session.call_tool("get_weather", {"city": "San Francisco", "units": "celsius"})
                if not weather_result.isError:
                    logger.info("✅ Weather tool executed successfully")
                else:
                    logger.error("❌ Weather tool failed")
                
                # List resources (triggers FastMCP resource manager instrumentation)
                logger.info("\n=== Test 5: List Resources (Manager Intelligence) ===") 
                resources_result = await session.list_resources()
                logger.info(f"📄 Available resources: {len(resources_result.resources)}")
                for resource in resources_result.resources:
                    logger.info(f"   - {resource.uri}: {resource.description}")
                
                # Read resource (triggers FastMCP read_resource + performance tracking)
                logger.info("\n=== Test 6: Read Resource (Performance Metrics) ===")
                if resources_result.resources:
                    resource_uri = resources_result.resources[0].uri
                    read_result = await session.read_resource(resource_uri)
                    logger.info("✅ Resource read successfully")
                    logger.info(f"📊 Content type: {read_result.contents[0].mimeType if read_result.contents else 'N/A'}")
                
                # List prompts (triggers FastMCP prompt manager instrumentation)
                logger.info("\n=== Test 7: List Prompts (Manager Intelligence) ===")
                prompts_result = await session.list_prompts()
                logger.info(f"📝 Available prompts: {len(prompts_result.prompts)}")
                for prompt in prompts_result.prompts:
                    logger.info(f"   - {prompt.name}: {prompt.description}")
                
                # Get prompt (triggers FastMCP get_prompt + performance tracking)
                logger.info("\n=== Test 8: Get Prompt (Performance Tracking) ===")
                if prompts_result.prompts:
                    prompt_name = prompts_result.prompts[0].name
                    prompt_result = await session.get_prompt(prompt_name, {"data_type": "financial"})
                    logger.info("✅ Prompt retrieved successfully")
                    logger.info(f"📊 Messages: {len(prompt_result.messages)}")
                
                logger.info("\n🎉 All FastMCP operations completed!")
                logger.info("📊 Enhanced telemetry should include:")
                logger.info("   ✅ FastMCP framework attributes (67+ new attributes)")
                logger.info("   ✅ Manager-level business intelligence")
                logger.info("   ✅ Performance & reliability metrics")  
                logger.info("   ✅ Tool/Resource/Prompt metadata & annotations")
                logger.info("   ✅ Simplified operation names (tools_call, resources_read, etc.)")
                logger.info("   ✅ Enhanced span names (mcp fastmcp/run, mcp managers/tool, etc.)")
                
    except Exception as e:
        # Common exceptions during MCP stdio transport cleanup
        if "TaskGroup" in str(e) or "CancelledError" in str(e):
            logger.info("ℹ️  FastMCP server subprocess terminated (expected behavior)")
        else:
            logger.error(f"❌ FastMCP client error: {e}")
    
    logger.info("\n⏳ Waiting for server telemetry to flush...")
    await asyncio.sleep(3)
    logger.info("✅ FastMCP enhanced instrumentation demo completed!")


def main():
    """Run the FastMCP client demo."""
    asyncio.run(test_fastmcp_server())


if __name__ == "__main__":
    main()
