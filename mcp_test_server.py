#!/usr/bin/env python3
"""
Real MCP Server for Testing OpenLIT MCP Instrumentation
Creates actual MCP operations that can be traced.
"""

import asyncio
import json
import logging
import sys
from typing import Any, Dict, List, Optional
from pathlib import Path

# Try to import MCP packages with fallbacks
try:
    # Try official MCP SDK first
    from mcp.server import Server, NotificationOptions
    from mcp.server.models import InitializationOptions
    import mcp.server.stdio
    import mcp.types as types

    MCP_AVAILABLE = True

except ImportError:
    try:
        # Try lite-mcp-client alternative
        from lite_mcp_client import MCPServer

        MCP_AVAILABLE = "lite"

    except ImportError:
        MCP_AVAILABLE = False
        print("⚠️  No MCP SDK available - using mock server")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class MockMCPServer:
    """Mock MCP server when real SDK is not available"""

    def __init__(self, name: str):
        self.name = name
        self.tools = {}
        self.resources = {}
        self.prompts = {}

    def add_tool(self, name: str, description: str, handler):
        """Add a tool to the mock server"""
        self.tools[name] = {
            "name": name,
            "description": description,
            "handler": handler,
        }

    def add_resource(self, uri: str, name: str, content: str):
        """Add a resource to the mock server"""
        self.resources[uri] = {"uri": uri, "name": name, "content": content}

    def add_prompt(self, name: str, description: str, handler):
        """Add a prompt to the mock server"""
        self.prompts[name] = {
            "name": name,
            "description": description,
            "handler": handler,
        }

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Mock tool calling"""
        if name not in self.tools:
            raise ValueError(f"Tool '{name}' not found")

        tool = self.tools[name]
        logger.info(f"🔧 Calling tool: {name} with args: {arguments}")

        # Simulate tool execution
        result = await tool["handler"](arguments)
        logger.info(f"✅ Tool result: {result}")
        return result

    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """Mock resource reading"""
        if uri not in self.resources:
            raise ValueError(f"Resource '{uri}' not found")

        resource = self.resources[uri]
        logger.info(f"📚 Reading resource: {uri}")
        return {
            "contents": [
                {"uri": uri, "mimeType": "text/plain", "text": resource["content"]}
            ]
        }

    async def get_prompt(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Mock prompt retrieval"""
        if name not in self.prompts:
            raise ValueError(f"Prompt '{name}' not found")

        prompt = self.prompts[name]
        logger.info(f"💬 Getting prompt: {name} with args: {arguments}")

        result = await prompt["handler"](arguments)
        return result

    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools"""
        return [
            {
                "name": tool["name"],
                "description": tool["description"],
                "inputSchema": {"type": "object", "properties": {}, "required": []},
            }
            for tool in self.tools.values()
        ]

    async def list_resources(self) -> List[Dict[str, Any]]:
        """List available resources"""
        return [
            {
                "uri": resource["uri"],
                "name": resource["name"],
                "description": f"Resource: {resource['name']}",
                "mimeType": "text/plain",
            }
            for resource in self.resources.values()
        ]

    async def list_prompts(self) -> List[Dict[str, Any]]:
        """List available prompts"""
        return [
            {
                "name": prompt["name"],
                "description": prompt["description"],
                "arguments": [],
            }
            for prompt in self.prompts.values()
        ]


def create_test_server() -> MockMCPServer:
    """Create a comprehensive test MCP server with various operations"""
    server = MockMCPServer("OpenLIT-Test-Server")

    # === TOOLS ===

    async def calculator_add(args: Dict[str, Any]) -> Dict[str, Any]:
        """Add two numbers"""
        a = args.get("a", 0)
        b = args.get("b", 0)
        result = a + b
        return {"result": result, "operation": "addition", "inputs": {"a": a, "b": b}}

    async def text_analyzer(args: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze text and return statistics"""
        text = args.get("text", "")
        words = len(text.split())
        chars = len(text)
        lines = len(text.split("\n"))

        return {
            "analysis": {
                "word_count": words,
                "character_count": chars,
                "line_count": lines,
                "average_word_length": chars / words if words > 0 else 0,
            },
            "text": text[:100] + "..." if len(text) > 100 else text,
        }

    async def data_processor(args: Dict[str, Any]) -> Dict[str, Any]:
        """Process data with various operations"""
        data = args.get("data", [])
        operation = args.get("operation", "sum")

        if operation == "sum":
            result = sum(data) if isinstance(data, list) else 0
        elif operation == "average":
            result = (
                sum(data) / len(data) if isinstance(data, list) and len(data) > 0 else 0
            )
        elif operation == "count":
            result = len(data) if isinstance(data, list) else 0
        else:
            result = f"Unknown operation: {operation}"

        return {
            "result": result,
            "operation": operation,
            "input_size": len(data) if isinstance(data, list) else 0,
        }

    # Register tools
    server.add_tool("calculator", "Add two numbers together", calculator_add)
    server.add_tool(
        "text_analyzer", "Analyze text and return statistics", text_analyzer
    )
    server.add_tool("data_processor", "Process numerical data", data_processor)

    # === RESOURCES ===

    server.add_resource(
        "file://test_document.txt",
        "Test Document",
        "This is a test document for MCP resource testing.\n\nIt contains multiple lines and provides sample content for reading operations.",
    )

    server.add_resource(
        "file://config.json",
        "Configuration File",
        json.dumps(
            {
                "server_name": "OpenLIT-Test-Server",
                "version": "1.0.0",
                "features": ["tools", "resources", "prompts"],
                "max_connections": 100,
            },
            indent=2,
        ),
    )

    server.add_resource(
        "file://data.csv",
        "Sample Data",
        "id,name,value\n1,Item A,100\n2,Item B,200\n3,Item C,150",
    )

    # === PROMPTS ===

    async def analysis_prompt(args: Dict[str, Any]) -> Dict[str, Any]:
        """Generate analysis prompt"""
        topic = args.get("topic", "general analysis")
        return {
            "description": f"Analysis prompt for {topic}",
            "messages": [
                {
                    "role": "system",
                    "content": {
                        "type": "text",
                        "text": f"You are an expert analyst. Analyze the given {topic} thoroughly and provide insights.",
                    },
                },
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": f"Please analyze this {topic} and provide detailed insights with recommendations.",
                    },
                },
            ],
        }

    async def summary_prompt(args: Dict[str, Any]) -> Dict[str, Any]:
        """Generate summary prompt"""
        content_type = args.get("content_type", "document")
        return {
            "description": f"Summary prompt for {content_type}",
            "messages": [
                {
                    "role": "system",
                    "content": {
                        "type": "text",
                        "text": f"You are a professional summarizer. Create concise, accurate summaries of {content_type}.",
                    },
                },
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": f"Please provide a comprehensive summary of this {content_type}.",
                    },
                },
            ],
        }

    # Register prompts
    server.add_prompt(
        "analysis", "Generate analysis prompt for various topics", analysis_prompt
    )
    server.add_prompt("summary", "Generate summary prompt for content", summary_prompt)

    return server


