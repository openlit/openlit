"""
OpenLIT Agno Instrumentation — OTel GenAI semantic convention compliant.

Targets agno >= 0.6.0. Uses unified general_wrap / async_general_wrap
wrappers with OPERATION_MAP-driven span names, kinds, and attributes.
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.agno.agno import general_wrap
from openlit.instrumentation.agno.async_agno import (
    async_general_wrap,
    async_workflow_wrap,
)
from openlit.instrumentation.agno.utils import (
    resolve_agno_knowledge_target,
    resolve_agno_memory_target,
)

_instruments = ("agno >= 0.6.0",)

# === ALWAYS-ON OPERATIONS ===
# Each tuple: (module, method, operation_key, sync_type)
WORKFLOW_OPERATIONS = [
    # Agent construction — create_agent spans
    ("agno.agent.agent", "Agent.__init__", "agent_init", "sync"),
    # Agent execution — invoke_agent
    ("agno.agent.agent", "Agent.run", "agent_run", "sync"),
    ("agno.agent.agent", "Agent.arun", "agent_arun", "async"),
    ("agno.agent.agent", "Agent.continue_run", "agent_continue_run", "sync"),
    ("agno.agent.agent", "Agent.acontinue_run", "agent_acontinue_run", "async"),
]

# === DETAILED-TRACING OPERATIONS ===
# Wrapped only when detailed_tracing=True
DETAILED_OPERATIONS = [
    # Tool execution — execute_tool (FunctionCall.execute/aexecute)
    ("agno.tools.function", "FunctionCall.execute", "tool_execute", "sync"),
    ("agno.tools.function", "FunctionCall.aexecute", "tool_aexecute", "async"),
    # Team operations — invoke_workflow
    ("agno.team.team", "Team.run", "team_run", "sync"),
    ("agno.team.team", "Team.arun", "team_arun", "async"),
    # VectorDB operations — retrieval / upsert
    ("agno.vectordb.base", "VectorDb.search", "vectordb_search", "sync"),
    ("agno.vectordb.base", "VectorDb.upsert", "vectordb_upsert", "sync"),
]


class AgnoInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic convention compliant instrumentor for Agno."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        try:
            version = importlib.metadata.version("agno")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

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

        # Detect agno version for method name compatibility.
        # agno < 2.5.3 used private methods (_run, _arun, _arun_stream).
        # agno >= 2.5.3 replaced them with public methods (run, arun).
        try:
            from agno.agent.agent import Agent as _AgnoAgent
        except ImportError:
            _AgnoAgent = None

        _has_private_run = _AgnoAgent is not None and hasattr(_AgnoAgent, "_run")

        # Build the operations list with version-aware method names
        ops = []

        # Agent.__init__ — always wrap for create_agent spans
        ops.append(("agno.agent.agent", "Agent.__init__", "agent_init", "sync"))

        # Agent run methods
        run_method = "_run" if _has_private_run else "run"
        arun_method = "_arun" if _has_private_run else "arun"
        ops.append(("agno.agent.agent", f"Agent.{run_method}", "agent_run", "sync"))
        ops.append(("agno.agent.agent", f"Agent.{arun_method}", "agent_arun", "async"))
        ops.append(
            ("agno.agent.agent", "Agent.continue_run", "agent_continue_run", "sync")
        )
        ops.append(
            ("agno.agent.agent", "Agent.acontinue_run", "agent_acontinue_run", "async")
        )

        # Wrap Agent._arun_stream if it exists (agno < 2.5.3)
        if _AgnoAgent is not None and hasattr(_AgnoAgent, "_arun_stream"):
            ops.append(
                ("agno.agent.agent", "Agent._arun_stream", "agent_arun", "async")
            )

        # -- always-on operations --
        for module, method, op_key, sync_type in ops:
            try:
                if sync_type == "async":
                    wrapper = async_general_wrap(op_key, *wrap_args)
                else:
                    wrapper = general_wrap(op_key, *wrap_args)
                wrap_function_wrapper(module, method, wrapper)
            except Exception:
                pass

        # -- detailed-tracing operations --
        if detailed_tracing:
            # Tool execution via FunctionCall
            for module, method, op_key, sync_type in [
                ("agno.tools.function", "FunctionCall.execute", "tool_execute", "sync"),
                (
                    "agno.tools.function",
                    "FunctionCall.aexecute",
                    "tool_aexecute",
                    "async",
                ),
            ]:
                try:
                    if sync_type == "async":
                        wrapper = async_general_wrap(op_key, *wrap_args)
                    else:
                        wrapper = general_wrap(op_key, *wrap_args)
                    wrap_function_wrapper(module, method, wrapper)
                except Exception:
                    pass

            # Team operations
            try:
                from agno.team.team import Team  # pylint: disable=import-error
            except ImportError:
                Team = None

            if Team is not None:
                # Team._arun_stream (agno < 2.5.3 private methods)
                if hasattr(Team, "_arun_stream"):
                    try:
                        wrap_function_wrapper(
                            "agno.team.team",
                            "Team._arun_stream",
                            async_general_wrap("team_arun", *wrap_args),
                        )
                        wrap_function_wrapper(
                            "agno.team.team",
                            "Team._arun",
                            async_general_wrap("team_arun", *wrap_args),
                        )
                    except Exception:
                        pass
                else:
                    try:
                        wrap_function_wrapper(
                            "agno.team.team",
                            "Team.arun",
                            async_general_wrap("team_arun", *wrap_args),
                        )
                    except Exception:
                        pass

                try:
                    wrap_function_wrapper(
                        "agno.team.team",
                        "Team.run",
                        general_wrap("team_run", *wrap_args),
                    )
                except Exception:
                    pass

            # Workflow operations
            try:
                from agno.workflow.workflow import Workflow  # pylint: disable=import-error
            except ImportError:
                Workflow = None

            if Workflow is not None:
                if hasattr(Workflow, "run_workflow"):
                    try:
                        wrap_function_wrapper(
                            "agno.workflow.workflow",
                            "Workflow.run_workflow",
                            general_wrap("workflow_run", *wrap_args),
                        )
                    except Exception:
                        pass
                    if hasattr(Workflow, "arun_workflow"):
                        try:
                            wrap_function_wrapper(
                                "agno.workflow.workflow",
                                "Workflow.arun_workflow",
                                async_workflow_wrap("workflow_arun", *wrap_args),
                            )
                        except Exception:
                            pass

                try:
                    wrap_function_wrapper(
                        "agno.workflow.workflow",
                        "Workflow.arun",
                        async_workflow_wrap("workflow_arun", *wrap_args),
                    )
                except Exception:
                    pass

            # VectorDB operations
            try:
                wrap_function_wrapper(
                    "agno.vectordb.base",
                    "VectorDb.search",
                    general_wrap("vectordb_search", *wrap_args),
                )
                wrap_function_wrapper(
                    "agno.vectordb.base",
                    "VectorDb.upsert",
                    general_wrap("vectordb_upsert", *wrap_args),
                )
            except Exception:
                pass

            # Memory operations
            memory_module, memory_class = resolve_agno_memory_target()
            if memory_module is not None:
                try:
                    wrap_function_wrapper(
                        memory_module,
                        f"{memory_class}.add_user_memory",
                        general_wrap("memory_add", *wrap_args),
                    )
                    wrap_function_wrapper(
                        memory_module,
                        f"{memory_class}.search_user_memories",
                        general_wrap("memory_search", *wrap_args),
                    )
                except Exception:
                    pass

            # Knowledge operations
            knowledge_module, knowledge_class = resolve_agno_knowledge_target()
            if knowledge_module is not None:
                try:
                    wrap_function_wrapper(
                        knowledge_module,
                        f"{knowledge_class}.search",
                        general_wrap("knowledge_search", *wrap_args),
                    )
                except Exception:
                    pass

    def _uninstrument(self, **kwargs):
        pass
