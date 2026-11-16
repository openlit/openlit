from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions

agents = {
    "data-analyst": AgentDefinition(
        description="Analyses research notes and renders charts.",
        tools=["Glob", "Read", "Bash", "Write"],
        prompt="You analyse data.",
        model="haiku",
    ),
    "researcher": AgentDefinition(
        description="Searches the web for sources.",
        tools=["WebSearch", "Write"],
        prompt="You research topics.",
        model="haiku",
    ),
}

options = ClaudeAgentOptions(agents=agents)
