<div align="center">
<img src="https://github.com/dokulabs/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="Doku Logo" width="30%"><h1>
OpenTelemetry Auto-Instrumentation for GenAI LLM Application</h1>

**[Documentation](https://docs.dokulabs.com/) | [Quickstart](#-getting-started-with-doku) | [Python SDK](https://github.com/dokulabs/doku/tree/main/sdk/python)**

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://github.com/open-lit/openlit)
[![License](https://img.shields.io/github/license/open-lit/openlit?label=License&logo=github&color=f80&logoColor=white)](https://github.com/open-lit/openlit/blob/main/LICENSE)
[![Downloads](https://static.pepy.tech/badge/dokumetry/month)](https://pepy.tech/project/dokumetry)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/open-lit/openlit)](https://github.com/open-lit/openlit/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/dokulabs/doku)](https://github.com/open-lit/openlit/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/dokulabs/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![X](https://img.shields.io/badge/follow-%40dokulabs-1DA1F2?logo=x&style=social)](https://twitter.com/doku_labs)

</div>

OpenLIT Python SDK is an **OpenTelemetry-native** Auto instrumentation library for monitoring LLM Applications, facilitating the integration of observability into your GenAI-driven projects. Designed with simplicity and efficiency, OpenLIT offers the ability to embed observability into your GenAI-driven projects effortlessly using just **a single line of code**.

Whether you're directly using LLM Libraries like OpenAI, Anthropic or building complex RAG Agents using Langchain, OpenLIT seamlessly integrates observability into your applications, ensuring enhanced performance and reliability across diverse scenarios.

This project adheres to the [Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai) proposed by the OpenTelemetry community. You can check out the current definitions [here](src/openlit/semcov/__init__.py).

## What can be Auto Instrumented?

### LLMs
- ✅ OpenAI
- ✅ Anthropic
- ✅ Cohere
- ✅ Mistral
- ✅ Azure OpenAI
- ✅ HuggingFace Transformers

### Vector DBs
- ✅ ChromaDB
- ✅ Pinecone

### Frameworks
- ✅ Langchain
- ✅ LiteLLM

## Supported Destinations
- ✅ OpenTelemetry Collector
- ✅ Grafana Cloud
- ✅ Grafana Tempo
- ✅ DataDog
- ✅ New Relic
- ✅ SigNoz
- ✅ Dynatrace
- ✅ OpenObserve

## 💿 Installation

```bash
pip install openlit
```

## ⚡ Quick Integration

```python
import openlit
openlit.init()
```

By default, OpenLIT directs traces and metrics straight to your console. To forward telemetry data to an HTTP OTLP endpoint, such as the OpenTelemetry Collector, set the `otlp_endpoint` parameter with the desired endpoint. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable as recommended in the OpenTelemetry documentation.

To send telemetry to OpenTelemetry backends requiring authentication, set the `otlp_headers` parameter with its desired value. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_HEADERS` environment variable as recommended in the OpenTelemetry documentation.



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

- 🌟 If you like it, Leave a star on our [GitHub](https://github.com/open-lit/openlit/)
- 🌍 Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) Community for live interactions and questions.
- 🐞 Report bugs on our [GitHub Issues](https://github.com/open-lit/openlit/issues) to help us improve OpenLIT.
- 𝕏 Follow us on [X](https://twitter.com/openlit) for the latest updates and news.