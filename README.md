<div align="center">

# Doku: Open Source Observability for LLMs

[![Doku](https://img.shields.io/badge/Doku-orange)](https://github.com/dokulabs/doku)
[![Documentation](https://img.shields.io/badge/Documentation-orange?logo=Google-Docs&logoColor=white)](https://docs.dokulabs.com/)
[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/doku-0tq5728/shared_invite/zt-2a9aql9xx-FN5EIZ2DtZ~XtJoYdxUDtA)
[![License](https://img.shields.io/github/license/dokulabs/doku?label=License&logo=github&color=f80&logoColor=white)](https://github.com/dokulabs/doku/blob/main/LICENSE)
[![Downloads](https://static.pepy.tech/badge/dokumetry/month)](https://pepy.tech/project/dokumetry)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/dokulabs/doku)](https://github.com/dokulabs/doku/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/dokulabs/doku)](https://github.com/dokulabs/doku/graphs/contributors)
[![Helm Version](https://img.shields.io/github/tag/dokulabs/helm.svg?&label=Chart%20Version&logo=helm)](https://github.com/dokulabs/helm/tags)
[![Python Library Version](https://img.shields.io/github/tag/dokulabs/dokumetry-python.svg?&label=dokumetry%20version&logo=pypi)](https://pypi.org/project/dokumetry/)
[![NPM Package Version](https://img.shields.io/github/tag/dokulabs/dokumetry-node.svg?&label=dokumetry%20version&logo=npm)](https://www.npmjs.com/package/dokumetry)

</div>



Doku is an **open-source LLMOps tool** engineered to enables developers with comprehensive capabilities to monitor, analyze, and optimize LLM applications. It provides valuable real-time data on **LLM usage, performance, and costs**. Through seamless integrations with leading LLM platforms, including OpenAI, Cohere, and Anthropic, Doku acts as a central command center for all your LLM needs. It effectively guides your efforts, ensuring that your LLM applications not only operate at peak efficiency but also scale successfully.

## Why use Doku?
Get advanced monitoring and evaluation for your LLM applications with these key benefits:

- **Granular Usage Insights of your LLM Applications**: Assess your LLM's performance and costs with fine-grained control, breaking down metrics by environment (such as staging or production) or application, to optimize for efficiency and scalability.
- **Real-Time Data Streaming**: Unlike other platforms where you might wait minutes to see your data due to data being sent in batches, Doku is able to display data as it streams. This immediate insight enables quick decision-making and adjustments.
- **Zero Added Latency**: Doku's smart data handling ensures rapid data processing without impacting your application's performance, maintaining the responsiveness of your LLM applications.
- **Connect to Observability Platforms**: Doku seamlessly connects with leading observability platforms like Grafana Cloud and Datadog, among others to automatically export data. 

## How it works?
![How it Works?](https://raw.githubusercontent.com/dokulabs/.github/main/profile/assets/banner.gif)

### Step 1: Instrument your Application
Integrating the `dokumetry` SDK into LLM applications is straightforward with SDKs designed for Python and NodeJS. Start monitoring for your LLM Application with just **two lines of code**: 

For Python
```python python
import dokumetry

dokumetry.init(llm=openai, doku_url="YOUR_DOKU_URL", api_key="YOUR_DOKU_TOKEN")
```
For NodeJS

```javascript 
import DokuMetry from 'dokumetry';

DokuMetry.init({llm: openai, dokuUrl: "YOUR_DOKU_URL", apiKey: "YOUR_DOKU_TOKEN"})
```

### Step 2: Data processed by Doku Ingester
Once the `dokumetry` SDKs are configured in your LLM application, Monitoring data starts streaming to the [Doku Ingester](https://github.com/dokulabs/doku/tree/main/src/ingester#readme). It processes and safely stores your data in ClickHouse, keeping your LLM Monitoring data **secure** and **compliant** in your environment.

You can choose to use a new ClickHouse database setup or connect to your existing one to work with Doku. 

### Step 3: Visualize in your Observability Platform
With your LLM monitoring data processed, connect Doku to your preferred Observability Platform to begin visualizing and analyzing your data in-depth.

Stay tuned for the upcoming release of Doku UI, enhancing your data visualization capabilities further.

## 🚀 Getting Started with Doku

Jumpstart your journey with Doku by deploying it via our Helm chart, designed to simplify the installation process on any Kubernetes cluster.

### Docker 
1. Create `docker-compose.yml`
```yaml
version: '3.8'

services:
  clickhouse:
    image: clickhouse/clickhouse-server:24.1.5
    container_name: clickhouse
    environment:
      CLICKHOUSE_PASSWORD: ${DOKU_DB_PASSWORD:-DOKU}   
      CLICKHOUSE_USER: ${DOKU_DB_USER:-default}                   
    volumes:
      - clickhouse-data:/var/lib/clickhouse
    ports:
      - "${DOKU_DB_PORT:-9000}:9000" 
    restart: always

  doku-ingester:
    image: ghcr.io/patcher99/doku-ingester:0.0.8
    container_name: doku-ingester
    environment:
      DOKU_DB_HOST: clickhouse   
      DOKU_DB_PORT: ${DOKU_DB_PORT:-9000} 
      DOKU_DB_NAME: ${DOKU_DB_NAME:-default}     
      DOKU_DB_USER: ${DOKU_DB_USER:-default}              
      DOKU_DB_PASSWORD: ${DOKU_DB_PASSWORD:-DOKU}
    ports:
      - "9044:9044"           
    depends_on:
      - clickhouse
    restart: always

volumes:
  clickhouse-data:
```

2. Start Docker Compose
```shell
docker-compose up -d
```
### Kubernetes 

To install the Doku Helm chart, follow these steps:

1. Add the Doku Helm repository to your Helm setup:

```shell
helm repo add dokulabs https://dokulabs.github.io/helm/
```

2. Update your Helm repositories to fetch the latest chart information:

```shell
helm repo update
```

3. Install the Doku chart with the release name `doku`:

```shell
helm install doku dokulabs/doku
```

For a detailed list of configurable parameters for the Helm chart, refer to the `values.yaml` file in the [Helm chart](https://github.com/dokulabs/doku/tree/main/helm/doku).

### 🔑 Generating an API Key

With Doku running, the next step is to generate an API key for secure communication between your applications and Doku.

To generate your first API key, you can use the following command:

```shell shell
curl --request POST \
  --url https://<YOUR_DOKU_INGESTER_URL>/api/keys \
  --header 'Authorization: ""' \
  --header 'Content-Type: application/json' \
  --data '{
  "name": "Patcher"
  }'
```

**Note**: 
> **Save the API Key** — This key is essential for configuring the `dokumetry` SDK. 

> For your first API call to generate the key, the Authorization header should be left blank. However, remember to include this API key in the Authorization header for all future API interactions and SDK configurations.

### ⚡️ Instrument your Application

Choose the appropriate SDK for your LLM application's programming language and follow the steps to integrate monitoring with just **two lines of code**.

#### Python

Install the `dokumetry` [Python SDK](https://pypi.org/project/dokumetry/) using pip:

```shell
pip install dokumetry
```

Add the following two lines to your application code:

```python
import dokumetry

dokumetry.init(llm=client, doku_url="YOUR_DOKU_INGESTER_URL", api_key="YOUR_DOKU_TOKEN")
```

##### Example Usage for monitoring `OpenAI` Usage:

```python
from openai import OpenAI
import dokumetry

client = OpenAI(
    api_key="YOUR_OPENAI_KEY"
)

# Pass the above `client` object along with your DOKU URL and API key and this will make sure that all OpenAI calls are automatically tracked.
dokumetry.init(llm=client, doku_url="YOUR_DOKU_INGESTER_URL", api_key="YOUR_DOKU_TOKEN")

chat_completion = client.chat.completions.create(
    messages=[
        {
            "role": "user",
            "content": "What is LLM Observability",
        }
    ],
    model="gpt-3.5-turbo",
)
```

Refer to the `dokumetry` [Python SDK repository](https://github.com/dokulabs/dokumetry-python) for more advanced configurations and use cases.

#### Node

Install the `dokumetry` [NodeJS SDK](https://www.npmjs.com/package/dokumetry) using npm:

```shell
npm install dokumetry
```

Add the following two lines to your application code:

```javascript
import DokuMetry from 'dokumetry';

DokuMetry.init({llm: openai, dokuUrl: "YOUR_DOKU_INGESTER_URL", apiKey: "YOUR_DOKU_TOKEN"})
```

##### Example Usage for monitoring `OpenAI` Usage:

```javascript
import OpenAI from 'openai';
import DokuMetry from 'dokumetry';

const openai = new OpenAI({
  apiKey: 'My API Key', // defaults to process.env["OPENAI_API_KEY"]
});

// Pass the above `openai` object along with your DOKU URL and API key and this will make sure that all OpenAI calls are automatically tracked.
DokuMetry.init({llm: openai, dokuUrl: "YOUR_DOKU_INGESTER_URL", apiKey: "YOUR_DOKU_TOKEN"})

async function main() {
  const chatCompletion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: 'What are the key to effective observability?' }],
    model: 'gpt-3.5-turbo',
  });
}

main();
```

Refer to the `dokumetry` [NodeJS SDK repository](https://github.com/dokulabs/dokumetry-node) for more advanced configurations and use cases.

## Security

Doku uses key based authentication mechanism to ensure the security of your data and as Doku is self-hosted, The data stays within your environment.

## Contributing

We welcome contributions to the Doku project. Please refer to [CONTRIBUTING](CONTRIBUTING) for detailed guidelines on how you can participate.

## License

Doku is available under the [Apache-2.0 license](LICENSE).

## Support

For support, issues, or feature requests, submit an issue through the [GitHub issues](https://github.com/dokulabs/doku/issues) associated with this repository.

## Visualize! Analyze! Optimize!

Join us on this voyage to reshape the future of AI insights. Share your thoughts, suggest features, and explore contributions. Engage with us on [GitHub](https://github.com/dokulabs/doku) and be part of Doku's community-led innovation.
