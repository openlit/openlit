<div align="center">
<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%"><h1>
OpenTelemetry Auto-Instrumentation for GenAI & LLM Applications</h1>

**[Documentation](https://docs.openlit.io/) | [Quickstart](#-getting-started) | [Typescript SDK](https://github.com/openlit/openlit/tree/main/sdk/typescript)**

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://github.com/openlit/openlit)
[![License](https://img.shields.io/github/license/openlit/openlit?label=License&logo=github&color=f80&logoColor=white)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![Downloads](https://img.shields.io/npm/dm/%40openlit%2Fts)](https://www.npmjs.com/package/@openlit/ts)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/openlit/openlit)](https://github.com/openlit/openlit/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/openlit/openlit)](https://github.com/openlit/openlit/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![Discord](https://img.shields.io/badge/Discord-7289DA?logo=discord&logoColor=white)](https://discord.gg/CQnXwNT3)
[![X](https://img.shields.io/badge/follow-%40openlit__io-1DA1F2?logo=x&style=social)](https://twitter.com/openlit_io)

![OpenLIT Connections Banner](https://github.com/openlit/.github/blob/main/profile/assets/github-readme-connections-banner.png?raw=true)

</div>

OpenLIT Typescript SDK is an **OpenTelemetry-native** Auto instrumentation library for monitoring LLM Applications, facilitating the integration of observability into your GenAI-driven projects. Designed with simplicity and efficiency, OpenLIT offers the ability to embed observability into your GenAI-driven projects effortlessly using just **a single line of code**.

Whether you're directly using LLM Libraries like OpenAI or Anthropic, OpenLIT seamlessly integrates observability into your applications, ensuring enhanced performance and reliability across diverse scenarios.

This project adheres to the [Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai) proposed by the OpenTelemetry community. You can check out the current definitions [here](src/semantic-convention.ts).

## Auto Instrumentation Capabilities

| LLMs                                                                  |
| --------------------------------------------------------------------- | 
| [✅ OpenAI](https://docs.openlit.io/latest/integrations/openai)       | [✅ ChromaDB](https://docs.openlit.io/latest/integrations/chromadb) | [✅ LiteLLM](https://docs.openlit.io/latest/integrations/litellm) |     |
| [✅ Anthropic](https://docs.openlit.io/latest/integrations/anthropic) |

## Supported Destinations

- [✅ OpenTelemetry Collector](https://docs.openlit.io/latest/connections/otelcol)
- [✅ Prometheus + Tempo](https://docs.openlit.io/latest/connections/prometheus-tempo)
- [✅ Prometheus + Jaeger](https://docs.openlit.io/latest/connections/prometheus-jaeger)
- [✅ Grafana Cloud](https://docs.openlit.io/latest/connections/grafanacloud)
- [✅ New Relic](https://docs.openlit.io/latest/connections/new-relic)
- [✅ Elastic](https://docs.openlit.io/latest/connections/elastic)
- [✅ HyperDX](https://docs.openlit.io/latest/connections/hyperdx)
- [✅ DataDog](https://docs.openlit.io/latest/connections/datadog)
- [✅ SigNoz](https://docs.openlit.io/latest/connections/signoz)
- [✅ OneUptime](https://docs.openlit.io/latest/connections/oneuptime)
- [✅ Dynatrace](https://docs.openlit.io/latest/connections/dynatrace)
- [✅ OpenObserve](https://docs.openlit.io/latest/connections/openobserve)
- [✅ Highlight.io](https://docs.openlit.io/latest/connections/highlight)

## 💿 Installation

```bash
npm install @openlit/ts
```

## 🚀 Getting Started

### Step 1: Install OpenLIT

Open your command line or terminal and run:

```bash
npm install @openlit/ts
```

### Step 2: Initialize OpenLIT in your Application

Integrating the OpenLIT into LLM applications is straightforward. Start monitoring for your LLM Application with just **two lines of code**:

```typescript
import Openlit from '@openlit/ts';

Openlit.init();
```

To forward telemetry data to an HTTP OTLP endpoint, such as the OpenTelemetry Collector, set the `otlpEndpoint` parameter with the desired endpoint. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable as recommended in the OpenTelemetry documentation.

> 💡 Info: If you dont provide `otlpEndpoint` function argument or set the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable, OpenLIT directs the trace directly to your console, which can be useful during development.

To send telemetry to OpenTelemetry backends requiring authentication, set the `otlpHeaders` parameter with its desired value. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_HEADERS` environment variable as recommended in the OpenTelemetry documentation.

#### Example

---

<details>
  <summary>Initialize using Function Arguments</summary>
  
  ---

Add the following two lines to your application code:

```typescript
import Openlit from '@openlit/ts';

Openlit.init({ 
  otlpEndpoint: 'YOUR_OTEL_ENDPOINT',
  otlpHeaders: 'YOUR_OTEL_ENDPOINT_AUTH'
});
```

</details>

---

<details>

  <summary>Initialize using Environment Variables</summary>

---

Add the following two lines to your application code:

```typescript
import Openlit from "@openlit/ts"

Openlit.init()
```

Then, configure the your OTLP endpoint using environment variable:

```env
export OTEL_EXPORTER_OTLP_ENDPOINT = "YOUR_OTEL_ENDPOINT"
export OTEL_EXPORTER_OTLP_HEADERS = "YOUR_OTEL_ENDPOINT_AUTH"
```

</details>

---

### Step 3: Visualize and Optimize!

With the LLM Observability data now being collected and sent to OpenLIT, the next step is to visualize and analyze this data to get insights into your LLM application’s performance, behavior, and identify areas of improvement.

To begin exploring your LLM Application's performance data within the OpenLIT UI, please see the [Quickstart Guide](https://docs.openlit.io/latest/quickstart).

If you want to integrate and send metrics and traces to your existing observability tools, refer to our [Connections Guide](https://docs.openlit.io/latest/connections/intro) for detailed instructions.

![](https://github.com/openlit/.github/blob/main/profile/assets/openlit-client-1.png?raw=true)

### Configuration

Below is a detailed overview of the configuration options available, allowing you to adjust OpenLIT's behavior and functionality to align with your specific observability needs:

| Argument                 | Description                                                                          | Default Value                                                      | Required |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| `environment`            | The deployment environment of the application.                                       | `"default"`                                                        | No      |
| `applicationName`       | Identifies the name of your application.                                             | `"default"`                                                        | No      |
| `tracer`                 | An instance of OpenTelemetry Tracer for tracing operations.                          | `undefined`                                                             | No       |
| `otlpEndpoint`          | Specifies the OTLP endpoint for transmitting telemetry data.                         | `undefined`                                                             | No       |
| `otlpHeaders`           | Defines headers for the OTLP exporter, useful for backends requiring authentication. | `undefined`                                                             | No       |
| `disableBatch`          | A flag to disable batch span processing, favoring immediate dispatch.                | `true`                                                            | No       |
| `traceContent`          | Enables tracing of content for deeper insights.                                      | `true`                                                             | No       |
| `disabledInstrumentations` | List of instrumentations to disable.                                                    | `undefined`                                                             | No       |
| `instrumentations`        | Object of instrumentation modules for manual patching                                          | `undefined`                                                            | No       |
| `pricing_json`           | URL or file path of the pricing JSON file.                                           | `https://github.com/openlit/openlit/blob/main/assets/pricing.json` | No       |

## 🌱 Contributing

Whether it's big or small, we love contributions 💚. Check out our [Contribution guide](../../CONTRIBUTING.md) to get started

Unsure where to start? Here are a few ways to get involved:

- Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/rjvTm6zd) community to discuss ideas, share feedback, and connect with both our team and the wider OpenLIT community.

Your input helps us grow and improve, and we're here to support you every step of the way.

## 💚 Community & Support

Connect with the OpenLIT community and maintainers for support, discussions, and updates:

- 🌟 If you like it, Leave a star on our [GitHub](https://github.com/openlit/openlit/)
- 🌍 Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/CQnXwNT3) community for live interactions and questions.
- 🐞 Report bugs on our [GitHub Issues](https://github.com/openlit/openlit/issues) to help us improve OpenLIT.
- 𝕏 Follow us on [X](https://x.com/openlit_io) for the latest updates and news.
