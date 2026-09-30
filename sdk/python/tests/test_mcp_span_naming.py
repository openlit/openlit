# pylint: disable=missing-function-docstring
"""
Unit tests for MCP span naming.

``MCPTool``-style instrumentation registers each wrapped method with an
``endpoint`` string such as ``"fastmcp call_tool"``, and
``MCPInstrumentationContext._endpoint_method`` keeps only the *second* word of
that string -- ``"call_tool"``. ``get_enhanced_span_name`` therefore cannot
recover the namespace from ``method`` and has to use the ``operation_type`` it
is handed. The FastMCP branch used to test ``"fastmcp" in method`` instead, and
sat *below* the generic ``call_tool`` / ``read_resource`` / ``run`` checks, so
FastMCP operations were emitted under the plain ``mcp tools/*`` and
``mcp resources/*`` names and were indistinguishable from the client/server
spans of the same name.
"""

import pytest

from openlit.instrumentation.mcp.utils import MCPInstrumentationContext


def _context(operation_type: str, method: str) -> tuple[MCPInstrumentationContext, str]:
    """Build a context the way the sync/async wrappers do, then name the span."""
    ctx = MCPInstrumentationContext(
        instance=None,
        args=(),
        kwargs={},
        version="1.0.0",
        environment="test",
        application_name="test",
        pricing_info=None,
        capture_message_content=False,
    )
    ctx._wrapped_function_name = method  # pylint: disable=protected-access
    ctx._endpoint_method = method  # pylint: disable=protected-access
    return ctx, ctx.get_enhanced_span_name(operation_type)


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("run", "mcp fastmcp/run"),
        ("add_tool", "mcp fastmcp/add_tool"),
        ("add_resource", "mcp fastmcp/add_resource"),
        ("add_prompt", "mcp fastmcp/add_prompt"),
        ("call_tool", "mcp fastmcp/call_tool"),
        ("read_resource", "mcp fastmcp/read_resource"),
        ("get_prompt", "mcp fastmcp/get_prompt"),
    ],
)
def test_fastmcp_operations_keep_their_own_span_names(method, expected):
    _, span_name = _context("fastmcp", method)

    assert span_name == expected


def test_fastmcp_call_tool_is_not_reported_as_a_plain_tool_call():
    """The method name alone cannot distinguish the two; operation_type can."""
    _, fastmcp_span = _context("fastmcp", "call_tool")
    _, client_span = _context("client", "call_tool")

    assert fastmcp_span != client_span
    assert client_span == "mcp tools/call"


@pytest.mark.parametrize(
    ("operation_type", "method", "expected"),
    [
        ("client", "call_tool", "mcp tools/call"),
        ("client", "list_tools", "mcp tools/list"),
        ("client", "read_resource", "mcp resources/read"),
        ("client", "list_resources", "mcp resources/list"),
        ("server", "call_tool", "mcp tools/call"),
        ("server", "read_resource", "mcp resources/read"),
        ("server", "run", "mcp server/run"),
        ("server", "list_tools", "mcp tools/list"),
        ("transport", "stdio_client", "mcp transport/stdio_client"),
        ("transport", "http_server", "mcp transport/http_server"),
        ("manager", "get_resource", "mcp manager/get_resource"),
        ("manager", "render_prompt", "mcp manager/render_prompt"),
        ("auth", "authorize", "mcp auth/authorize"),
        ("auth", "verify_token", "mcp auth/verify_token"),
        ("memory", "connect", "mcp memory/connect"),
        ("progress", "update", "mcp progress/update"),
        ("session", "init", "mcp session/init"),
        ("jsonrpc", "send_request", "mcp transport/request"),
    ],
)
def test_non_fastmcp_span_names_are_unchanged(operation_type, method, expected):
    """The FastMCP fix must not disturb any other registered operation."""
    _, span_name = _context(operation_type, method)

    assert span_name == expected
