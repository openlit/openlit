# Doku Ingester
[![Doku](https://img.shields.io/badge/Doku-orange)](https://github.com/dokulabs/doku)
[![License](https://img.shields.io/github/license/dokulabs/doku?label=license&logo=github&color=f80&logoColor=fff%22%20alt=%22License)](https://github.com/dokulabs/doku/blob/main/LICENSE)
[![Ingester Version](https://img.shields.io/github/tag/dokulabs/doku.svg?&label=Version)](https://github.com/dokulabs/doku/tags)

Doku Ingester is an integral part of Doku's LLM Observability tools, facilitating real-time data ingestion from `dokumetry` [Python](https://github.com/dokulabs/dokumetry-python) and [Node](https://github.com/dokulabs/dokumetry-node) SDKs for Large Language Models (LLM) analytics. It ensures the secure collection of telemetry data, enabling insights on usage patterns, performance metrics, and cost management for LLMs.

## Features

- **High-Performance Data Ingestion**: Optimized for minimum latency LLM Observability data ingestion to support fast-paced environments where response times are pivotal.
- **Secure Authentication**: Robust key-based authentication to safeguard transmission and storage of Generative AI Observability data.
- **Scalable Architecture**: Designed with a scalable mindset to grow with your needs, handling increasing loads smoothly and efficiently.
- **Customizable Caching**: Configurable in-memory caching for improved performance.

## Quick Start

To start using Doku Ingester, ensure you have Docker installed and configured on your machine. Create a config file as shown in in this [example](./assets/example-config.yml). Then Clone the repository and follow the steps below:

### Docker
```bash
# Clone the repository
git clone https://github.com/dokulabs/ingester.git

# Build the Docker image
docker build -t doku-ingester .

# Run the container
docker run -d -p 9044:9044 --name doku_ingester doku-ingester --config <path-to-config>.yml
```

### Go

```bash
# Clone the repository and use `src` directory
git clone https://github.com/dokulabs/doku.git
cd src/ingester

# Build the Go Package
go build -o doku-ingester .

# Run the Doku Ingester Go Binary
./doku-ingester --config <path-to-config>.yml
```

## Configuration

Before running the Ingester, configure the following environment variables:

| Variable            | Description                   | Example Value      |
|---------------------|-------------------------------|--------------------|
| `DB_NAME`           | The database name             | postgres           |
| `DB_USER`           | The database user             | admin              |
| `DB_PASSWORD`       | The database password         | tsdbpassword       |
| `DB_HOST`           | The database host             | 127.0.0.1          |
| `DB_PORT`           | The database port             | 5432               |
| `DB_SSLMODE`        | The SSL mode for the database | require            |
| `DATA_TABLE_NAME`   | The name of the data table    | DOKU               |
| `APIKEY_TABLE_NAME` | The name of the API key table | APIKEYS            |
| `DB_MAX_OPEN_CONNS` | Max open database connections | 10                 |
| `DB_MAX_IDLE_CONNS` | Max idle database connections | 5                  |

Adapt these settings to match your database configuration.

## Optional: Data Export Configuration

To export data from Doku to your observability platform, first set the `OBSERVABILITY_PLATFORM` environment variable. Depending on the specified platform, additional configuration environment variables may be required.

### Observability Platform Settings

Set up the `OBSERVABILITY_PLATFORM` to your chosen platform. Currently supported options include:

- `GRAFANA` for Grafana Cloud.

Based on your selection, provide the additional required environment variables as follows.

#### Grafana Cloud

If exporting to Grafana Cloud, set the following environment variables:

| Variable                 | Description                                   | Example Value                                   |
|--------------------------|-----------------------------------------------|-------------------------------------------------|
| `OBSERVABILITY_PLATFORM` | The observability platform to use             | `GRAFANA`                                       |
| `GRAFANA_LOGS_USER`      | The username for Grafana Loki                 | `121313`                                        |
| `GRAFANA_LOKI_URL`       | The URL of the Grafana CLoud Loki instance    | `https://logs-xx.grafana.net/loki/api/v1/push`  |
| `GRAFANA_ACCESS_TOKEN`   | The access token for Grafana Cloud            | `glc_eyxxxxxxxxxxxxx`                           |

## Security

Doku Ingester uses key based authentication mechanism to ensure the security of your data. Be sure to keep your API keys confidential and manage permissions diligently. Refer to our [Security Policy](SECURITY)

## Contributing

We welcome contributions to the Doku Ingester project. Please refer to [CONTRIBUTING](CONTRIBUTING) for detailed guidelines on how you can participate.

## License

Doku Ingester is available under the [Apache-2.0 license](LICENSE).

## Support

For support, issues, or feature requests, submit an issue through the [GitHub issues](https://github.com/dokulabs/ingester/issues) associated with this repository.