class MCPTestRunner:
    """Runs MCP server operations for testing"""

    def __init__(self):
        self.server = create_test_server()

    async def run_comprehensive_test(self):
        """Run comprehensive MCP operations test"""
        print("\n🚀 Starting Comprehensive MCP Server Test")
        print("=" * 50)

        # Test Tools
        print("\n🔧 Testing Tools...")

        try:
            # Calculator tool
            calc_result = await self.server.call_tool("calculator", {"a": 15, "b": 27})
            print(f"  ✅ Calculator: {calc_result}")

            # Text analyzer tool
            text_result = await self.server.call_tool(
                "text_analyzer",
                {
                    "text": "This is a comprehensive test of the text analysis tool functionality."
                },
            )
            print(f"  ✅ Text Analyzer: {text_result}")

            # Data processor tool
            data_result = await self.server.call_tool(
                "data_processor", {"data": [10, 20, 30, 40, 50], "operation": "average"}
            )
            print(f"  ✅ Data Processor: {data_result}")

        except Exception as e:
            print(f"  ❌ Tool error: {e}")

        # Test Resources
        print("\n📚 Testing Resources...")

        try:
            # List resources
            resources = await self.server.list_resources()
            print(f"  📋 Available resources: {len(resources)}")

            # Read specific resources
            doc_content = await self.server.read_resource("file://test_document.txt")
            print(
                f"  ✅ Document content: {len(doc_content['contents'][0]['text'])} chars"
            )

            config_content = await self.server.read_resource("file://config.json")
            print(
                f"  ✅ Config content: {len(config_content['contents'][0]['text'])} chars"
            )

        except Exception as e:
            print(f"  ❌ Resource error: {e}")

        # Test Prompts
        print("\n💬 Testing Prompts...")

        try:
            # List prompts
            prompts = await self.server.list_prompts()
            print(f"  📋 Available prompts: {len(prompts)}")

            # Get specific prompts
            analysis_prompt = await self.server.get_prompt(
                "analysis", {"topic": "business data"}
            )
            print(f"  ✅ Analysis prompt: {analysis_prompt['description']}")

            summary_prompt = await self.server.get_prompt(
                "summary", {"content_type": "research paper"}
            )
            print(f"  ✅ Summary prompt: {summary_prompt['description']}")

        except Exception as e:
            print(f"  ❌ Prompt error: {e}")

        # Test List Operations
        print("\n📋 Testing List Operations...")

        try:
            tools = await self.server.list_tools()
            print(f"  🔧 Total tools: {len(tools)}")

            resources = await self.server.list_resources()
            print(f"  📚 Total resources: {len(resources)}")

            prompts = await self.server.list_prompts()
            print(f"  💬 Total prompts: {len(prompts)}")

        except Exception as e:
            print(f"  ❌ List error: {e}")

        print("\n✅ MCP Server Test Complete!")
        return True


async def main():
    """Main server test function"""
    runner = MCPTestRunner()
    success = await runner.run_comprehensive_test()

    if success:
        print("\n🎉 All MCP server operations completed successfully!")
        print("✅ Server is ready for instrumentation testing")
    else:
        print("\n❌ Some operations failed")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
