"""Initializer of Auto Instrumentation of Agno Framework Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.agno.agno import (
    agent_run_wrap,
    agent_continue_run_wrap,
    agent_run_tool_wrap,
    agent_add_tool_wrap,
    session_memory_wrap,
    memory_add_wrap,
    memory_search_wrap,
    function_execute_wrap,
    reasoning_wrap,
    vectordb_search_wrap,
    vectordb_upsert_wrap,
    knowledge_search_wrap,
    knowledge_add_wrap,
    workflow_run_wrap,
    team_run_wrap,
    model_run_function_call_wrap,
    function_entrypoint_wrap,
    memory_operation_wrap,
    parallel_execution_wrap,
    reasoning_tool_wrap,
)
from openlit.instrumentation.agno.async_agno import (
    async_agent_run_wrap,
    async_agent_continue_run_wrap,
    async_function_execute_wrap,
    async_reasoning_wrap,
    async_workflow_run_wrap,
    async_team_run_wrap,
    async_model_run_function_call_wrap,
    async_function_entrypoint_wrap,
)

_instruments = ("agno >= 0.6.0",)

WORKFLOW_OPERATIONS = [
    # Core Agent Execution Methods
    "Agent.run",
    "Agent.continue_run",
    # Team Operations
    "Agent.create",
]

COMPONENT_OPERATIONS = [
    # Tool Management
    "Agent.add_tool",
    "Agent.set_tools",
    # Memory Operations
    "Agent.get_session_summary",
    "Agent.get_user_memories",
]


class AgnoInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Agno Framework's agent library.
    """

    def __init__(self):
        """Initialize the AgnoInstrumentor."""
        super().__init__()
        self._original_thread_pool_submit = None

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

        # Get version
        try:
            version = importlib.metadata.version("agno")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        # CRITICAL: Patch ThreadPoolExecutor globally to preserve OpenTelemetry context
        self._patch_thread_pool_executor()

        # Workflow Operations (Always Instrumented)
        wrap_function_wrapper(
            "agno.agent.agent",
            "Agent.run",
            agent_run_wrap(
                "agent.run",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            ),
        )

        wrap_function_wrapper(
            "agno.agent.agent",
            "Agent.continue_run",
            agent_continue_run_wrap(
                "agent.continue_run",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            ),
        )

        # CRITICAL: Agent._run_tool is the bridge between agent and tool execution
        wrap_function_wrapper(
            "agno.agent.agent",
            "Agent._run_tool",
            agent_run_tool_wrap(
                "agent._run_tool",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            ),
        )

        # Async Operations
        wrap_function_wrapper(
            "agno.agent.agent",
            "Agent.arun",
            async_agent_run_wrap(
                "agent.arun",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            ),
        )

        wrap_function_wrapper(
            "agno.agent.agent",
            "Agent.acontinue_run",
            async_agent_continue_run_wrap(
                "agent.acontinue_run",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            ),
        )

        # Component Operations (Detailed Tracing Only) - Updated to match actual agno structure
        if detailed_tracing:
            # CRITICAL: Bridge span context between agent and tool execution
            wrap_function_wrapper(
                "agno.models.base",
                "Model.run_function_call",
                model_run_function_call_wrap(
                    "model.run_function_call",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # CRITICAL: Bridge span context for async function calls
            wrap_function_wrapper(
                "agno.models.base",
                "Model.arun_function_call",
                async_model_run_function_call_wrap(
                    "model.arun_function_call",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # CRITICAL: Also instrument the batch function calls method
            wrap_function_wrapper(
                "agno.models.base",
                "Model.run_function_calls",
                model_run_function_call_wrap(
                    "model.run_function_calls",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.models.base",
                "Model.arun_function_calls",
                async_model_run_function_call_wrap(
                    "model.arun_function_calls",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # CRITICAL: Memory operations that bypass model bridge
            wrap_function_wrapper(
                "agno.memory.v2.memory",
                "Memory.add_user_memory",
                memory_operation_wrap(
                    "memory.add_user_memory",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.memory.v2.memory",
                "Memory.search_user_memories",
                memory_operation_wrap(
                    "memory.search_user_memories",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Memory Operations (v2)
            wrap_function_wrapper(
                "agno.memory.v2.memory",
                "Memory.add_user_memory",
                memory_add_wrap(
                    "memory.add_user_memory",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.memory.v2.memory",
                "Memory.search_user_memories",
                memory_search_wrap(
                    "memory.search_user_memories",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Note: Memory class does not have async_add_user_memory or async_search_user_memories

            # VectorDB Operations (base class)
            wrap_function_wrapper(
                "agno.vectordb.base",
                "VectorDb.search",
                vectordb_search_wrap(
                    "vectordb.search",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.vectordb.base",
                "VectorDb.upsert",
                vectordb_upsert_wrap(
                    "vectordb.upsert",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Knowledge Operations
            wrap_function_wrapper(
                "agno.knowledge.agent",
                "AgentKnowledge.search",
                knowledge_search_wrap(
                    "knowledge.search",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.knowledge.agent",
                "AgentKnowledge.load",
                knowledge_add_wrap(
                    "knowledge.load",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.knowledge.agent",
                "AgentKnowledge.add_document_to_knowledge_base",
                knowledge_add_wrap(
                    "knowledge.add_document_to_knowledge_base",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Workflow Operations
            wrap_function_wrapper(
                "agno.workflow.workflow",
                "Workflow.run",
                workflow_run_wrap(
                    "workflow.run",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.workflow.workflow",
                "Workflow.run_workflow",
                workflow_run_wrap(
                    "workflow.run_workflow",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Async Workflow Operations (actual methods that exist)
            wrap_function_wrapper(
                "agno.workflow.workflow",
                "Workflow.arun",
                async_workflow_run_wrap(
                    "workflow.arun",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.workflow.workflow",
                "Workflow.arun_workflow",
                async_workflow_run_wrap(
                    "workflow.arun_workflow",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Team Operations
            wrap_function_wrapper(
                "agno.team.team",
                "Team.run",
                team_run_wrap(
                    "team.run",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Team Async Operations (actual methods that exist)
            wrap_function_wrapper(
                "agno.team.team",
                "Team.arun",
                async_team_run_wrap(
                    "team.arun",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Note: VectorDb class does not have async_search or async_upsert methods

            # Note: AgentKnowledge class does not have async_search method

            # Note: AgentKnowledge class does not have async_load or async_add_document_to_knowledge_base methods

            # NOTE: Removed duplicate tool execution instrumentation
            # The bridge spans from Model.run_function_call provide sufficient tracing
            # without creating redundant spans for FunctionCall.execute/aexecute

            # Reasoning Operations
            wrap_function_wrapper(
                "agno.agent.agent",
                "Agent.reason",
                reasoning_wrap(
                    "agent.reason",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.agent.agent",
                "Agent.areason",
                async_reasoning_wrap(
                    "agent.areason",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

        # Original Component Operations
        if detailed_tracing:
            wrap_function_wrapper(
                "agno.agent.agent",
                "Agent.add_tool",
                agent_add_tool_wrap(
                    "agent.add_tool",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Note: Agent class does not have async_add_tool method

            wrap_function_wrapper(
                "agno.agent.agent",
                "Agent.get_session_summary",
                session_memory_wrap(
                    "agent.get_session_summary",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            wrap_function_wrapper(
                "agno.agent.agent",
                "Agent.get_user_memories",
                session_memory_wrap(
                    "agent.get_user_memories",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # Note: Agent class does not have async_get_session_summary or async_get_user_memories methods

            # CRITICAL: Parallel execution operations for context preservation
            # Note: Parallel class doesn't have a run method, context is preserved via Model.run_function_calls

            wrap_function_wrapper(
                "agno.team.team",
                "Team._make_memories_and_summaries",
                parallel_execution_wrap(
                    "team._make_memories_and_summaries",
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

            # NOTE: Removed duplicate reasoning tool instrumentation
            # The bridge spans from Model.run_function_call provide sufficient tracing
            # without creating redundant spans for ReasoningTools.think/analyze

    def _patch_thread_pool_executor(self):
        """
        CRITICAL: Patch ThreadPoolExecutor.submit globally to preserve OpenTelemetry context.
        This fixes the broken span hierarchy caused by agno's extensive use of threading.
        """
        from concurrent.futures import ThreadPoolExecutor
        from opentelemetry import context as context_api

        # Store original submit method
        original_submit = ThreadPoolExecutor.submit

        def context_preserving_submit(self, func, *args, **kwargs):
            """Submit function while preserving OpenTelemetry context"""
            # Capture current context
            current_context = context_api.get_current()

            def context_wrapper(*wrapper_args, **wrapper_kwargs):
                # Restore context in the thread
                token = context_api.attach(current_context)
                try:
                    return func(*wrapper_args, **wrapper_kwargs)
                finally:
                    context_api.detach(token)

            return original_submit(self, context_wrapper, *args, **kwargs)

        # Apply the patch
        ThreadPoolExecutor.submit = context_preserving_submit

        # Store original for potential uninstrumentation
        self._original_thread_pool_submit = original_submit

    def _uninstrument(self, **kwargs):
        # Restore original ThreadPoolExecutor.submit if it was patched
        if hasattr(self, "_original_thread_pool_submit"):
            from concurrent.futures import ThreadPoolExecutor

            ThreadPoolExecutor.submit = self._original_thread_pool_submit
