"""
LangGraph sync wrapper for instrumentation
"""

import time
from opentelemetry.trace import SpanKind, Link
from opentelemetry import context as context_api
from openlit.__helpers import (
    handle_exception,
    truncate_content,
    set_langgraph_wrapper_active,
    reset_langgraph_wrapper_active,
    set_langgraph_conversation_id,
    reset_langgraph_conversation_id,
    get_langgraph_conversation_id,
    _apply_custom_span_attributes,
)
from openlit.instrumentation.langgraph.utils import (
    process_langgraph_response,
    OPERATION_MAP,
    set_server_address_and_port,
    generate_span_name,
    set_graph_attributes,
    extract_messages_from_input,
    get_message_content,
    get_message_role,
    _get_graph_name,
    SemanticConvention,
)

_LANGGRAPH_SUPPRESS_KEY = context_api.create_key("openlit-langgraph-suppress")


def _is_tool_node(node_name, action):
    """Return True if this node is a tool-dispatching node that should NOT
    be wrapped as invoke_agent. Tool execution is already captured by the
    LangChain callback handler's execute_tool spans."""
    if "ToolNode" in type(action).__name__:
        return True
    if (
        hasattr(action, "func")
        and "ToolNode" in type(getattr(action, "func", None)).__name__
    ):
        return True
    name_lower = node_name.lower()
    if "tool" in name_lower and "agent" not in name_lower:
        return True
    return False


def _set_node_conv_id(span):
    """Set gen_ai.conversation.id from the ContextVar propagated by invoke_workflow."""
    conv_id = get_langgraph_conversation_id()
    if conv_id:
        span.set_attribute(SemanticConvention.GEN_AI_CONVERSATION_ID, conv_id)


