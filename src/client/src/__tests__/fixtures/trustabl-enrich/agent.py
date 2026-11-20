from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions

agents = {
    "data-analyst": AgentDefinition(
        description="Analyses data and renders charts.",
        tools=["Glob", "Read", "Bash", "Write"],
        prompt="You analyse data.",
        model="haiku",
    ),
}

options = ClaudeAgentOptions(agents=agents)
