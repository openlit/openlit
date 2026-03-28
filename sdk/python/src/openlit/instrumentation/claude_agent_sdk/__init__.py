"""
OpenLIT Claude Agent SDK Instrumentation — OTel GenAI semantic convention compliant.

Wraps the Claude Agent SDK's ``query()`` and ``ClaudeSDKClient`` to emit
``invoke_agent`` and ``execute_tool`` spans following the same patterns as
CrewAI, LangGraph, and OpenAI Agents instrumentations.
"""

import importlib
import importlib.metadata
import sys
from typing import Collection
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.claude_agent_sdk.claude_agent_sdk import (
    wrap_query,
    wrap_connect,
    wrap_client_query,
    wrap_receive_response,
)

_instruments = ("claude-agent-sdk >= 0.1.0",)


class ClaudeAgentSDKInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic convention compliant instrumentor for Claude Agent SDK."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("claude-agent-sdk")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = kwargs.get("event_provider")

        wrap_args = (
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )
        wrap_kwargs = {"event_provider": event_provider}

        # Wrap query() — stateless one-shot API
        try:
            sdk_module = importlib.import_module("claude_agent_sdk")
            original_query = getattr(sdk_module, "query", None)

            wrap_function_wrapper(
                "claude_agent_sdk.query",
                "query",
                wrap_query(*wrap_args, **wrap_kwargs),
            )

            query_module = importlib.import_module("claude_agent_sdk.query")
            wrapped_query = query_module.query
            setattr(sdk_module, "query", wrapped_query)

            if original_query is not None:
                for module in list(sys.modules.values()):
                    try:
                        if (
                            module is not None
                            and getattr(module, "query", None) is original_query
                        ):
                            setattr(module, "query", wrapped_query)
                    except Exception:
                        continue
        except Exception:
            pass

        # Wrap ClaudeSDKClient methods — stateful multi-turn API
        try:
            wrap_function_wrapper(
                "claude_agent_sdk.client",
                "ClaudeSDKClient.connect",
                wrap_connect(*wrap_args, **wrap_kwargs),
            )
        except Exception:
            pass

        try:
            wrap_function_wrapper(
                "claude_agent_sdk.client",
                "ClaudeSDKClient.query",
                wrap_client_query(*wrap_args, **wrap_kwargs),
            )
        except Exception:
            pass

        try:
            wrap_function_wrapper(
                "claude_agent_sdk.client",
                "ClaudeSDKClient.receive_response",
                wrap_receive_response(*wrap_args, **wrap_kwargs),
            )
        except Exception:
            pass

    def _uninstrument(self, **kwargs):
        try:
            sdk_module = importlib.import_module("claude_agent_sdk")
            query_module = importlib.import_module("claude_agent_sdk.query")
            setattr(sdk_module, "query", query_module.query)
        except Exception:
            pass