def general_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Creates a wrapper for sync LangGraph operations.

    Args:
        gen_ai_endpoint: The endpoint being wrapped (e.g., "graph_invoke")
        version: SDK version
        environment: Deployment environment
        application_name: Application name
        tracer: OpenTelemetry tracer
        pricing_info: Pricing information for cost calculation
        capture_message_content: Whether to capture message content
        metrics: Metrics registry
        disable_metrics: Whether metrics are disabled

    Returns:
        Wrapper function
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the LangGraph operation with telemetry.
        """
        # Check for OTel-level or LangGraph-level suppression
        if context_api.get_value(
            context_api._SUPPRESS_INSTRUMENTATION_KEY
        ) or context_api.get_value(_LANGGRAPH_SUPPRESS_KEY):
            return wrapped(*args, **kwargs)

        # Get server address and port
        server_address, server_port = set_server_address_and_port(instance)

        # Get operation type
        operation_type = OPERATION_MAP.get(
            gen_ai_endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK
        )

        # Generate span name
        span_name = generate_span_name(
            operation_type, gen_ai_endpoint, instance, args, kwargs
        )

        # Stream operations manage their own span lifetime inside the generator
        if gen_ai_endpoint == "graph_stream":
            return _handle_stream(
                wrapped,
                instance,
                args,
                kwargs,
                span_name,
                tracer,
                operation_type,
                server_address,
                server_port,
                environment,
                application_name,
                metrics,
                capture_message_content,
                disable_metrics,
                version,
                gen_ai_endpoint,
            )

        links = []
        creation_ctx = getattr(instance, "_openlit_creation_context", None)
        if creation_ctx:
            links.append(Link(creation_ctx))

        _WORKFLOW_ENDPOINTS = {
            "graph_invoke",
            "graph_ainvoke",
            "graph_stream",
            "graph_astream",
        }
        span_kind = (
            SpanKind.INTERNAL
            if gen_ai_endpoint in _WORKFLOW_ENDPOINTS
            else SpanKind.CLIENT
        )

        with tracer.start_as_current_span(
            span_name, kind=span_kind, links=links
        ) as span:
            if gen_ai_endpoint in _WORKFLOW_ENDPOINTS:
                graph_name = _get_graph_name(instance)
                span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, graph_name)

            start_time = time.time()

            conv_id_token = None
            config = kwargs.get("config") or (args[1] if len(args) > 1 else None)
            if isinstance(config, dict):
                thread_id = config.get("configurable", {}).get("thread_id")
                if thread_id:
                    conv_id_token = set_langgraph_conversation_id(str(thread_id))

            try:
                suppress_token = context_api.attach(
                    context_api.set_value(_LANGGRAPH_SUPPRESS_KEY, True)
                )
                lg_token = set_langgraph_wrapper_active()
                try:
                    response = wrapped(*args, **kwargs)
                finally:
                    reset_langgraph_wrapper_active(lg_token)
                    context_api.detach(suppress_token)
                    if conv_id_token is not None:
                        reset_langgraph_conversation_id(conv_id_token)

                # Process response
                response = process_langgraph_response(
                    response,
                    operation_type,
                    server_address,
                    server_port,
                    environment,
                    application_name,
                    metrics,
                    start_time,
                    span,
                    capture_message_content,
                    disable_metrics,
                    version,
                    instance,
                    args,
                    endpoint=gen_ai_endpoint,
                    **kwargs,
                )

                return response

            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


def _handle_stream(
    wrapped,
    instance,
    args,
    kwargs,
    span_name,
    tracer,
    operation_type,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    endpoint,
):
    """
    Handle streaming responses with proper telemetry.

    Returns a generator that owns the span lifetime — the span stays open
    for the entire iteration and is closed only after the last chunk.
    """

    def stream_wrapper():
        links = []
        creation_ctx = getattr(instance, "_openlit_creation_context", None)
        if creation_ctx:
            links.append(Link(creation_ctx))

        with tracer.start_as_current_span(
            span_name, kind=SpanKind.INTERNAL, links=links
        ) as span:
            graph_name = _get_graph_name(instance)
            span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, graph_name)

            start_time = time.time()

            span.set_attribute("telemetry.sdk.name", "openlit")
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
            )
            if server_address:
                span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
                if server_port:
                    span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
            span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
            span.set_attribute(
                SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
            )
            span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)
            span.set_attribute(SemanticConvention.GEN_AI_EXECUTION_MODE, "stream")
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, True)

            # Track execution state
            execution_state = {
                "executed_nodes": [],
                "message_count": 0,
                "chunk_count": 0,
                "final_response": None,
            }

            # Capture input messages
            input_data = args[0] if args else kwargs.get("input", {})
            messages = extract_messages_from_input(input_data)
            if messages:
                execution_state["message_count"] = len(messages)
                if capture_message_content:
                    for i, msg in enumerate(messages[:3]):
                        content = get_message_content(msg)
                        role = get_message_role(msg)
                        if content:
                            span.set_attribute(
                                f"gen_ai.prompt.{i}.content", truncate_content(content)
                            )
                            span.set_attribute(f"gen_ai.prompt.{i}.role", role)

            try:
                stream_gen = wrapped(*args, **kwargs)

                for chunk in stream_gen:
                    execution_state["chunk_count"] += 1

                    if isinstance(chunk, dict):
                        for key in chunk:
                            # Track node executions
                            if key not in ("__start__", "__end__", "__interrupt__"):
                                if key not in execution_state["executed_nodes"]:
                                    execution_state["executed_nodes"].append(key)

                            # Track messages in chunk
                            chunk_value = chunk[key]
                            if (
                                isinstance(chunk_value, dict)
                                and "messages" in chunk_value
                            ):
                                msg_list = chunk_value["messages"]
                                if isinstance(msg_list, list):
                                    execution_state["message_count"] += len(msg_list)
                                    for msg in msg_list:
                                        content = get_message_content(msg)
                                        if content:
                                            execution_state["final_response"] = (
                                                execution_state["final_response"] or ""
                                            ) + content

                    # Handle tuple format for some stream modes:
                    # - (node_name_str, value_dict) for stream_mode="updates" etc.
                    # - (message_object, metadata_dict) for stream_mode="messages"
                    elif isinstance(chunk, tuple) and len(chunk) >= 2:
                        if isinstance(chunk[0], str):
                            # Format: (node_name, value) — node_name is a plain string
                            node_name, value = chunk[0], chunk[1]
                            if node_name not in (
                                "__start__",
                                "__end__",
                                "__interrupt__",
                            ):
                                if node_name not in execution_state["executed_nodes"]:
                                    execution_state["executed_nodes"].append(node_name)
                            if isinstance(value, dict) and "messages" in value:
                                msg_list = value["messages"]
                                if isinstance(msg_list, list):
                                    execution_state["message_count"] += len(msg_list)
                                    for msg in msg_list:
                                        content = get_message_content(msg)
                                        if content:
                                            execution_state["final_response"] = (
                                                execution_state["final_response"] or ""
                                            ) + content
                        else:
                            # Format: (message_object, metadata_dict) for stream_mode="messages"
                            # chunk[0] is a LangChain message (AIMessage, HumanMessage, etc.)
                            # chunk[1] is a metadata dict containing "langgraph_node"
                            message_obj, metadata = chunk[0], chunk[1]
                            if isinstance(metadata, dict):
                                node_name = metadata.get("langgraph_node", "")
                                if (
                                    node_name
                                    and isinstance(node_name, str)
                                    and node_name
                                    not in ("__start__", "__end__", "__interrupt__")
                                    and node_name
                                    not in execution_state["executed_nodes"]
                                ):
                                    execution_state["executed_nodes"].append(node_name)
                            execution_state["message_count"] += 1
                            content = get_message_content(message_obj)
                            if content:
                                execution_state["final_response"] = (
                                    execution_state["final_response"] or ""
                                ) + content

                    yield chunk

                _finalize_stream_span(
                    span, execution_state, capture_message_content, start_time
                )

            except Exception as e:
                handle_exception(span, e)
                raise

    return stream_wrapper()


def _finalize_stream_span(span, execution_state, capture_message_content, start_time):
    """Finalize stream span with collected telemetry."""
    import json
    from opentelemetry.trace import Status, StatusCode

    end_time = time.time()

    # Set execution attributes
    span.set_attribute(
        SemanticConvention.GEN_AI_GRAPH_EXECUTED_NODES,
        json.dumps(execution_state["executed_nodes"]),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_GRAPH_NODE_EXECUTION_COUNT,
        len(execution_state["executed_nodes"]),
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_GRAPH_MESSAGE_COUNT, execution_state["message_count"]
    )
    span.set_attribute(
        SemanticConvention.GEN_AI_GRAPH_TOTAL_CHUNKS, execution_state["chunk_count"]
    )

    if execution_state["final_response"] and capture_message_content:
        output_msgs = [
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "text",
                        "content": truncate_content(execution_state["final_response"]),
                    }
                ],
            }
        ]
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
            json.dumps(output_msgs),
        )

    span.set_attribute(SemanticConvention.GEN_AI_GRAPH_STATUS, "success")
    span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, end_time - start_time
    )
    span.set_status(Status(StatusCode.OK))


def wrap_compile(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Special wrapper for StateGraph.compile that emits a create_agent span.

    If a create_agent span is already active (e.g. from _wrap_create_agent in
    the LangChain instrumentor), compile is passed through without a span to
    avoid duplication.
    """
    import json
    from openlit.__helpers import is_create_agent_active

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        if is_create_agent_active():
            return wrapped(*args, **kwargs)

        # Derive agent name from the graph instance
        graph_name = _get_graph_name(instance)
        agent_name = "default" if graph_name in ("graph", "LangGraph") else graph_name

        span_name = f"create_agent {agent_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()

            try:
                result = wrapped(*args, **kwargs)

                # Extract graph structure for agent attributes
                nodes = []
                edges = []

                if hasattr(instance, "nodes"):
                    nodes = (
                        list(instance.nodes.keys())
                        if hasattr(instance.nodes, "keys")
                        else []
                    )

                if hasattr(instance, "edges"):
                    edge_set = instance.edges
                    if isinstance(edge_set, set):
                        for edge in edge_set:
                            if isinstance(edge, tuple) and len(edge) >= 2:
                                edges.append(f"{edge[0]}->{edge[1]}")

                set_graph_attributes(span, nodes, edges)

                span.set_attribute(
                    SemanticConvention.GEN_AI_OPERATION,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                )
                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
                )
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, agent_name)
                span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
                span.set_attribute(
                    SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                )
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

                if nodes:
                    span.set_attribute("gen_ai.agent.tools", json.dumps(nodes))
                    description = f"Agent with nodes: {', '.join(nodes)}"
                else:
                    description = "LangGraph agent"
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION, description
                )

                span.set_attribute(
                    SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                    time.time() - start_time,
                )

                from opentelemetry.trace import Status, StatusCode

                span.set_status(Status(StatusCode.OK))

                _apply_custom_span_attributes(span)

                result._openlit_creation_context = span.get_span_context()

                return result

            except Exception as e:
                handle_exception(span, e)
                raise

    return wrapper


