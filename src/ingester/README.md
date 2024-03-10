# Doku Ingester

[![Doku](https://img.shields.io/badge/Doku-orange)](https://github.com/dokulabs/doku)
[![License](https://img.shields.io/github/license/dokulabs/doku?label=license&logo=github&color=f80&logoColor=fff%22%20alt=%22License)](https://github.com/dokulabs/doku/blob/main/LICENSE)
[![Ingester Version](https://img.shields.io/github/tag/dokulabs/doku.svg?&label=Version)](https://github.com/dokulabs/doku/tags)


![Go](https://img.shields.io/badge/golang-black?style=for-the-badge&logo=go)
![Clickhouse](https://img.shields.io/badge/clickhouse-faff69?style=for-the-badge&logo=clickhouse)

Doku Ingester facilitates real-time data ingestion from `dokumetry` [Python](https://github.com/dokulabs/dokumetry-python) and [Node](https://github.com/dokulabs/dokumetry-node) SDKs for Large Language Models (LLM) analytics. It ensures the secure collection of telemetry data, enabling insights on usage patterns, performance metrics, and cost management for LLMs.

## Features

- **High-Performance Data Ingestion**: Optimized for minimum latency LLM Observability data ingestion to support fast-paced environments where response times are pivotal.
- **Secure Authentication**: Robust key-based authentication to safeguard transmission and storage of Generative AI Observability data.
- **Scalable Architecture**: Designed with a scalable mindset to grow with your needs, handling increasing loads smoothly and efficiently.
- **Customizable Caching**: Configurable in-memory caching for improved performance.

## Quick Start

Follow the steps below to get Doku Ingester running in your environment. Both Docker and manual installation options are provided.

### Docker
1. **Pull the Docker image**

    ```bash
    docker pull ghcr.io/dokulabs/doku-ingester:latest
    ```

2. **Run the container with environment variables**

    In this command, replace `"<ClickHouse-URL>"`, `"<ClickHouse-Port>"`, `"<ClickHouse-Database-name>"`, `"<ClickHouse-username>"`, and `"<ClickHouse-password>"` with your actual ClickHouse configuration details.

    ```bash
    docker run -d -p 9044:9044 \
    -e DOKU_DB_HOST="<ClickHouse-URL>" \
    -e DOKU_DB_PORT="<ClickHouse-Port>" \
    -e DOKU_DB_NAME="<ClickHouse-Database-name>" \
    -e DOKU_DB_USER="<ClickHouse-username>" \
    -e DOKU_DB_PASSWORD="<ClickHouse-password>" \
    --name doku_ingester doku-ingester
    ```


You can also use the [Doku Helm Chart](www.github.com/dokulabs/helm) to deploy Doku Ingester in Kubernetes

### Manual Setup (Development)

1. Clone the doku repository 
    ```sh 
    git clone git@github.com:dokulabs/doku.git
    ````
2. Go to the ingester folder
    ```sh 
    cd src/ingester
    ````
3. Build the Go Package
    ```sh 
    go build -o doku-ingester .
    ````
4. **Run the Doku Ingester Go Binary with Environment Variables**

    Before running the following command, ensure you replace `"<ClickHouse-URL>"`, `"<ClickHouse-Port>"`, `"<ClickHouse-Database-name>"`, `"<ClickHouse-username>"`, and `"<ClickHouse-password>"` with your actual values.

    ```sh
    export DOKU_DB_HOST="<ClickHouse-URL>"
    export DOKU_DB_PORT="<ClickHouse-Port>"
    export DOKU_DB_NAME="<ClickHouse-Database-name>"
    export DOKU_DB_USER="<ClickHouse-Username>"
    export DOKU_DB_PASSWORD="<ClickHouse-Password>"
    ./doku-ingester
    ```

## Configuration

To configure Doku Ingester, you can pass the following environment values, each tailored to suit your infrastructure and operational preferences. This customization allows Doku Ingester to seamlessly integrate with your existing setup and respond to its demands effectively.


| Variable                | Description                                                                                                   | Default Value                                                                   | Required | Example                                |
|-------------------------|---------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|:--------:|----------------------------------------|
| `DOKU_DB_HOST`          | Host address of the ClickHouse server for Doku to connect to.                                                 |                                                                                 |    ✓     | `127.0.0.1`                            |
| `DOKU_DB_PORT`          | Port on which ClickHouse listens.                                                                             |                                                                                 |    ✓     | `9000`                                 |
| `DOKU_DB_NAME`          | Database name in ClickHouse to be used by Doku.                                                               |                                                                                 |    ✓     | `default`                              |
| `DOKU_DB_USER`          | Username for authenticating with ClickHouse.                                                                  |                                                                                 |    ✓     | `default`                              |
| `DOKU_DB_PASSWORD`      | Password for authenticating with ClickHouse.                                                                  |                                                                                 |    ✓     | `DOKU`                                 |
| `DOKU_PRICING_JSON_URL` | URL of the JSON file containing LLM Pricing data.                                                             | `https://raw.githubusercontent.com/dokulabs/ingester/main/assets/pricing.json` |          | `<URL>`                                |
| `DOKU_DB_MAX_IDLE_CONNS`| Maximum number of concurrent idle database connections.                                                       | `10`                                                                            |          | `10`                                   |
| `DOKU_DB_MAX_OPEN_CONNS`| Maximum number of concurrent open database connections.                                                       | `20`                                                                            |          | `20`                                   |
| `DOKU_DB_RETENTION_PERIOD` | TTL for data in ClickHouse.                                                                                  | `6 MONTH`                                                                       |          | `"6 MONTH"`                            |

For more detailed information on configuration options and additional settings, please visit the Doku documentation page: [Doku Configuration Details](https://docs.dokulabs.com/latest/configuration).

## Security

Doku Ingester uses key based authentication mechanism to ensure the security of your data. Be sure to keep your API keys confidential and manage permissions diligently. Refer to our [Security Policy](SECURITY)

## Contributing

We welcome contributions to the Doku Ingester project. Please refer to [CONTRIBUTING](CONTRIBUTING) for detailed guidelines on how you can participate.

## License

Doku Ingester is available under the [Apache-2.0 license](LICENSE).

## Support

For support, issues, or feature requests, submit an issue through the [GitHub issues](https://github.com/dokulabs/ingester/issues) associated with this repository.