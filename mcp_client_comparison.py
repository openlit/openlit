#!/usr/bin/env python3
"""
MCP Client for comparing OpenLIT vs OpenLLMetry instrumentation.
This client can connect to either server to demonstrate telemetry differences.
"""

import asyncio
import logging
import sys
import time

from mcp.client.session import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-comparison-client")


async def test_server(server_script: str, server_name: str):
    """Test a specific MCP server implementation."""
    logger.info(f"🔌 Testing {server_name} Server...")
    logger.info(f"📄 Using server script: {server_script}")

    # Configure server connection
    server_params = StdioServerParameters(command=sys.executable, args=[server_script])

    try:
        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                logger.info(f"🔗 Connected to {server_name} MCP server")

                # Test 1: Initialize session
                logger.info(f"\n=== {server_name}: Initialize Session ===")
                init_result = await session.initialize()
                logger.info(f"✅ Server: {init_result.serverInfo.name}")
                logger.info(f"📋 Protocol: {init_result.protocolVersion}")

                await asyncio.sleep(0.5)

                # Test 2: List tools
                logger.info(f"\n=== {server_name}: List Tools ===")
                tools_result = await session.list_tools()
                logger.info(f"🔧 Found {len(tools_result.tools)} tools:")
                for tool in tools_result.tools:
                    logger.info(f"   - {tool.name}: {tool.description}")

                await asyncio.sleep(0.5)

                # Test 3: Call calculator tool
                logger.info(f"\n=== {server_name}: Calculator Tool ===")
                calc_result = await session.call_tool(
                    name="calculator",
                    arguments={"operation": "multiply", "a": 25, "b": 3},
                )
                logger.info(f"🧮 Result: {calc_result.content[0].text}")

                await asyncio.sleep(0.5)

                # Test 4: Call echo tool
                logger.info(f"\n=== {server_name}: Echo Tool ===")
                echo_result = await session.call_tool(
                    name="echo",
                    arguments={"message": f"Hello from {server_name} comparison test!"},
                )
                logger.info(f"📢 Result: {echo_result.content[0].text}")

                await asyncio.sleep(0.5)

                # Test 5: List resources
                logger.info(f"\n=== {server_name}: List Resources ===")
                resources_result = await session.list_resources()
                logger.info(f"📚 Found {len(resources_result.resources)} resources:")
                for resource in resources_result.resources:
                    logger.info(f"   - {resource.uri}: {resource.name}")

                await asyncio.sleep(0.5)

                # Test 6: Read resource
                logger.info(f"\n=== {server_name}: Read Resource ===")
                if resources_result.resources:
                    resource_uri = resources_result.resources[0].uri
                    read_result = await session.read_resource(uri=resource_uri)
                    content_preview = read_result.contents[0].text[:80] + "..."
                    logger.info(f"📖 Content: {content_preview}")

                logger.info(f"\n🎉 {server_name} testing completed successfully!")

    except Exception as e:
        logger.error(f"❌ {server_name} test failed: {e}")


async def main():
    """Main comparison testing entry point."""
    logger.info("🔬 MCP Instrumentation Comparison Test")
    logger.info("🎯 Comparing OpenLIT vs OpenLLMetry MCP instrumentation")
    logger.info("📊 Both send telemetry to same OpenLIT instance for comparison")

    # Test 1: OpenLIT instrumented server
    logger.info("\n" + "=" * 60)
    logger.info("🟦 TESTING OPENLIT MCP INSTRUMENTATION")
    logger.info("=" * 60)

    await test_server("mcp_server.py", "OpenLIT")

    # Wait between tests
    logger.info("\n⏳ Pausing between tests...")
    await asyncio.sleep(2)

    # Test 2: OpenLLMetry instrumented server
    logger.info("\n" + "=" * 60)
    logger.info("🟨 TESTING OPENLLMETRY MCP INSTRUMENTATION")
    logger.info("=" * 60)

    await test_server("mcp_server_openllmetry.py", "OpenLLMetry")

    # Final summary
    logger.info("\n" + "=" * 60)
    logger.info("🏆 COMPARISON TESTING COMPLETED")
    logger.info("=" * 60)
    logger.info("📊 Check your OpenLIT dashboard to compare:")
    logger.info("   🟦 Service: mcp-server-demo (OpenLIT)")
    logger.info("   🟨 Service: mcp-server-openllmetry (OpenLLMetry)")
    logger.info("🔍 Compare span attributes, operation names, and telemetry depth")
    logger.info("⏳ Waiting for final telemetry flush...")

    await asyncio.sleep(3)
    logger.info("✅ Comparison test completed!")


if __name__ == "__main__":
    asyncio.run(main())
