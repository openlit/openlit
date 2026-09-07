<div align="center">

<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%">

# Open-source observability & evaluation for AI agents

**Trace, evaluate, debug, and optimize AI applications and coding agents with OpenTelemetry.**

<a href="https://docs.openlit.io/latest/features/agent-observability">
  <img src="docs/images/docs-ai-observability-trace.png" alt="OpenLIT agent trace view" width="90%">
</a>

<p>
<a href="https://github.com/openlit/openlit/stargazers"><b>⭐ Star</b></a>&nbsp;&nbsp;&nbsp;&nbsp;
<a href="#-get-started-in-5-minutes"><b>🚀 Quickstart</b></a>&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://docs.openlit.io/"><b>📚 Docs</b></a>
</p>

[![Documentation](https://img.shields.io/badge/docs-openlit.io-blue)](https://docs.openlit.io/)
[![License](https://img.shields.io/github/license/openlit/openlit)](https://github.com/openlit/openlit/blob/main/LICENSE)
[![Downloads](https://static.pepy.tech/badge/openlit/month)](https://pepy.tech/project/openlit)
[![Slack](https://img.shields.io/badge/Slack-join-purple?logo=slack)](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
[![X](https://img.shields.io/badge/follow-%40openlit__io-black?logo=x)](https://twitter.com/openlit_io)

**[Documentation](https://docs.openlit.io/) · [Quickstart](https://docs.openlit.io/) · [Examples](https://github.com/openlit/openlit/tree/main/examples) · [Join Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)**

</div>

---

## See what your AI agents are actually doing

AI applications are no longer just LLM calls.

A production agent can involve:

```text
User
 │
 ▼
AI Agent
 ├── LLM calls
 ├── Tool calls
 ├── Retrieval
 ├── Memory
 ├── Sub-agents
 ├── Prompts
 └── Code changes
       │
       ▼
   Evaluation
       │
       ▼
  Cost / Quality / Errors
```

**OpenLIT gives you visibility across the entire workflow.**

Trace every LLM call, tool invocation, prompt, agent step, token, cost, error, and evaluation — using OpenTelemetry.

---

## ⚡ Get started in 5 minutes

### 1. Start OpenLIT

```bash
git clone https://github.com/openlit/openlit.git
cd openlit

docker compose up -d
```

Open:

```text
http://127.0.0.1:3000
```

### 2. Install the SDK

Python:

```bash
pip install openlit
```

TypeScript:

```bash
npm install openlit
```

### 3. Instrument your application

Python:

```python
import openlit

openlit.init()
```

That's it.

OpenLIT automatically instruments supported LLM providers, frameworks, vector databases, and other AI infrastructure and exports OpenTelemetry traces and metrics.

### 4. Send telemetry

By default, configure the OTLP endpoint:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"
```

Or:

```python
import openlit

openlit.init(
    otlp_endpoint="http://127.0.0.1:4318"
)
```

Open your dashboard and start exploring your AI application's traces, metrics, costs, and performance.

---

# 🤖 Observe Claude Code, Cursor & Codex

AI coding agents are powerful — but understanding what they actually did can be difficult.

OpenLIT gives you an OpenTelemetry-native view of coding-agent sessions.

Install the CLI:

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts/install.sh | sh
```

### Windows

```powershell
iwr -useb https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts/install.ps1 | iex
```

Configure OpenLIT:

```bash
openlit configure --endpoint http://127.0.0.1:4318
```

Install coding-agent instrumentation:

```bash
openlit coding install --vendor=all
```

Or install individual integrations:

```bash
openlit coding install --vendor=cursor
openlit coding install --vendor=claude-code
openlit coding install --vendor=codex
```

Check your installation:

```bash
openlit doctor
```

Now OpenLIT can capture:

```text
Coding Agent Session
│
├── User prompt
├── LLM calls
├── Tool calls
│   ├── File reads
│   ├── File edits
│   ├── Shell commands
│   └── Search
│
├── Sub-agent activity
├── Token usage
├── Cost
└── Code impact
```

Explore the resulting sessions in the **Coding Agents** dashboard.

---

# 🔍 What OpenLIT gives you

## Traces

Understand exactly what happened during an AI request.

See:

* LLM calls
* prompts and responses
* tool calls
* retrieval
* embeddings
* vector database operations
* agent steps
* latency
* token usage
* errors

All represented using OpenTelemetry.

---

## 💰 AI cost observability

Track the cost of your AI applications across:

* models
* providers
* users
* sessions
* agents
* environments

Support custom pricing for custom and fine-tuned models.

---

## 🧪 AI evaluations

Automatically evaluate LLM and agent outputs using LLM-as-a-Judge evaluations.

Built-in evaluation types include:

* Hallucination
* Bias
* Toxicity
* Safety
* Instruction following
* Completeness
* Conciseness
* Sensitivity
* Relevance
* Coherence
* Faithfulness

Use evaluations to move from:

**"The agent produced an answer."**

to:

**"The agent produced a good answer."**

---

## 🐛 Debug production AI

Find the requests that matter.

Investigate:

* failed LLM calls
* exceptions
* latency spikes
* unexpected costs
* bad evaluations
* problematic prompts
* agent/tool failures

Go from:

```text
Something went wrong.
```

to:

```text
Agent
  ↓
Prompt
  ↓
LLM
  ↓
Tool call
  ↓
Retrieval
  ↓
LLM
  ↓
Error
```

---

# 🧠 Prompt management

Use **Prompt Hub** to:

* create prompts
* version prompts
* retrieve prompts from your applications
* compare prompt versions
* keep prompts consistent across environments

Example:

```python
prompt = openlit.prompts.get(
    "customer-support"
)
```

Keep prompt management separate from application code while maintaining version control and observability.

---

# ⚙️ Rule Engine

Define runtime rules based on trace attributes.

Use rules to dynamically control:

* prompts
* evaluations
* contexts
* runtime behavior

Example:

```text
IF
  environment = production
  AND
  model = expensive-model

THEN
  run cost evaluation
  + retrieve production prompt
```

---

# 🔌 OpenTelemetry-native

OpenLIT is built around **OpenTelemetry**, rather than creating a proprietary telemetry format.

Your telemetry can flow through the OpenTelemetry ecosystem:

```text
                 ┌──────────────┐
                 │ AI App /     │
                 │ AI Agent     │
                 └──────┬───────┘
                        │
                 OpenTelemetry
                        │
                        ▼
              ┌──────────────────┐
              │ OpenTelemetry    │
              │ Collector        │
              └────────┬─────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
       OpenLIT Backend      Other OTel
             │               backends
             ▼
       OpenLIT Dashboard
```

This means you can integrate OpenLIT into an existing OpenTelemetry architecture instead of replacing it.

---

# 🧩 50+ integrations

OpenLIT supports automatic instrumentation across a growing ecosystem of AI providers, frameworks, and infrastructure.

### LLM providers

* OpenAI
* Anthropic
* Google AI
* Vertex AI
* AWS Bedrock
* Mistral
* Groq
* Cohere
* Together AI
* Ollama
* vLLM
* and more

### AI frameworks & agents

* LangChain
* LangGraph
* CrewAI
* OpenAI Agents
* Google ADK
* Claude Agent SDK
* and more

### Infrastructure

* Vector databases
* Embedding providers
* GPU infrastructure
* AI gateways
* OpenTelemetry backends

See the complete integration list in the [documentation](https://docs.openlit.io/).

---

# 🛠️ SDKs

OpenLIT provides OpenTelemetry-native SDKs for:

### Python

```bash
pip install openlit
```

[Python SDK →](https://github.com/openlit/openlit/tree/main/sdk/python)

### TypeScript

```bash
npm install openlit
```

[TypeScript SDK →](https://github.com/openlit/openlit/tree/main/sdk/typescript)

### Go

[Go SDK →](https://github.com/openlit/openlit/tree/main/sdk/go)

---

# 🏗️ Architecture

OpenLIT is designed to run in your infrastructure.

A typical deployment looks like:

```text
┌──────────────────────────────────────────┐
│              Your application            │
│                                          │
│  Agent ── LLM ── Tools ── RAG ── DB     │
└────────────────────┬─────────────────────┘
                     │
              OpenTelemetry
                     │
                     ▼
          ┌────────────────────┐
          │ OpenTelemetry      │
          │ Collector          │
          └─────────┬──────────┘
                    │
                    ▼
             ┌─────────────┐
             │ ClickHouse  │
             └──────┬──────┘
                    │
                    ▼
             ┌─────────────┐
             │   OpenLIT   │
             │  Dashboard  │
             └─────────────┘
```

---

# 🔐 Self-hosted by default

Run OpenLIT inside your own infrastructure using Docker or Kubernetes.

Your telemetry stays under your control.

```bash
docker compose up -d
```

For Kubernetes, see the [installation documentation](https://docs.openlit.io/latest/openlit/installation#kubernetes).

---

# 🚀 From trace to optimization

Observability is only the beginning.

OpenLIT is designed around a continuous AI engineering loop:

```text
             ┌──────────┐
             │   Trace  │
             └────┬─────┘
                  ↓
             ┌──────────┐
             │ Evaluate │
             └────┬─────┘
                  ↓
             ┌──────────┐
             │ Analyze  │
             └────┬─────┘
                  ↓
             ┌──────────┐
             │ Optimize │
             └────┬─────┘
                  ↓
             ┌──────────┐
             │ Manage   │
             └────┬─────┘
                  │
                  └──────────────→ Trace
```

The goal is simple:

> **Make AI systems observable, measurable, debuggable, and continuously improvable.**

---

# 🌎 Community

OpenLIT is open source and built with the AI engineering community.

Join us:

* [GitHub](https://github.com/openlit/openlit)
* [Documentation](https://docs.openlit.io/)
* [Slack](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
* [X / Twitter](https://twitter.com/openlit_io)

If OpenLIT is useful to you, **please consider giving the repository a ⭐**.

It helps other AI engineers discover the project.

---

# 🤝 Contributing

Contributions are welcome.

You can contribute by:

* fixing bugs
* adding integrations
* improving documentation
* creating examples
* improving SDKs
* adding evaluations
* building dashboards
* reporting issues
* sharing OpenLIT with other developers

Check the repository's issues for opportunities to contribute.

---

# 📄 License

OpenLIT is licensed under the Apache License 2.0.

See [LICENSE](https://github.com/openlit/openlit/blob/main/LICENSE) for details.

---

<div align="center">

### Build AI systems you can actually understand.

**⭐ Star OpenLIT on GitHub**

</div>
