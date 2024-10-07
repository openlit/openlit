<div align="center">
<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%"><h1>
OpenTelemetry GPU Collector</h1>

**[Documentation](https://docs.openlit.io/) | [Quickstart](#-getting-started) | [Python SDK](https://github.com/openlit/openlit/tree/main/sdk/python) | [Metrics](#metrics)**

[![OpenLIT](https://img.shields.io/badge/OpenLIT-orange)](https://github.com/openlit/openlit)
[![License](https://img.shields.io/github/license/openlit/openlit?label=License&logo=github&color=f80&logoColor=white)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/openlit/openlit)](https://github.com/openlit/openlit/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/openlit/openlit)](https://github.com/openlit/openlit/graphs/contributors)

[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![Discord](https://img.shields.io/badge/Discord-7289DA?logo=discord&logoColor=white)](https://discord.gg/rjvTm6zd)
[![X](https://img.shields.io/badge/follow-%40openlit__io-1DA1F2?logo=x&style=social)](https://twitter.com/openlit_io)

</div>

OpenTelemetry GPU Collector is a lightweight, efficient tool designed to collect GPU performancemetrics and send them to an OpenTelemetry-compatible endpoint for monitoring and observability. This tool is particularly useful for monitoring GPUs in high-performance computing environments, AI/ML tasks, and LLMs.

## Features

- Collects detailed GPU performance metrics
- OpenTelemetry-native
- Lightweight and efficient
- Supports multiple GPU and system architectures

## Quick Start

### Prerequisites

- Docker installed on your GPU system

### Installation

You can quickly start using the OTel GPU Collector by pulling the Docker image:

```sh
docker pull ghcr.io/openlit/otel-gpu-collector:latest
```

### Running the Container

Here's a quick example showing how to run the container with the required environment variables:

```sh
docker run --gpus all \
    -e GPU_APPLICATION_NAME='chatbot' \
    -e GPU_ENVIRONMENT='staging' \
    -e OTEL_EXPORTER_OTLP_ENDPOINT="YOUR_OTEL_ENDPOINT" \
    -e OTEL_EXPORTER_OTLP_HEADERS="YOUR_OTEL_HEADERS" \
    ghcr.io/openlit/otel-gpu-collector:latest
```

### Environment Variables

OTel GPU Collector supports several environment variables for configuration. Below is a table that describes each variable:

| Environment Variable            | Description                                                   | Default Value           |
|---------------------------------|---------------------------------------------------------------|-------------------------|
| `GPU_APPLICATION_NAME`          | Name of the application running on the GPU                    | `default_app`           |
| `GPU_ENVIRONMENT`               | Environment name (e.g., staging, production)                  | `production`            |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | OpenTelemetry OTLP endpoint URL                               | (required)              |
| `OTEL_EXPORTER_OTLP_HEADERS`    | Headers for authenticating with the OTLP endpoint             | (required)              |

## Alternative: Using OpenLIT SDK

You can also collect GPU metrics directly using the OpenLIT SDK in your Python application. Here’s an example:

```python
import openlit

openlit.init(collect_gpu_stats=True)
```

For more details, check out the [OpenLIT documentation](https://docs.openlit.io/) or the [SDK source code](https://github.com/openlit/openlit/tree/main/sdk/python).

## Metrics

| Metric Name                         | Description                              | Unit       | Type  | Attributes                                                                                                 |
|-------------------------------------|------------------------------------------|------------|-------|------------------------------------------------------------------------------------------------------------|
| `gpu.utilization`        | GPU Utilization in percentage            | `percent`  | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.enc.utilization`    | GPU encoder Utilization in percentage    | `percent`  | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.dec.utilization`    | GPU decoder Utilization in percentage    | `percent`  | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.temperature`                   | GPU Temperature in Celsius               | `Celsius`       | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.fan_speed`                     | GPU Fan Speed (0-100) as an integer      | `Integer`  | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.memory.available`              | Available GPU Memory in MB               | `MB`       | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.memory.total`                  | Total GPU Memory in MB                   | `MB`       | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.memory.used`                   | Used GPU Memory in MB                    | `MB`       | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.memory.free`                   | Free GPU Memory in MB                    | `MB`       | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.power.draw`                    | GPU Power Draw in Watts                  | `Watt`     | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |
| `gpu.power.limit`                   | GPU Power Limit in Watts                 | `Watt`     | Gauge | `telemetry.sdk.name`, `gen_ai.application_name`, `gen_ai.environment`, `gpu_index`, `gpu_name`, `gpu_uuid` |

## Building the Docker Image

To build the Docker image yourself, you can clone the repository and execute the following commands:

```sh
git clone https://github.com/openlit/openlit.git
cd otel-gpu-collector
docker build -t otel-gpu-collector .
```


## 🌱 Contributing

Whether it's big or small, we love contributions 💚. Check out our [Contribution guide](../../CONTRIBUTING.md) to get started

Unsure where to start? Here are a few ways to get involved:

- Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/rjvTm6zd) community to discuss ideas, share feedback, and connect with both our team and the wider OpenLIT community.

Your input helps us grow and improve, and we're here to support you every step of the way.

## 💚 Community & Support

Connect with OpenLIT community and maintainers for support, discussions, and updates:

- 🌟 If you like it, Leave a star on our [GitHub](https://github.com/openlit/openlit/)
- 🌍 Join our [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ) or [Discord](https://discord.gg/rjvTm6zd) community for live interactions and questions.
- 🐞 Report bugs on our [GitHub Issues](https://github.com/openlit/openlit/issues) to help us improve OpenLIT.
- 𝕏 Follow us on [X](https://twitter.com/openlit_io) for the latest updates and news.

## License

OpenLIT is available under the [Apache-2.0 license](LICENSE).

## Visualize! Analyze! Optimize!

Join us on this voyage to reshape the future of AI Observability. Share your thoughts, suggest features, and explore contributions. Engage with us on [GitHub](https://github.com/openlit/openlit) and be part of OpenLIT's community-led innovation.
