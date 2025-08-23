#!/usr/bin/env python3
"""
Simple MCP Client (No Instrumentation)
This simulates external clients like Claude Desktop, VS Code, etc.
Only the server should be instrumented since clients are not under developer control.
"""

import asyncio
import logging
import sys
import time

from mcp.client.session import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-client")

async def test_server_operations():
    """Test various MCP operations to trigger server-side instrumentation."""
    logger.info("🔌 Starting MCP Client to connect to server...")
    logger.info("💡 Client will spawn server subprocess (standard MCP pattern)")
    logger.info("🔧 This simulates how VSCode/Claude Desktop connects to MCP servers")
    
    # Configure server connection - this spawns your server as subprocess
    server_params = StdioServerParameters(
        command=sys.executable,
        args=["mcp_server.py"]
    )
    
    try:
        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                logger.info("🔗 Connected to instrumented MCP server")
                
                # Test 1: Initialize session
                logger.info("\n=== Test 1: Initialize Session ===")
                init_result = await session.initialize()
                logger.info(f"✅ Server initialized: {init_result.serverInfo.name}")
                logger.info(f"📋 Protocol version: {init_result.protocolVersion}")
                
                # Test 2: List available tools (this should generate rich response payload)
                logger.info("\n=== Test 2: List Tools ===")
                tools_result = await session.list_tools()
                logger.info(f"🔧 Found {len(tools_result.tools)} tools:")
                for tool in tools_result.tools:
                    logger.info(f"   - {tool.name}: {tool.description}")
                
                # Test 3: Call calculator tool (this should generate rich response payload)
                logger.info("\n=== Test 3: Call Calculator Tool ===")
                calc_result = await session.call_tool(
                    name="calculator",
                    arguments={"operation": "multiply", "a": 15, "b": 4}
                )
                logger.info(f"🧮 Calculator result: {calc_result.content[0].text}")
                
                # Test 4: Call echo tool
                logger.info("\n=== Test 4: Call Echo Tool ===")
                echo_result = await session.call_tool(
                    name="echo",
                    arguments={"message": "Hello from MCP client!"}
                )
                logger.info(f"📢 Echo result: {echo_result.content[0].text}")
                
                logger.info("\n🎉 Core MCP operations completed!")
                logger.info("💡 Only SERVER operations are instrumented (as intended)")
                logger.info("📊 Server spans should contain rich response payloads")
                
    except Exception as e:
        # Common exceptions during MCP stdio transport cleanup
        if "TaskGroup" in str(e) or "CancelledError" in str(e):
            logger.info("ℹ️  MCP server subprocess terminated (expected behavior)")
        else:
            logger.error(f"❌ Client error: {e}")
        # Don't re-raise to allow graceful cleanup

async def main():
    """Main client entry point."""
    try:
        logger.info("🚀 MCP Client Demo Starting...")
        logger.info("🎯 This client is NOT instrumented (simulates external apps)")
        logger.info("📡 Only the server generates telemetry spans")
        
        await test_server_operations()
        
        # Give time for telemetry to be sent
        logger.info("\n⏳ Waiting for server telemetry to flush...")
        await asyncio.sleep(2)
        logger.info("✅ MCP client demo completed!")
        
    except KeyboardInterrupt:
        logger.info("🛑 Client interrupted by user")
    except Exception as e:
        logger.error(f"❌ Client failed: {e}")
        logger.info("💡 This is expected if server shuts down after operations")

if __name__ == "__main__":
    asyncio.run(main())
