#!/usr/bin/env python3
"""
Debug MCP server issue
"""

import sys
import asyncio

sys.path.insert(0, "sdk/python/src")
import openlit

# Import real MCP components
try:
    from mcp.server import Server, NotificationOptions
    from mcp.server.models import InitializationOptions
    import mcp.server.stdio
    import mcp.types as types
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    REAL_MCP = True
    print("✅ MCP SDK imported successfully")
except ImportError as e:
    print(f"❌ MCP SDK not available: {e}")
    REAL_MCP = False


async def debug_simple_server():
    """Test the simplest possible MCP server"""
    if not REAL_MCP:
        return False
    
    print("🔧 Testing simple MCP server creation...")
    
    try:
        # Create a very simple server script
        simple_server = """
import asyncio
from mcp.server import Server, NotificationOptions
from mcp.server.models import InitializationOptions
import mcp.server.stdio
import mcp.types as types

async def main():
    try:
        server = Server('debug-server')
        
        @server.list_tools()
        async def list_tools():
            return [types.Tool(name='test', description='Test tool', inputSchema={"type": "object"})]
        
        async with mcp.server.stdio.stdio_server() as (read, write):
            print("Server starting...", flush=True)
            await server.run(read, write, InitializationOptions(
                server_name='debug-server',
                server_version='1.0.0',
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={}
                )
            ))
    except Exception as e:
        print(f"Server error: {e}", flush=True)
        raise

if __name__ == "__main__":
    asyncio.run(main())
"""
        
        server_params = StdioServerParameters(
            command="python",
            args=["-c", simple_server]
        )
        
        print("🚀 Starting simple server...")
        
        async with stdio_client(server_params) as (read, write):
            print("✅ Client connected")
            async with ClientSession(read, write) as session:
                print("✅ Session created")
                await session.initialize()
                print("✅ Session initialized")
                
                tools = await session.list_tools()
                print(f"✅ Tools retrieved: {len(tools.tools) if hasattr(tools, 'tools') else 1}")
                
        print("✅ Simple MCP server test successful!")
        return True
        
    except Exception as e:
        print(f"❌ Simple MCP server test failed: {type(e).__name__}: {e}")
        import traceback
        print("Full traceback:")
        traceback.print_exc()
        return False


async def main():
    """Debug MCP setup"""
    print("🔧 DEBUG MCP SETUP")
    print("=" * 30)
    
    # Initialize OpenLIT
    openlit.init()
    
    # Test simple server
    success = await debug_simple_server()
    
    print(f"\n📊 Debug Results:")
    print(f"  Simple Server: {'✅ Working' if success else '❌ Failed'}")


if __name__ == "__main__":
    asyncio.run(main())
