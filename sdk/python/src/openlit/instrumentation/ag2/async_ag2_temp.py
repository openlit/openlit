def async_groupchat_manager_run_chat(
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
    Generates a telemetry wrapper for AG2 GroupChatManager.run_chat (async version).
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the AG2 GroupChatManager.run_chat call (async version).
        """

        server_address, server_port = set_server_address_and_port(
            instance, "127.0.0.1", 80
        )

        # Extract groupchat information
        groupchat = getattr(instance, "groupchat", None)
        if groupchat:
            participants = [agent.name for agent in groupchat.agents]
            group_name = f"GroupChat_{len(participants)}_agents"
        else:
            participants = []
            group_name = "UnknownGroupChat"

        # Extract model information from GroupChatManager
        request_model = "unknown"  # Default fallback
        if hasattr(instance, "llm_config") and isinstance(instance.llm_config, dict):
            request_model = instance.llm_config.get("model", "unknown")

        # Try to get more specific model from groupchat
        if groupchat and hasattr(groupchat, "select_speaker_auto_llm_config"):
            llm_config = groupchat.select_speaker_auto_llm_config
            if isinstance(llm_config, dict):
                request_model = llm_config.get("model", request_model)
            elif hasattr(llm_config, "model"):
                request_model = llm_config.model

        # Extract sender information
        sender = kwargs.get("sender", None)

        # Extract messages
        messages = args[0] if args else kwargs.get("messages", [])

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK} {group_name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)

            try:
                process_groupchat_operation(
                    group_name=group_name,
                    participants=participants,
                    messages=messages,
                    sender=sender,
                    max_turns=None,  # Not available in new API
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper


def async_groupchat_select_speaker(
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
    Generates a telemetry wrapper for AG2 GroupChat.select_speaker (async version).
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the AG2 GroupChat.select_speaker call (async version).
        """

        server_address, server_port = set_server_address_and_port(
            instance, "127.0.0.1", 80
        )

        # Extract speaker information
        last_speaker = args[0] if args else kwargs.get("last_speaker", None)
        selector = args[1] if len(args) > 1 else kwargs.get("selector", None)

        last_speaker_name = (
            getattr(last_speaker, "name", "Unknown") if last_speaker else "Unknown"
        )

        # Extract agents list
        agents = getattr(instance, "agents", [])

        # Extract model information from GroupChat instance
        request_model = "unknown"  # Default fallback
        # Check for speaker selection specific config
        if hasattr(instance, "select_speaker_auto_llm_config"):
            llm_config = instance.select_speaker_auto_llm_config
            if isinstance(llm_config, dict):
                request_model = llm_config.get("model", "unknown")
            elif hasattr(llm_config, "model"):
                request_model = llm_config.model

        # Try to get model from selector if available
        if (
            selector
            and hasattr(selector, "llm_config")
            and isinstance(selector.llm_config, dict)
        ):
            request_model = selector.llm_config.get("model", request_model)

        # Try to get model from agents if still unknown
        if request_model == "unknown" and agents:
            for agent in agents:
                if hasattr(agent, "llm_config") and isinstance(agent.llm_config, dict):
                    model = agent.llm_config.get("model")
                    if model:
                        request_model = model
                        break

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT} speaker_selection"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)

            try:
                selected_speaker_name = (
                    getattr(response, "name", "Unknown") if response else "Unknown"
                )

                process_speaker_selection(
                    last_speaker=last_speaker_name,
                    selected_speaker=selected_speaker_name,
                    selector=selector,
                    agents=agents,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper
