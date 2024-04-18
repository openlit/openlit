<div align="center">
<img src="https://github.com/dokulabs/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="Doku Logo" width="30%"><h1>
OpenTelemetry-native LLM Application Observability</h1>

<!-- **[Documentation](https://docs.dokulabs.com/) | [Quickstart](#-getting-started-with-doku) | [Python SDK](https://github.com/dokulabs/dokumetry-python) | [Node SDK](https://github.com/dokulabs/dokumetry-node) | [Helm Chart](https://github.com/dokulabs/helm)** -->

<!-- [![Doku](https://img.shields.io/badge/Doku-orange)](https://github.com/dokulabs/doku)
[![License](https://img.shields.io/github/license/dokulabs/doku?label=License&logo=github&color=f80&logoColor=white)](https://github.com/dokulabs/doku/blob/main/LICENSE)
[![Downloads](https://static.pepy.tech/badge/dokumetry/month)](https://pepy.tech/project/dokumetry)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/dokulabs/doku)](https://github.com/dokulabs/doku/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/dokulabs/doku)](https://github.com/dokulabs/doku/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/dokulabs/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![X](https://img.shields.io/badge/follow-%40dokulabs-1DA1F2?logo=x&style=social)](https://twitter.com/doku_labs)

[![Doku Version](https://img.shields.io/github/tag/dokulabs/doku.svg?&label=Doku%20Version&logo=docker)](https://github.com/dokulabs/doku/tags)
[![Helm Version](https://img.shields.io/github/tag/dokulabs/helm.svg?&label=Chart%20Version&logo=helm)](https://github.com/dokulabs/helm/tags)
[![Python Library Version](https://img.shields.io/github/tag/dokulabs/dokumetry-python.svg?&label=dokumetry%20version&logo=python)](https://pypi.org/project/dokumetry/)
[![NPM Package Version](https://img.shields.io/github/tag/dokulabs/dokumetry-node.svg?&label=dokumetry%20version&logo=npm)](https://www.npmjs.com/package/dokumetry) -->

</div>

OpenLIT is an **OpenTelemetry-native** GenAI and LLM Application Observability tool. It's designed to make the integration process of observability into GenAI projects as easy as pie – literally, with just **a single line of code**. Whether you're working with popular LLM Libraries such as OpenAI and HuggingFace or leveraging vector databases like ChromaDB, OpenLIT ensures your applications are monitored seamlessly, providing critical insights to improve performance and reliability.

This project proudly follows the [Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai) of the OpenTelemetry community, consistently updating to align with the latest standards in observability.

## What is LIT?
LIT stands for Learning Interpretability Tool. It refers to a visual, interactive model-understanding and data visualization tool ad  a term introduced by [Google](https://developers.google.com/machine-learning/glossary#learning-interpretability-tool-lit).

## Features
- **OpenTelemetry-native**: Native support ensures that integrating OpenLIT into your projects feels more like a natural extension rather than an additional layer of complexity.
- **Granular Usage Insights of your LLM Applications**: Assess your LLM's performance and costs with fine-grained control, breaking down metrics by environment (such as staging or production) or application, to optimize for efficiency and scalability.
- **Vendor-Neutral SDKs**: In the spirit of OpenTelemetry, OpenLIT's SDKs are agnostic of the backend vendors. This means you can confidently use OpenLIT with various telemetry backends, like Grafana Tempo, without worrying about compatibility issues.

## 🚀 Getting Started

## Step 1: Install OpenLIT SDK

```bash
pip install openlit
```

### Step 2: Instrument your Application
Integrating the OpenLIT into LLM applications is straightforward. Start monitoring for your LLM Application with just **one line of code**: 

For Python
```python python
import openlit

openlit.init()
```

This will Auto instrument you code for collecting LLM Observability data.

### Step 2: Send to OTLP Backend

By default, OpenLIT directs traces and metrics straight to your console. To forward telemetry data to an HTTP OTLP endpoint, such as the OpenTelemetry Collector, set the `otlp_endpoint` parameter with the desired endpoint. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable as recommended in the OpenTelemetry documentation.

To send telemetry to OpenTelemetry backends requiring authentication, set the `otlp_headers` parameter with its desired value. Alternatively, you can configure the endpoint by setting the `OTEL_EXPORTER_OTLP_HEADERS` environment variable as recommended in the OpenTelemetry documentation.

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

## License

OpenLIT is available under the [Apache-2.0 license](LICENSE).

## Visualize! Analyze! Optimize!

Join us on this voyage to reshape the future of AI Observability. Share your thoughts, suggest features, and explore contributions. Engage with us on [GitHub](https://github.com/open-lit/openlit) and be part of OpenLIT's community-led innovation.
