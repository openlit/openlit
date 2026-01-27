#!/usr/bin/env python3
"""
Sample LangGraph Application for Testing OpenLIT Instrumentation

This sample demonstrates and tests the LangGraph instrumentation including:
- Graph construction (StateGraph, add_node, add_edge, compile)
- Sync execution (invoke, stream)
- Async execution (ainvoke, astream)
- Multi-node graphs with per-node tracing
- LLM node with token extraction (optional, requires OPENAI_API_KEY)

Usage:
    # Basic test (no API key required)
    python sample_langgraph_app.py

    # With LLM testing (requires OPENAI_API_KEY)
    OPENAI_API_KEY=your_key python sample_langgraph_app.py --with-llm

Environment:
    - OPENAI_API_KEY: Optional, for LLM node testing
"""

import os
import sys
import asyncio
from typing import Annotated, TypedDict

# Initialize OpenLIT first (before importing langgraph)
import openlit

openlit.init(
    environment="langgraph-testing",
    application_name="langgraph-sample-app",
    capture_message_content=True,  # Capture message content for debugging
)

print("=" * 60)
print("OpenLIT LangGraph Instrumentation Sample App")
print("=" * 60)

# Now import LangGraph
try:
    from langgraph.graph import StateGraph, START, END
    from langgraph.graph.message import add_messages
    print("[OK] LangGraph imported successfully")
except ImportError as e:
    print(f"[ERROR] Failed to import LangGraph: {e}")
    print("Please install langgraph: pip install langgraph")
    sys.exit(1)


# ============================================================================
# State Definition
# ============================================================================

class AgentState(TypedDict):
    """State for the agent graph with messages."""
    messages: Annotated[list, add_messages]


# ============================================================================
# Node Functions
# ============================================================================

def echo_node(state: AgentState) -> dict:
    """Simple node that echoes the last message."""
    messages = state.get("messages", [])
    last_content = ""
    if messages:
        last_msg = messages[-1]
        if hasattr(last_msg, "content"):
            last_content = last_msg.content
        elif isinstance(last_msg, dict):
            last_content = last_msg.get("content", "")
    
    return {
        "messages": [{
            "role": "assistant",
            "content": f"Echo: {last_content}"
        }]
    }


def process_node(state: AgentState) -> dict:
    """Processing node that transforms the message."""
    messages = state.get("messages", [])
    msg_count = len(messages)
    
    return {
        "messages": [{
            "role": "assistant",
            "content": f"Processed {msg_count} messages"
        }]
    }


def final_node(state: AgentState) -> dict:
    """Final node that summarizes."""
    messages = state.get("messages", [])
    
    return {
        "messages": [{
            "role": "assistant",
            "content": f"Final response after {len(messages)} messages in conversation"
        }]
    }


async def async_echo_node(state: AgentState) -> dict:
    """Async version of echo node."""
    await asyncio.sleep(0.1)  # Simulate async work
    messages = state.get("messages", [])
    last_content = ""
    if messages:
        last_msg = messages[-1]
        if hasattr(last_msg, "content"):
            last_content = last_msg.content
        elif isinstance(last_msg, dict):
            last_content = last_msg.get("content", "")
    
    return {
        "messages": [{
            "role": "assistant",
            "content": f"Async Echo: {last_content}"
        }]
    }


async def async_process_node(state: AgentState) -> dict:
    """Async processing node."""
    await asyncio.sleep(0.1)  # Simulate async work
    messages = state.get("messages", [])
    
    return {
        "messages": [{
            "role": "assistant",
            "content": f"Async processed {len(messages)} messages"
        }]
    }


# ============================================================================
# LLM Node (Optional - requires OPENAI_API_KEY)
# ============================================================================

def create_llm_node():
    """Create an LLM node if OpenAI is available."""
    try:
        from langchain_openai import ChatOpenAI
        
        if not os.environ.get("OPENAI_API_KEY"):
            return None
        
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        
        def llm_node(state: AgentState) -> dict:
            """Node that calls an LLM."""
            messages = state.get("messages", [])
            
            # Convert to LangChain messages
            from langchain_core.messages import HumanMessage, AIMessage
            lc_messages = []
            for msg in messages:
                if hasattr(msg, "content"):
                    if hasattr(msg, "type") and msg.type == "human":
                        lc_messages.append(HumanMessage(content=msg.content))
                    else:
                        lc_messages.append(AIMessage(content=msg.content))
                elif isinstance(msg, dict):
                    role = msg.get("role", "user")
                    content = msg.get("content", "")
                    if role in ("user", "human"):
                        lc_messages.append(HumanMessage(content=content))
                    else:
                        lc_messages.append(AIMessage(content=content))
            
            # Call LLM
            response = llm.invoke(lc_messages)
            
            return {
                "messages": [response]
            }
        
        print("[OK] LLM node created with OpenAI")
        return llm_node
    
    except ImportError:
        print("[INFO] langchain_openai not installed, skipping LLM node")
        return None
    except Exception as e:
        print(f"[INFO] Could not create LLM node: {e}")
        return None


