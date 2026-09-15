"""CrewAI multi-agent sample — instrumented with openlit.init() only."""
import os
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import openlit

if not os.environ.get("OPENAI_API_KEY"):
    raise SystemExit("OPENAI_API_KEY missing — set it in the repo root .env")

OTLP_ENDPOINT = os.environ.get(
    "OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318"
)
SERVICE_NAME = os.environ.get("OPENLIT_SERVICE_NAME", "crewai-agent-app")
ENVIRONMENT = os.environ.get("OPENLIT_ENVIRONMENT", "default")
INTERVAL = int(os.environ.get("REQUEST_INTERVAL_SECONDS", "60"))
MODEL = os.environ.get("OPENAI_MODEL", "openai/gpt-4o-mini")

openlit.init(
    service_name=SERVICE_NAME,
    environment=ENVIRONMENT,
    otlp_endpoint=OTLP_ENDPOINT,
)

from crewai import Agent, Crew, Task  # noqa: E402  — after openlit.init()

print(
    f"[crewai-agent-app] starting → OTLP {OTLP_ENDPOINT} "
    f"service={SERVICE_NAME} every {INTERVAL}s"
)

i = 0
while True:
    try:
        researcher = Agent(
            role="Research Analyst",
            goal="Find a single interesting fact about AI observability",
            backstory="You are a concise research analyst who gives one-sentence answers.",
            verbose=False,
            allow_delegation=False,
            llm=MODEL,
        )

        writer = Agent(
            role="Content Writer",
            goal="Turn a research fact into a single tweet-length summary",
            backstory="You are a concise writer who creates short summaries.",
            verbose=False,
            allow_delegation=False,
            llm=MODEL,
        )

        research_task = Task(
            description=(
                "Find one interesting fact about LLM observability in production "
                "systems. Keep it to one sentence."
            ),
            expected_output="A single sentence fact.",
            agent=researcher,
        )

        write_task = Task(
            description=(
                "Take the research fact and write a single tweet-length summary "
                "(under 280 characters)."
            ),
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
    except Exception as exc:  # pylint: disable=broad-except
        print(f"[{i}] Error: {exc}")

    i += 1
    time.sleep(INTERVAL)
