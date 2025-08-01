import asyncio
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter

# Set up OpenTelemetry tracing
trace.set_tracer_provider(TracerProvider())
tracer_provider = trace.get_tracer_provider()
span_processor = SimpleSpanProcessor(ConsoleSpanExporter())
tracer_provider.add_span_processor(span_processor)

# Initialize OpenInference instrumentation
from openinference.instrumentation.agno import AgnoInstrumentor

instrumentor = AgnoInstrumentor()
instrumentor.instrument()

from agno.agent import Agent
from agno.models.openai import OpenAIChat
from agno.tools.duckduckgo import DuckDuckGoTools

agent = Agent(
    model=OpenAIChat(id="gpt-4o"),
    tools=[DuckDuckGoTools()],
    show_tool_calls=True,
    markdown=True,
)

# Test async version
asyncio.run(agent.aprint_response("What is the capital of France?", stream=True))