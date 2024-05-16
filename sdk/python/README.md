<div align="center">
<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%"><h1>
OpenTelemetry Auto-Instrumentation for GenAI & LLM Applications</h1>

**[Documentation](https://docs.openlit.io/) | [Quickstart](#-getting-started) | [Python SDK](https://github.com/openlit/openlit/tree/main/sdk/python)**

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://github.com/openlit/openlit)
[![License](https://img.shields.io/github/license/openlit/openlit?label=License&logo=github&color=f80&logoColor=white)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![Downloads](https://static.pepy.tech/badge/openlit/month)](https://pepy.tech/project/openlit)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/openlit/openlit)](https://github.com/openlit/openlit/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/openlit/openlit)](https://github.com/openlit/openlit/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![X](https://img.shields.io/badge/follow-%40OpenLIT-1DA1F2?logo=x&style=social)](https://twitter.com/openlit_io)

</div>

OpenLIT Python SDK is an **OpenTelemetry-native** Auto instrumentation library for monitoring LLM Applications, facilitating the integration of observability into your GenAI-driven projects. Designed with simplicity and efficiency, OpenLIT offers the ability to embed observability into your GenAI-driven projects effortlessly using just **a single line of code**.

Whether you're directly using LLM Libraries like OpenAI, Anthropic or building complex RAG Agents using Langchain, OpenLIT seamlessly integrates observability into your applications, ensuring enhanced performance and reliability across diverse scenarios.

This project adheres to the [Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai) proposed by the OpenTelemetry community. You can check out the current definitions [here](src/openlit/semcov/__init__.py).

## What can be Auto Instrumented?

### LLMs
- [✅ OpenAI](https://docs.openlit.io/latest/integrations/openai)
- [✅ Anthropic](https://docs.openlit.io/latest/integrations/anthropic)
- [✅ Cohere](https://docs.openlit.io/latest/integrations/cohere)
- [✅ Mistral](https://docs.openlit.io/latest/integrations/mistral)
- [✅ Azure OpenAI](https://docs.openlit.io/latest/integrations/azure-openai)
- [✅ HuggingFace Transformers](https://docs.openlit.io/latest/integrations/huggingface)
- [✅ Amazon Bedrock](https://docs.openlit.io/latest/integrations/bedrock)
- [✅ Vertex AI](https://docs.openlit.io/latest/integrations/vertexai)
- [✅ Groq](https://docs.openlit.io/latest/integrations/groq)

### Vector DBs
- [✅ ChromaDB](https://docs.openlit.io/latest/integrations/chromadb)
- [✅ Pinecone](https://docs.openlit.io/latest/integrations/pinecone)
- [✅ Qdrant](https://docs.openlit.io/latest/integrations/qdrant)

### Frameworks
- [✅ Langchain](https://docs.openlit.io/latest/integrations/langchain)
- [✅ LiteLLM](https://docs.openlit.io/latest/integrations/litellm)
- [✅ LlamaIndex](https://docs.openlit.io/latest/integrations/llama-index)
- [✅ Haystack](https://docs.openlit.io/latest/integrations/haystack)

## Supported Destinations
- [✅ OpenTelemetry Collector](https://docs.openlit.io/latest/connections/otelcol)
- [✅ Prometheus + Tempo](https://docs.openlit.io/latest/connections/prometheus-tempo)
- [✅ Prometheus + Jaeger](https://docs.openlit.io/latest/connections/prometheus-jaeger)
- [✅ Grafana Cloud](https://docs.openlit.io/latest/connections/grafanacloud)
- [✅ DataDog](https://docs.openlit.io/latest/connections/datadog)
- [✅ New Relic](https://docs.openlit.io/latest/connections/new-relic)
- [✅ SigNoz](https://docs.openlit.io/latest/connections/signoz)
- [✅ Dynatrace](https://docs.openlit.io/latest/connections/dynatrace)
- [✅ OpenObserve](https://docs.openlit.io/latest/connections/openobserve)
- [✅ Highlight.io](https://docs.openlit.io/latest/connections/highlight)

## 💿 Installation

```bash
pip install openlit
```

## 🚀 Getting Started

## Step 1: Install OpenLIT SDK

```bash
pip install openlit
```

### Step 2: Instrument your Application
Integrating the OpenLIT into LLM applications is straightforward. Start monitoring for your LLM Application with just **one line of code**: 

```python
import openlit

openlit.init()
```

By default, OpenLIT directs traces and metrics straight to your console. To forward telemetry data to an HTTP OTLP endpoint, such as the OpenTelemetry Collector, set the `otlp_endpoint` parameter with the desired endpoint. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable as recommended in the OpenTelemetry documentation.

To send telemetry to OpenTelemetry backends requiring authentication, set the `otlp_headers` parameter with its desired value. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_HEADERS` environment variable as recommended in the OpenTelemetry documentation.

#### Example

Here is how you can send telemetry from OpenLIT to Grafana Cloud

```python
openlit.init(
  otlp_endpoint="https://otlp-gateway-prod-us-east-0.grafana.net/otlp", 
  otlp_headers="Authorization=Basic%20<base64 encoded Instance ID and API Token>"
)
```

Alternatively, You can also choose to set these values using `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` environment variables

```python
openlit.init()
```

```env
export OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp-gateway-prod-us-east-0.grafana.net/otlp"
export OTEL_EXPORTER_OTLP_HEADERS = "Authorization=Basic%20<base64 encoded Instance ID and API Token>"
```

### Step 3: Visualize and Optimize!
With the LLM Observability data now being collected and sent to your chosen OpenTelemetry backend, the next step is to visualize and analyze this data to glean insights into your application's performance, behavior, and identify areas of improvement. Here is how you would use the data in Grafana, follow these detailed instructions to explore your LLM application's Telemetry data.

   - Select the **Explore** option from Grafana's sidebar.
   - At the top, ensure the correct Tempo data source is selected from the dropdown menu.
   - Use the **Query** field to specify any particular traces you are interested in, or leave it empty to browse through all the available traces.
   - You can adjust the time range to focus on specific periods of interest.
   - Hit **Run Query** to fetch your trace data. You'll see a visual representation of your traces along with detailed information on particular spans when clicked.

#### Next Steps

- **Create Dashboards:** Beyond just exploring traces, consider creating dashboards in Grafana to monitor key performance indicators (KPIs) and metrics over time. Dashboards can be customized with various panels to display graphs, logs, and single stats that are most relevant to your application's performance and usage patterns.
- **Set Alerts:** Grafana also allows you to set up alerts based on specific thresholds. This feature can be invaluable in proactively managing your application's health by notifying you of potential issues before they impact users.
- **Iterate and Optimize:** Use the insights gained from your observability data to make informed decisions on optimizing your LLM application. This might involve refining model parameters, adjusting scaling strategies, or identifying and resolving bottlenecks.


### Configuration

Below is a detailed overview of the configuration options available, allowing you to adjust OpenLIT's behavior and functionality to align with your specific observability needs:

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

## 🌱 Contributing

Whether it's big or small, we love contributions 💚. Check out our [Contribution guide](../../CONTRIBUTING.md) to get started

Unsure where to start? Here are a few ways to get involved:

- Join our [Slack channel](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) to discuss ideas, share feedback, and connect with both our team and the wider OpenLIT community.

Your input helps us grow and improve, and we're here to support you every step of the way.

## 💚 Community & Support

Connect with the OpenLIT community and maintainers for support, discussions, and updates:

- 🌟 If you like it, Leave a star on our [GitHub](https://github.com/openlit/openlit/)
- 🌍 Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) Community for live interactions and questions.
- 🐞 Report bugs on our [GitHub Issues](https://github.com/openlit/openlit/issues) to help us improve OpenLIT.
- 𝕏 Follow us on [X](https://twitter.com/openlit) for the latest updates and news.