def wrap_add_node(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Special wrapper for StateGraph.add_node that wraps node functions for per-node tracing.
    """
    import inspect
    from functools import wraps

    def wrapper(wrapped, instance, args, kwargs):
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # Extract node name and action
        if args:
            node_key = args[0]
            action = args[1] if len(args) > 1 else kwargs.get("action")
        else:
            node_key = kwargs.get("node") or kwargs.get("key")
            action = kwargs.get("action")

        if not action:
            return wrapped(*args, **kwargs)

        # Create wrapped node function for instrumentation
        def create_wrapped_node(original_func, node_name):
            if getattr(original_func, "_openlit_wrapped", False):
                return original_func

            if inspect.iscoroutinefunction(original_func):

                @wraps(original_func)
                async def wrapped_node_async(state, *node_args, **node_kwargs):
                    if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
                        return await original_func(state, *node_args, **node_kwargs)

                    span_name = f"invoke_agent {node_name}"
                    with tracer.start_as_current_span(
                        span_name, kind=SpanKind.INTERNAL
                    ) as span:
                        start_time = time.time()
                        span.set_attribute(
                            SemanticConvention.GEN_AI_PROVIDER_NAME,
                            SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_OPERATION,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_NAME, node_name
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_ID, str(node_name)
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_ENVIRONMENT, environment
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_SDK_VERSION, version
                        )
                        _set_node_conv_id(span)
                        span.set_attribute(
                            SemanticConvention.GEN_AI_OUTPUT_TYPE, "text"
                        )
                        _apply_custom_span_attributes(span)

                        try:
                            result = await original_func(
                                state, *node_args, **node_kwargs
                            )

                            # Extract LLM info from result
                            from openlit.instrumentation.langgraph.utils import (
                                extract_llm_info_from_result,
                            )

                            extract_llm_info_from_result(span, state, result)

                            from opentelemetry.trace import Status, StatusCode

                            span.set_attribute(
                                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                                time.time() - start_time,
                            )
                            span.set_status(Status(StatusCode.OK))
                            return result

                        except Exception as e:
                            handle_exception(span, e)
                            raise

                wrapped_node_async._openlit_wrapped = True
                return wrapped_node_async
            else:

                @wraps(original_func)
                def wrapped_node_sync(state, *node_args, **node_kwargs):
                    if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
                        return original_func(state, *node_args, **node_kwargs)

                    span_name = f"invoke_agent {node_name}"
                    with tracer.start_as_current_span(
                        span_name, kind=SpanKind.INTERNAL
                    ) as span:
                        start_time = time.time()
                        span.set_attribute(
                            SemanticConvention.GEN_AI_PROVIDER_NAME,
                            SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH,
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_OPERATION,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_NAME, node_name
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_AGENT_ID, str(node_name)
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_ENVIRONMENT, environment
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                        )
                        span.set_attribute(
                            SemanticConvention.GEN_AI_SDK_VERSION, version
                        )
                        _set_node_conv_id(span)
                        span.set_attribute(
                            SemanticConvention.GEN_AI_OUTPUT_TYPE, "text"
                        )
                        _apply_custom_span_attributes(span)

                        try:
                            result = original_func(state, *node_args, **node_kwargs)

                            # Extract LLM info from result
                            from openlit.instrumentation.langgraph.utils import (
                                extract_llm_info_from_result,
                            )

                            extract_llm_info_from_result(span, state, result)

                            from opentelemetry.trace import Status, StatusCode

                            span.set_attribute(
                                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                                time.time() - start_time,
                            )
                            span.set_status(Status(StatusCode.OK))
                            return result

                        except Exception as e:
                            handle_exception(span, e)
                            raise

                wrapped_node_sync._openlit_wrapped = True
                return wrapped_node_sync

        # Wrap the action function
        node_name = str(node_key) if not isinstance(node_key, str) else node_key

        if _is_tool_node(node_name, action):
            wrapped_action = action
        elif inspect.isroutine(action):
            wrapped_action = create_wrapped_node(action, node_name)
        elif hasattr(action, "func") and inspect.isroutine(
            getattr(action, "func", None)
        ):
            action.func = create_wrapped_node(action.func, node_name)
            if hasattr(action, "afunc") and inspect.isroutine(
                getattr(action, "afunc", None)
            ):
                action.afunc = create_wrapped_node(action.afunc, node_name)
            wrapped_action = action
        else:
            wrapped_action = action

        # Call original add_node with wrapped action
        if args and len(args) > 1:
            new_args = (args[0], wrapped_action) + args[2:]
            return wrapped(*new_args, **kwargs)
        else:
            kwargs["action"] = wrapped_action
            if args:
                return wrapped(*args, **kwargs)
            else:
                kwargs["node"] = node_key
                return wrapped(**kwargs)

    return wrapper
