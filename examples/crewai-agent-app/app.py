import os
import time
from crewai import Agent, Task, Crew

print("CrewAI agent app starting -- running crew every 60s")

i = 0
while True:
    try:
        researcher = Agent(
            role="Research Analyst",
            goal="Find a single interesting fact about AI observability",
            backstory="You are a concise research analyst who gives one-sentence answers.",
            verbose=False,
            allow_delegation=False,
            llm="openai/gpt-4o-mini",
        )

        writer = Agent(
            role="Content Writer",
            goal="Turn a research fact into a single tweet-length summary",
            backstory="You are a concise writer who creates short summaries.",
            verbose=False,
            allow_delegation=False,
            llm="openai/gpt-4o-mini",
        )

        research_task = Task(
            description="Find one interesting fact about LLM observability in production systems. Keep it to one sentence.",
            expected_output="A single sentence fact.",
            agent=researcher,
        )

        write_task = Task(
            description="Take the research fact and write a single tweet-length summary (under 280 characters).",
            expected_output="A tweet-length summary.",
            agent=writer,
        )

        crew = Crew(
            agents=[researcher, writer],
            tasks=[research_task, write_task],
            verbose=False,
        )

        result = crew.kickoff()
        print(f"[{i}] Crew result: {result}")
    except Exception as e:
        print(f"[{i}] Error: {e}")

    i += 1
    time.sleep(60)