# ============================================================================
# Test Functions
# ============================================================================

def test_simple_graph():
    """Test a simple single-node graph."""
    print("\n" + "-" * 40)
    print("Test 1: Simple Graph (invoke)")
    print("-" * 40)
    
    # Build graph
    graph = StateGraph(AgentState)
    graph.add_node("echo", echo_node)
    graph.add_edge(START, "echo")
    graph.add_edge("echo", END)
    
    # Compile
    compiled = graph.compile()
    print(f"[OK] Graph compiled with nodes: {list(graph.nodes.keys())}")
    
    # Invoke
    result = compiled.invoke({
        "messages": [{"role": "user", "content": "Hello, LangGraph!"}]
    })
    
    print(f"[OK] Result messages: {len(result['messages'])}")
    if result["messages"]:
        last_msg = result["messages"][-1]
        content = last_msg.content if hasattr(last_msg, "content") else last_msg.get("content", "")
        print(f"[OK] Last message: {content[:100]}")
    
    return True


def test_multi_node_graph():
    """Test a multi-node graph."""
    print("\n" + "-" * 40)
    print("Test 2: Multi-Node Graph (invoke)")
    print("-" * 40)
    
    # Build graph with multiple nodes
    graph = StateGraph(AgentState)
    graph.add_node("echo", echo_node)
    graph.add_node("process", process_node)
    graph.add_node("final", final_node)
    
    # Linear flow: START -> echo -> process -> final -> END
    graph.add_edge(START, "echo")
    graph.add_edge("echo", "process")
    graph.add_edge("process", "final")
    graph.add_edge("final", END)
    
    # Compile
    compiled = graph.compile()
    print(f"[OK] Graph compiled with nodes: {list(graph.nodes.keys())}")
    
    # Invoke
    result = compiled.invoke({
        "messages": [{"role": "user", "content": "Test multi-node flow"}]
    })
    
    print(f"[OK] Result messages: {len(result['messages'])}")
    for i, msg in enumerate(result["messages"]):
        content = msg.content if hasattr(msg, "content") else msg.get("content", "")
        print(f"    Message {i}: {content[:50]}...")
    
    return True


def test_streaming():
    """Test streaming execution."""
    print("\n" + "-" * 40)
    print("Test 3: Streaming Graph")
    print("-" * 40)
    
    # Build graph
    graph = StateGraph(AgentState)
    graph.add_node("echo", echo_node)
    graph.add_node("process", process_node)
    graph.add_edge(START, "echo")
    graph.add_edge("echo", "process")
    graph.add_edge("process", END)
    
    compiled = graph.compile()
    print(f"[OK] Graph compiled")
    
    # Stream
    chunks = []
    for chunk in compiled.stream({
        "messages": [{"role": "user", "content": "Test streaming"}]
    }):
        chunks.append(chunk)
        print(f"    Chunk: {list(chunk.keys())}")
    
    print(f"[OK] Received {len(chunks)} chunks")
    
    return True


async def test_async_invoke():
    """Test async execution."""
    print("\n" + "-" * 40)
    print("Test 4: Async Graph (ainvoke)")
    print("-" * 40)
    
    # Build async graph
    graph = StateGraph(AgentState)
    graph.add_node("async_echo", async_echo_node)
    graph.add_node("async_process", async_process_node)
    graph.add_edge(START, "async_echo")
    graph.add_edge("async_echo", "async_process")
    graph.add_edge("async_process", END)
    
    compiled = graph.compile()
    print(f"[OK] Async graph compiled")
    
    # Async invoke
    result = await compiled.ainvoke({
        "messages": [{"role": "user", "content": "Test async invoke"}]
    })
    
    print(f"[OK] Async result messages: {len(result['messages'])}")
    
    return True


async def test_async_streaming():
    """Test async streaming."""
    print("\n" + "-" * 40)
    print("Test 5: Async Streaming (astream)")
    print("-" * 40)
    
    # Build async graph
    graph = StateGraph(AgentState)
    graph.add_node("async_echo", async_echo_node)
    graph.add_node("async_process", async_process_node)
    graph.add_edge(START, "async_echo")
    graph.add_edge("async_echo", "async_process")
    graph.add_edge("async_process", END)
    
    compiled = graph.compile()
    print(f"[OK] Async graph compiled")
    
    # Async stream
    chunks = []
    async for chunk in compiled.astream({
        "messages": [{"role": "user", "content": "Test async streaming"}]
    }):
        chunks.append(chunk)
        print(f"    Async chunk: {list(chunk.keys())}")
    
    print(f"[OK] Received {len(chunks)} async chunks")
    
    return True


