# OpenLIT: OpenTelemetry-native Observability for LLMs

OpenLIT SDKs are OpenTelemetry native Auto instrumentation library for LLMs, that enables integrating observability into your GenAI-driven applications. OpenLIT is designed to be lightweight, easy to use, and powerful, giving developers the insights needed to optimize and understand their AI applications.

Whether you're developing conversational agents, content generation tools, or advanced AI solutions that rely on the robust capabilities of LLMs and vector search, OpenLIT provides the observability tools you need to ensure high performance and reliability.

## What can be Auto Instrumented?
LLMs
- ✅ OpenAI
- ✅ Anthropic
- ✅ Cohere
- ✅ Mistral
- ✅ Azure OpenAI
- ✅ HuggingFace Transformers

Vector DBs
- ✅ ChromaDB
- ✅ Pinecone

Frameworks
- ✅ Langchain

## 💿 Installation

```bash
pip install openlit
```

## ⚡ Quick Integration

```python
import openlit
openlit.init()
```

Out of the box, OpenLIT logs traces and metrics straight to your console. To send telemetry data to an HTTP OTel endpoint, like the OpenTelemetry Collector, add `otlp_endpoint` with the correct endpoint. Alternatively, set the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable as described in OpenTelemetry docs to configure the endpoint.

For telemetry delivery to OpenTelemetry backends requiring authentication, `otlp_headers` comes to the rescue. Alternatively, set the `OTEL_EXPORTER_OTLP_HEADERS` environment variable as described in OpenTelemetry docs to configure headers.


Below are the arguments you can pass to `openlit.init()`:

| Argument                | Description                                                                                   | Default Value  | Required |
|-------------------------|-----------------------------------------------------------------------------------------------|----------------|----------|
| `environment`           | The deployment environment of the application.                                                | `"default"`    |    Yes   |
| `application_name`      | Identifies the name of your application.                                                      | `"default"`    |    Yes   |
| `tracer`                | An instance of OpenTelemetry Tracer for tracing operations.                                   | `None`         |    No    |
| `meter`                 | An OpenTelemetry Metrics instance for capturing metrics.                                      | `None`         |    No    |
| `otlp_endpoint`         | Specifies the OTLP endpoint for transmitting telemetry data.                                  | `None`         |    No    |
| `otlp_headers`          | Defines headers for the OTLP exporter, useful for backends requiring authentication.          | `None`         |    No    |
| `disable_batch`         | A flag to disable batch span processing, favoring immediate dispatch.                         | `False`        |    No    |
| `trace_content`         | Enables tracing of content for deeper insights.                                               | `True`         |    No    |
| `disabled_instrumentors`| List of instrumentors to disable. Choices: `["openai", "anthropic", "langchain", "cohere", "mistral", "transformers", "chroma", "pinecone"]`. | `None` |    No    |
| `disable_metrics`       | If set, disables the collection of metrics.                                                   | `False`        |    No    |