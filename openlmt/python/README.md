# Doku Python SDK - dokumetry

[![Doku Python Package](https://img.shields.io/badge/Doku-orange)](https://github.com/dokulabs/doku)
[![Documentation](https://img.shields.io/badge/Documentation-orange?logo=Google-Docs&logoColor=white)](https://docs.dokulabs.com/)
[![License](https://img.shields.io/github/license/dokulabs/dokumetry-python?label=license&logo=github&color=f80&logoColor=fff%22%20alt=%22License)](https://github.com/dokulabs/dokumetry-python/blob/main/LICENSE)
[![Downloads](https://static.pepy.tech/badge/dokumetry/month)](https://pepy.tech/project/dokumetry)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/dokulabs/dokumetry-python)](https://github.com/dokulabs/dokumetry-python/pulse)
[![GitHub Contributors](https://img.shields.io/github/contributors/dokulabs/dokumetry-python)](https://github.com/dokulabs/dokumetry-python/graphs/contributors)

[![Library Version](https://img.shields.io/github/tag/dokulabs/dokumetry-python.svg?&label=Library%20Version&logo=python)](https://github.com/dokulabs/dokumetry-python/tags)

[![Tests](https://github.com/dokulabs/dokumetry-python/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/dokulabs/dokumetry-python/actions/workflows/tests.yml)
[![Pylint](https://github.com/dokulabs/dokumetry-python/actions/workflows/pylint.yml/badge.svg?branch=main)](https://github.com/dokulabs/dokumetry-python/actions/workflows/pylint.yml)
[![CodeQL](https://github.com/dokulabs/dokumetry-python/actions/workflows/github-code-scanning/codeql/badge.svg?branch=main)](https://github.com/dokulabs/dokumetry-python/actions/workflows/github-code-scanning/codeql)

[Doku Python SDK](https://pypi.org/project/dokumetry/) (`dokumetry`) is your workhorse for collecting and transmitting language learning model (LLM) usage data and metrics with zero added latency. Simplicity is at the core of `dokumetry`, enabling you to kickstart comprehensive LLM observability with just two lines of code. It’s designed to blend seamlessly into your projects, supporting integration with leading LLM platforms:

- ✅ OpenAI
- ✅ Anthropic
- ✅ Cohere
- ✅ Mistral
- ✅ Azure OpenAI

Deployed as the backbone for all your LLM monitoring needs, `dokumetry` channels crucial usage data directly to Doku, streamlining the tracking process. Unlock efficient and effective observability for your LLM applications with DokuMetry.

## 🔥 Features

- **Effortless Integration:** With `dokumetry`, observability comes easy. Elevate your LLM observability by integrating this powerhouse into your projects using just two lines of code. 

- **Zero Latency Impact:** We value the performance of your applications. `dokumetry` is engineered to capture and send data without hampering your application’s speed, ensuring a seamless user experience.

- - **Customizable Data Labeling:** Enhance your LLM analytics with customizable environment and application tags. `dokumetry` allows you to append these labels to your data, offering you the capability to sift through your observability data with ease. Drill down and view metrics in Doku, segmented by these specific tags for a more insightful analysis.

## 💿 Installation

```bash
pip install dokumetry
```

## ⚡️ Quick Start

### OpenAI

```
from openai import OpenAI
import dokumetry

client = OpenAI(
    api_key="YOUR_OPENAI_KEY"
)

# Pass the above `client` object along with your Doku Ingester URL and API key and this will make sure that all OpenAI calls are automatically tracked.
dokumetry.init(llm=client, doku_url="YOUR_INGESTER_DOKU_URL", api_key="YOUR_DOKU_TOKEN")

chat_completion = client.chat.completions.create(
    messages=[
        {
            "role": "user",
            "content": "What is LLM Observability and Monitoring?",
        }
    ],
    model="gpt-3.5-turbo",
)
```

### Anthropic

```
from anthropic import Anthropic
import dokumetry

client = Anthropic(
  # This is the default and can be omitted
  api_key="YOUR_ANTHROPIC_API_KEY",
)

# Pass the above `client` object along with your Doku Ingester URL and API key and this will make sure that all Anthropic calls are automatically tracked.
dokumetry.init(llm=client, doku_url="YOUR_INGESTER_DOKU_URL", api_key="YOUR_DOKU_TOKEN")

message = client.messages.create(
  max_tokens=1024,
  messages=[
      {
          "role": "user",
          "content": "What is LLM Observability and Monitoring?",
      }
  ],
  model="claude-3-opus-20240229",
)
print(message.content)

```

### Cohere

```
import cohere
import dokumetry

# initialize the Cohere Client with an API Key
co = cohere.Client('YOUR_COHERE_API_KEY')

# Pass the above `co` object along with your Doku Ingester URL and API key and this will make sure that all Cohere calls are automatically tracked.
dokumetry.init(llm=co, doku_url="YOUR_INGESTER_DOKU_URL", api_key="YOUR_DOKU_TOKEN")

# generate a prediction for a prompt
prediction = co.chat(message='What is LLM Observability and Monitoring?', model='command')

# print the predicted text
print(f'Chatbot: {prediction.text}')
```

## Supported Parameters

| Parameter         | Description                                               | Required      |
|-------------------|-----------------------------------------------------------|---------------|
| llm               | Language Learning Model (LLM) Object to track             | Yes           |
| doku_url          | URL of your Doku Instance                                 | Yes           |
| api_key           | Your Doku API key                                         | Yes           |
| environment       | Custom environment tag to include in your metrics         | Optional      |
| application_name  | Custom application name tag for your metrics              | Optional      |
| skip_resp         | Skip response from the Doku Ingester for faster execution | Optional      |


## Semantic Versioning
This package generally follows [SemVer](https://semver.org/spec/v2.0.0.html) conventions, though certain backwards-incompatible changes may be released as minor versions:

Changes that only affect static types, without breaking runtime behavior.
Changes to library internals which are technically public but not intended or documented for external use. (Please open a GitHub issue to let us know if you are relying on such internals).
Changes that we do not expect to impact the vast majority of users in practice.
We take backwards-compatibility seriously and work hard to ensure you can rely on a smooth upgrade experience.

## Requirements
Python >= 3.7 is supported.

If you are interested in other runtime environments, please open or upvote an issue on GitHub.

## Security

Doku Python Library (`dokumetry`) sends the observability data over HTTP/HTTPS to the Doku Ingester which uses key based authentication mechanism to ensure the security of your data. Be sure to keep your API keys confidential and manage permissions diligently. Refer to our [Security Policy](SECURITY)

## Contributing

We welcome contributions to the Doku Python Library (`dokumetry`) project. Please refer to [CONTRIBUTING](CONTRIBUTING) for detailed guidelines on how you can participate.

## License

Doku Python Library (`dokumetry`) is available under the [Apache-2.0 license](LICENSE).

## Support

For support, issues, or feature requests, submit an issue through the [GitHub issues](https://github.com/dokulabs/doku/issues) associated with the Doku Repository and add `dokumetry-python` label.