def test_llm_graph(llm_node_func):
    """Test graph with real LLM node."""
    if llm_node_func is None:
        print("\n" + "-" * 40)
        print("Test 6: LLM Graph (SKIPPED - no OPENAI_API_KEY)")
        print("-" * 40)
        return True
    
    print("\n" + "-" * 40)
    print("Test 6: LLM Graph (with OpenAI)")
    print("-" * 40)
    
    # Build graph with LLM
    graph = StateGraph(AgentState)
    graph.add_node("llm", llm_node_func)
    graph.add_edge(START, "llm")
    graph.add_edge("llm", END)
    
    compiled = graph.compile()
    print(f"[OK] LLM graph compiled")
    
    # Invoke with a simple question
    result = compiled.invoke({
        "messages": [{"role": "user", "content": "Say 'test passed' in exactly 2 words."}]
    })
    
    print(f"[OK] LLM result messages: {len(result['messages'])}")
    if result["messages"]:
        last_msg = result["messages"][-1]
        content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)
        print(f"[OK] LLM response: {content[:200]}")
        
        # Check for token usage (should be captured by instrumentation)
        if hasattr(last_msg, "response_metadata"):
            metadata = last_msg.response_metadata
            if "token_usage" in metadata:
                usage = metadata["token_usage"]
                print(f"[OK] Token usage: {usage}")
    
    return True


# ============================================================================
# Main
# ============================================================================

def main():
    """Run all tests."""
    print("\nStarting LangGraph instrumentation tests...\n")
    
    # Check for --with-llm flag
    with_llm = "--with-llm" in sys.argv
    
    # Create LLM node if requested
    llm_node_func = None
    if with_llm:
        llm_node_func = create_llm_node()
    
    # Run sync tests
    results = []
    
    try:
        results.append(("Simple Graph", test_simple_graph()))
    except Exception as e:
        print(f"[ERROR] Simple Graph test failed: {e}")
        results.append(("Simple Graph", False))
    
    try:
        results.append(("Multi-Node Graph", test_multi_node_graph()))
    except Exception as e:
        print(f"[ERROR] Multi-Node Graph test failed: {e}")
        results.append(("Multi-Node Graph", False))
    
    try:
        results.append(("Streaming", test_streaming()))
    except Exception as e:
        print(f"[ERROR] Streaming test failed: {e}")
        results.append(("Streaming", False))
    
    # Run async tests
    async def run_async_tests():
        async_results = []
        try:
            async_results.append(("Async Invoke", await test_async_invoke()))
        except Exception as e:
            print(f"[ERROR] Async Invoke test failed: {e}")
            async_results.append(("Async Invoke", False))
        
        try:
            async_results.append(("Async Streaming", await test_async_streaming()))
        except Exception as e:
            print(f"[ERROR] Async Streaming test failed: {e}")
            async_results.append(("Async Streaming", False))
        
        return async_results
    
    async_results = asyncio.run(run_async_tests())
    results.extend(async_results)
    
    # Run LLM test
    try:
        results.append(("LLM Graph", test_llm_graph(llm_node_func)))
    except Exception as e:
        print(f"[ERROR] LLM Graph test failed: {e}")
        results.append(("LLM Graph", False))
    
    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)
    
    passed = 0
    failed = 0
    for name, success in results:
        status = "PASSED" if success else "FAILED"
        print(f"  {name}: {status}")
        if success:
            passed += 1
        else:
            failed += 1
    
    print(f"\nTotal: {passed} passed, {failed} failed")
    
    print("\n" + "=" * 60)
    print("Instrumentation Verification")
    print("=" * 60)
    print("""
The following telemetry should have been captured:

1. Graph Construction Spans:
   - workflow graph_compile (with nodes/edges attributes)
   
2. Execution Spans:
   - graph_execution graph (for invoke/ainvoke)
   - workflow graph stream (for stream/astream)
   
3. Per-Node Spans:
   - invoke_agent echo
   - invoke_agent process
   - invoke_agent final
   - invoke_agent async_echo
   - invoke_agent async_process
   
4. Semantic Attributes:
   - gen_ai.system = "langgraph"
   - langgraph.graph.nodes
   - langgraph.graph.node_count
   - langgraph.graph.edges
   - langgraph.graph.edge_count
   - langgraph.execution.mode
   - langgraph.graph.executed_nodes
   - langgraph.graph.node_execution_count
   - langgraph.graph.message_count
   - langgraph.graph.total_chunks (streaming)
   - langgraph.graph.final_response
   - langgraph.node.name (per-node)
   - langgraph.graph.status

Check your OpenTelemetry backend or console output for these attributes.
""")
    
    return failed == 0


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
