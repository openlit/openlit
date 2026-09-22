<div align="center">

<img src="https://github.com/openlit/.github/blob/main/profile/assets/wide-logo-no-bg.png?raw=true" alt="OpenLIT Logo" width="30%">

# Open-source observability & evaluation for AI agents

**Trace, evaluate, debug, and optimize AI applications and coding agents with OpenTelemetry.**

<a href="https://docs.openlit.io/latest/features/agent-observability">
  <img src="docs/images/readme-hero-coding-agent-trace.png" alt="OpenLIT coding agent trace view" width="90%">
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

```mermaid
flowchart TD
    U([User]) --> A[AI Agent]
    A --> L[LLM calls]
    A --> T[Tool calls]
    A --> R[Retrieval]
    A --> M[Memory]
    A --> S[Sub-agents]
    A --> P[Prompts]
    A --> C[Code changes]
    L & T & R & M & S & P & C --> E{{Evaluation}}
    E --> O[["Cost / Quality / Errors"]]

    style U fill:#F97316,stroke:#7C2D12,color:#fff
    style A fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style E fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style O fill:#F97316,stroke:#7C2D12,color:#fff
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

```mermaid
flowchart LR
    S([Coding Agent Session]) --> P[User prompt]
    S --> L[LLM calls]
    S --> T[Tool calls]
    T --> T1[File reads]
    T --> T2[File edits]
    T --> T3[Shell commands]
    T --> T4[Search]
    S --> SA[Sub-agent activity]
    S --> TU[Token usage]
    S --> CO[Cost]
    S --> CI[Code impact]

    style S fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style T fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
```

Explore the resulting sessions in the **Coding Agents** dashboard.

---

# 🔍 What OpenLIT gives you

## Traces

Understand exactly what happened during an AI request.

<p>
<img src="https://img.shields.io/badge/-LLM_calls-1F2937?style=flat-square" alt="LLM calls"> <img src="https://img.shields.io/badge/-Prompts_and_responses-1F2937?style=flat-square" alt="Prompts & responses"> <img src="https://img.shields.io/badge/-Tool_calls-1F2937?style=flat-square" alt="Tool calls"> <img src="https://img.shields.io/badge/-Retrieval-1F2937?style=flat-square" alt="Retrieval"> <img src="https://img.shields.io/badge/-Embeddings-1F2937?style=flat-square" alt="Embeddings"> <img src="https://img.shields.io/badge/-Vector_DB_ops-1F2937?style=flat-square" alt="Vector DB ops"> <img src="https://img.shields.io/badge/-Agent_steps-1F2937?style=flat-square" alt="Agent steps"> <img src="https://img.shields.io/badge/-Latency-1F2937?style=flat-square" alt="Latency"> <img src="https://img.shields.io/badge/-Token_usage-1F2937?style=flat-square" alt="Token usage"> <img src="https://img.shields.io/badge/-Errors-1F2937?style=flat-square" alt="Errors">
</p>

All represented using OpenTelemetry.

---

## 💰 AI cost observability

Track the cost of your AI applications across:

<p>
<img src="https://img.shields.io/badge/-Models-1F2937?style=flat-square" alt="Models"> <img src="https://img.shields.io/badge/-Providers-1F2937?style=flat-square" alt="Providers"> <img src="https://img.shields.io/badge/-Users-1F2937?style=flat-square" alt="Users"> <img src="https://img.shields.io/badge/-Sessions-1F2937?style=flat-square" alt="Sessions"> <img src="https://img.shields.io/badge/-Agents-1F2937?style=flat-square" alt="Agents"> <img src="https://img.shields.io/badge/-Environments-1F2937?style=flat-square" alt="Environments">
</p>

Support custom pricing for custom and fine-tuned models.

---

## 🧪 AI evaluations

Automatically evaluate LLM and agent outputs using LLM-as-a-Judge evaluations.

Built-in evaluation types include:

<p>
<img src="https://img.shields.io/badge/-Hallucination-1F2937?style=flat-square" alt="Hallucination"> <img src="https://img.shields.io/badge/-Bias-1F2937?style=flat-square" alt="Bias"> <img src="https://img.shields.io/badge/-Toxicity-1F2937?style=flat-square" alt="Toxicity"> <img src="https://img.shields.io/badge/-Safety-1F2937?style=flat-square" alt="Safety"> <img src="https://img.shields.io/badge/-Instruction_following-1F2937?style=flat-square" alt="Instruction following"> <img src="https://img.shields.io/badge/-Completeness-1F2937?style=flat-square" alt="Completeness"> <img src="https://img.shields.io/badge/-Conciseness-1F2937?style=flat-square" alt="Conciseness"> <img src="https://img.shields.io/badge/-Sensitivity-1F2937?style=flat-square" alt="Sensitivity"> <img src="https://img.shields.io/badge/-Relevance-1F2937?style=flat-square" alt="Relevance"> <img src="https://img.shields.io/badge/-Coherence-1F2937?style=flat-square" alt="Coherence"> <img src="https://img.shields.io/badge/-Faithfulness-1F2937?style=flat-square" alt="Faithfulness">
</p>

Use evaluations to move from:

**"The agent produced an answer."**

to:

**"The agent produced a good answer."**

---

## 🐛 Debug production AI

Find the requests that matter.

Investigate:

<p>
<img src="https://img.shields.io/badge/-Failed_LLM_calls-1F2937?style=flat-square" alt="Failed LLM calls"> <img src="https://img.shields.io/badge/-Exceptions-1F2937?style=flat-square" alt="Exceptions"> <img src="https://img.shields.io/badge/-Latency_spikes-1F2937?style=flat-square" alt="Latency spikes"> <img src="https://img.shields.io/badge/-Unexpected_costs-1F2937?style=flat-square" alt="Unexpected costs"> <img src="https://img.shields.io/badge/-Bad_evaluations-1F2937?style=flat-square" alt="Bad evaluations"> <img src="https://img.shields.io/badge/-Problematic_prompts-1F2937?style=flat-square" alt="Problematic prompts"> <img src="https://img.shields.io/badge/-Agent_tool_failures-1F2937?style=flat-square" alt="Agent/tool failures">
</p>

Go from:

> `Something went wrong.`

to a fully traced root cause:

```mermaid
flowchart TD
    A[Agent] --> P[Prompt] --> L1[LLM] --> T[Tool call] --> R[Retrieval] --> L2[LLM] --> E([Error])

    style E fill:#DC2626,stroke:#7F1D1D,color:#fff
    style A fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
```

---

# 📸 See OpenLIT in action

<table>
<tr>
<td width="33%" align="center">
<img src="docs/images/docs-ai-observability-trace.png" alt="Traces view with full agent conversation, spans, and cost breakdown" width="100%"><br/>
<sub><b>Traces</b> — full agent conversation, spans &amp; cost</sub>
</td>
<td width="33%" align="center">
<img src="docs/images/auto-evals-dashboard.png" alt="Automated evaluation dashboard with hallucination, bias, and toxicity metrics" width="100%"><br/>
<sub><b>Evaluations</b> — hallucination, bias &amp; toxicity checks</sub>
</td>
<td width="33%" align="center">
<img src="docs/images/organisation/connectors-list.png" alt="Connectors catalog with ClickHouse, Grafana Tempo, Loki, Prometheus, and Jaeger" width="100%"><br/>
<sub><b>Connectors</b> — plug in ClickHouse, Tempo, Loki, Prometheus &amp; more</sub>
</td>
</tr>
<tr>
<td width="33%" align="center">
<img src="docs/images/docs-prompt-hub-details.png" alt="Prompt Hub prompt detail page with versions and linked rules" width="100%"><br/>
<sub><b>Prompt Hub</b> — versioned, centrally managed prompts</sub>
</td>
<td width="33%" align="center">
<img src="docs/images/rule-engine-conditions.png" alt="Rule Engine rule detail page with condition groups and live rule preview" width="100%"><br/>
<sub><b>Rule Engine</b> — conditional rules on trace attributes</sub>
</td>
<td width="33%" align="center">
<img src="docs/images/docs-ui-banner.jpeg" alt="OpenLIT dashboard preview with cost, latency, and usage charts" width="100%"><br/>
<sub><b>Dashboards</b> — cost, latency &amp; usage charts at a glance</sub>
</td>
</tr>
</table>

---

# 🧠 Prompt management

Use **Prompt Hub** to:

<p>
<img src="https://img.shields.io/badge/-Create_prompts-1F2937?style=flat-square" alt="Create prompts"> <img src="https://img.shields.io/badge/-Version_prompts-1F2937?style=flat-square" alt="Version prompts"> <img src="https://img.shields.io/badge/-Retrieve_from_apps-1F2937?style=flat-square" alt="Retrieve from apps"> <img src="https://img.shields.io/badge/-Compare_versions-1F2937?style=flat-square" alt="Compare versions"> <img src="https://img.shields.io/badge/-Consistent_across_environments-1F2937?style=flat-square" alt="Consistent across environments">
</p>

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

<p>
<img src="https://img.shields.io/badge/-Prompts-1F2937?style=flat-square" alt="Prompts"> <img src="https://img.shields.io/badge/-Evaluations-1F2937?style=flat-square" alt="Evaluations"> <img src="https://img.shields.io/badge/-Contexts-1F2937?style=flat-square" alt="Contexts"> <img src="https://img.shields.io/badge/-Runtime_behavior-1F2937?style=flat-square" alt="Runtime behavior">
</p>

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

```mermaid
flowchart TD
    A["AI App / AI Agent"] -->|OpenTelemetry| C[OpenTelemetry Collector]
    C --> B[OpenLIT Backend]
    C --> O["Other OTel backends<br/>(Datadog, Grafana, Honeycomb, ...)"]
    B --> D[OpenLIT Dashboard]

    style A fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style C fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style B fill:#F97316,stroke:#7C2D12,color:#fff
    style D fill:#F97316,stroke:#7C2D12,color:#fff
```

This means you can integrate OpenLIT into an existing OpenTelemetry architecture instead of replacing it.

---

# 🧩 70+ integrations

OpenLIT auto-instruments a growing ecosystem of AI providers, frameworks, vector databases, and GPU infrastructure with a single line of code. Click any badge to view its integration guide.

**LLM Providers**

<a href="https://docs.openlit.io/latest/sdk/integrations/openai"><img src="https://img.shields.io/badge/OpenAI-1F2937?style=flat-square&logo=openai&logoColor=white" alt="OpenAI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/ollama"><img src="https://img.shields.io/badge/Ollama-1F2937?style=flat-square&logo=ollama&logoColor=white" alt="Ollama"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/anthropic"><img src="https://img.shields.io/badge/Anthropic-1F2937?style=flat-square&logo=anthropic&logoColor=white" alt="Anthropic"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/deepseek"><img src="https://img.shields.io/badge/DeepSeek-1F2937?style=flat-square&logo=deepseek&logoColor=white" alt="DeepSeek"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/gpt4all"><img src="https://img.shields.io/badge/GPT4All-1F2937?style=flat-square&logo=gpt4all&logoColor=white" alt="GPT4All"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/cohere"><img src="https://img.shields.io/badge/Cohere-1F2937?style=flat-square&logo=cohere&logoColor=white" alt="Cohere"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/mistral"><img src="https://img.shields.io/badge/Mistral-1F2937?style=flat-square&logo=mistralai&logoColor=white" alt="Mistral"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/github-models"><img src="https://img.shields.io/badge/GitHub_Models-1F2937?style=flat-square&logo=github&logoColor=white" alt="GitHub Models"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/vllm"><img src="https://img.shields.io/badge/vLLM-1F2937?style=flat-square&logo=vllm&logoColor=white" alt="vLLM"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/azure-openai"><img src="https://img.shields.io/badge/Azure_OpenAI-1F2937?style=flat-square&logo=azureopenai&logoColor=white" alt="Azure OpenAI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/azure-ai-inference"><img src="https://img.shields.io/badge/Azure_AI_Inference-1F2937?style=flat-square&logo=azureaiinference&logoColor=white" alt="Azure AI Inference"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/huggingface"><img src="https://img.shields.io/badge/HuggingFace-1F2937?style=flat-square&logo=huggingface&logoColor=white" alt="HuggingFace"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/bedrock"><img src="https://img.shields.io/badge/Amazon_Bedrock-1F2937?style=flat-square&logo=amazonbedrock&logoColor=white" alt="Amazon Bedrock"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/vertexai"><img src="https://img.shields.io/badge/Vertex_AI-1F2937?style=flat-square&logo=googlecloud&logoColor=white" alt="Vertex AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/google-ai-studio"><img src="https://img.shields.io/badge/Google_AI_Studio-1F2937?style=flat-square&logo=googlegemini&logoColor=white" alt="Google AI Studio"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/groq"><img src="https://img.shields.io/badge/Groq-1F2937?style=flat-square&logo=groq&logoColor=white" alt="Groq"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/nvidia-nim"><img src="https://img.shields.io/badge/NVIDIA_NIM-1F2937?style=flat-square&logo=nvidianim&logoColor=white" alt="NVIDIA NIM"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/xai"><img src="https://img.shields.io/badge/xAI-1F2937?style=flat-square&logo=xai&logoColor=white" alt="xAI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/elevenlabs"><img src="https://img.shields.io/badge/ElevenLabs-1F2937?style=flat-square&logo=elevenlabs&logoColor=white" alt="ElevenLabs"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/ai21"><img src="https://img.shields.io/badge/AI21-1F2937?style=flat-square&logo=ai21&logoColor=white" alt="AI21"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/together"><img src="https://img.shields.io/badge/Together_AI-1F2937?style=flat-square&logo=togetherai&logoColor=white" alt="Together AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/digitalocean"><img src="https://img.shields.io/badge/DigitalOcean_(pydo)-1F2937?style=flat-square&logo=digitalocean&logoColor=white" alt="DigitalOcean (pydo)"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/digitalocean-gradient"><img src="https://img.shields.io/badge/DigitalOcean_Gradient-1F2937?style=flat-square&logo=digitalocean&logoColor=white" alt="DigitalOcean Gradient"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/assemblyai"><img src="https://img.shields.io/badge/Assembly_AI-1F2937?style=flat-square&logo=assemblyai&logoColor=white" alt="Assembly AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/featherless"><img src="https://img.shields.io/badge/Featherless-1F2937?style=flat-square&logo=featherless&logoColor=white" alt="Featherless"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/reka"><img src="https://img.shields.io/badge/Reka_AI-1F2937?style=flat-square&logo=rekaai&logoColor=white" alt="Reka AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/krutrim"><img src="https://img.shields.io/badge/OLA_Krutrim-1F2937?style=flat-square&logo=olakrutrim&logoColor=white" alt="OLA Krutrim"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/titan-ml"><img src="https://img.shields.io/badge/Titan_ML-1F2937?style=flat-square&logo=titanml&logoColor=white" alt="Titan ML"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/sarvam"><img src="https://img.shields.io/badge/Sarvam_AI-1F2937?style=flat-square&logo=sarvamai&logoColor=white" alt="Sarvam AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/premai"><img src="https://img.shields.io/badge/Prem_AI-1F2937?style=flat-square&logo=premai&logoColor=white" alt="Prem AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/replicate"><img src="https://img.shields.io/badge/Replicate-1F2937?style=flat-square&logo=replicate&logoColor=white" alt="Replicate"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/oci"><img src="https://img.shields.io/badge/OCI_GenAI-1F2937?style=flat-square&logo=ocigenai&logoColor=white" alt="OCI GenAI"></a>

**Vector & Data Stores**

<a href="https://docs.openlit.io/latest/sdk/integrations/chromadb"><img src="https://img.shields.io/badge/ChromaDB-1F2937?style=flat-square&logo=chromadb&logoColor=white" alt="ChromaDB"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/pinecone"><img src="https://img.shields.io/badge/Pinecone-1F2937?style=flat-square&logo=pinecone&logoColor=white" alt="Pinecone"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/qdrant"><img src="https://img.shields.io/badge/Qdrant-1F2937?style=flat-square&logo=qdrant&logoColor=white" alt="Qdrant"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/milvus"><img src="https://img.shields.io/badge/Milvus-1F2937?style=flat-square&logo=milvus&logoColor=white" alt="Milvus"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/astradb"><img src="https://img.shields.io/badge/AstraDB-1F2937?style=flat-square&logo=datastax&logoColor=white" alt="AstraDB"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/psycopg"><img src="https://img.shields.io/badge/PostgreSQL_(psycopg3)-1F2937?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL (psycopg3)"></a>

**AI Frameworks & Agents**

<a href="https://docs.openlit.io/latest/sdk/integrations/langchain"><img src="https://img.shields.io/badge/LangChain-1F2937?style=flat-square&logo=langchain&logoColor=white" alt="LangChain"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/openai-agents"><img src="https://img.shields.io/badge/OpenAI_Agents-1F2937?style=flat-square&logo=openaiagents&logoColor=white" alt="OpenAI Agents"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/litellm"><img src="https://img.shields.io/badge/LiteLLM-1F2937?style=flat-square&logo=litellm&logoColor=white" alt="LiteLLM"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/crewai"><img src="https://img.shields.io/badge/CrewAI-1F2937?style=flat-square&logo=crewai&logoColor=white" alt="CrewAI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/llama-index"><img src="https://img.shields.io/badge/LlamaIndex-1F2937?style=flat-square&logo=llamaindex&logoColor=white" alt="LlamaIndex"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/browser-use"><img src="https://img.shields.io/badge/Browser_Use-1F2937?style=flat-square&logo=browseruse&logoColor=white" alt="Browser Use"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/pydantic"><img src="https://img.shields.io/badge/Pydantic_AI-1F2937?style=flat-square&logo=pydantic&logoColor=white" alt="Pydantic AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/dspy"><img src="https://img.shields.io/badge/DSPy-1F2937?style=flat-square&logo=dspy&logoColor=white" alt="DSPy"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/ag2"><img src="https://img.shields.io/badge/AutoGen_(AG2)-1F2937?style=flat-square&logo=autogen&logoColor=white" alt="AutoGen (AG2)"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/haystack"><img src="https://img.shields.io/badge/Haystack-1F2937?style=flat-square&logo=haystack&logoColor=white" alt="Haystack"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/mem0"><img src="https://img.shields.io/badge/mem0-1F2937?style=flat-square&logo=mem0&logoColor=white" alt="mem0"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/guardrails"><img src="https://img.shields.io/badge/Guardrails_AI-1F2937?style=flat-square&logo=guardrailsai&logoColor=white" alt="Guardrails AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/phidata"><img src="https://img.shields.io/badge/Phidata-1F2937?style=flat-square&logo=phidata&logoColor=white" alt="Phidata"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/multion"><img src="https://img.shields.io/badge/MultiOn-1F2937?style=flat-square&logo=multion&logoColor=white" alt="MultiOn"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/julep-ai"><img src="https://img.shields.io/badge/Julep_AI-1F2937?style=flat-square&logo=julepai&logoColor=white" alt="Julep AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/letta"><img src="https://img.shields.io/badge/Letta-1F2937?style=flat-square&logo=letta&logoColor=white" alt="Letta"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/crawl4ai"><img src="https://img.shields.io/badge/Crawl4AI-1F2937?style=flat-square&logo=crawl4ai&logoColor=white" alt="Crawl4AI"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/firecrawl"><img src="https://img.shields.io/badge/FireCrawl-1F2937?style=flat-square&logo=firecrawl&logoColor=white" alt="FireCrawl"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/dynamiq"><img src="https://img.shields.io/badge/Dynamiq-1F2937?style=flat-square&logo=dynamiq&logoColor=white" alt="Dynamiq"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/controlflow"><img src="https://img.shields.io/badge/ControlFlow-1F2937?style=flat-square&logo=controlflow&logoColor=white" alt="ControlFlow"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/swarmzero"><img src="https://img.shields.io/badge/SwarmZero-1F2937?style=flat-square&logo=swarmzero&logoColor=white" alt="SwarmZero"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/langgraph"><img src="https://img.shields.io/badge/LangGraph-1F2937?style=flat-square&logo=langgraph&logoColor=white" alt="LangGraph"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/strands"><img src="https://img.shields.io/badge/Strands_Agents-1F2937?style=flat-square&logo=strandsagents&logoColor=white" alt="Strands Agents"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/google-adk"><img src="https://img.shields.io/badge/Google_ADK-1F2937?style=flat-square&logo=google&logoColor=white" alt="Google ADK"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/claude-agent-sdk"><img src="https://img.shields.io/badge/Claude_Agent_SDK-1F2937?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Agent SDK"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/vercel-ai"><img src="https://img.shields.io/badge/Vercel_AI_SDK-1F2937?style=flat-square&logo=vercel&logoColor=white" alt="Vercel AI SDK"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/agent-framework"><img src="https://img.shields.io/badge/Agent_Framework-1F2937?style=flat-square&logo=agentframework&logoColor=white" alt="Agent Framework"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/smolagents"><img src="https://img.shields.io/badge/smolagents-1F2937?style=flat-square&logo=huggingface&logoColor=white" alt="smolagents"></a>

**Governance & Protocols**

<a href="https://docs.openlit.io/latest/sdk/integrations/agent-governance-toolkit"><img src="https://img.shields.io/badge/Agent_Governance_Toolkit-1F2937?style=flat-square&logo=agentgovernancetoolkit&logoColor=white" alt="Agent Governance Toolkit"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/mcp"><img src="https://img.shields.io/badge/MCP-1F2937?style=flat-square&logo=mcp&logoColor=white" alt="MCP"></a>

**GPU Monitoring**

<a href="https://docs.openlit.io/latest/sdk/integrations/nvidia-gpu"><img src="https://img.shields.io/badge/NVIDIA_GPUs-1F2937?style=flat-square&logo=nvidia&logoColor=white" alt="NVIDIA GPUs"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/amd-gpu"><img src="https://img.shields.io/badge/AMD_GPUs-1F2937?style=flat-square&logo=amd&logoColor=white" alt="AMD GPUs"></a> <a href="https://docs.openlit.io/latest/sdk/integrations/intel-gpu"><img src="https://img.shields.io/badge/Intel_GPUs-1F2937?style=flat-square&logo=intel&logoColor=white" alt="Intel GPUs"></a>

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

```mermaid
flowchart TD
    subgraph App["Your application"]
        direction LR
        Agent --> LLM --> Tools --> RAG --> DB
    end
    App -->|OpenTelemetry| Collector[OpenTelemetry Collector]
    Collector --> CH[(ClickHouse)]
    CH --> Dash[OpenLIT Dashboard]

    style App fill:#1F2937,stroke:#F97316,stroke-width:2px,color:#fff
    style Collector fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style CH fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style Dash fill:#F97316,stroke:#7C2D12,color:#fff
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

```mermaid
flowchart LR
    T[Trace] --> E[Evaluate] --> A[Analyze] --> O[Optimize] --> M[Manage] -.-> T

    style T fill:#F97316,stroke:#7C2D12,color:#fff
    style E fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style A fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style O fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
    style M fill:#111827,stroke:#F97316,stroke-width:2px,color:#fff
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

# 🙇 Acknowledgments

## Sponsors

### Silver

<p>
<a href="https://fluxionai.world/register?source=github&campaign=github-openlit&promo=OPENLIT" target="_blank">
  <img src="docs/images/fluxion-ai-logo.png" alt="Fluxion AI" height="72">
</a>
</p>

### Bronze

<p>
<a href="https://www.testmuai.com/?utm_medium=sponsor&utm_source=openlit" target="_blank">
  <img src="docs/images/testmu-logo.png" alt="TestMu AI" height="80">
</a>
</p>

## Deployment partners

<p>
<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" alt="DigitalOcean" height="80" width="200">
</a>
&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://www.hostg.xyz/aff_c?offer_id=815&aff_id=243668&url_id=6792">
  <img src="https://assets.hostinger.com/vps/deploy.svg" alt="Deploy on Hostinger">
</a>
</p>

---

# 💻 Contributors

Everyone who has contributed code to [openlit/openlit](https://github.com/openlit/openlit), the same list shown on [openlit.io/about-us](https://openlit.io/about-us).

<table>
<tr>
<td align="center" valign="top"><a href="https://github.com/Achanandhi-M"><img src="https://github.com/Achanandhi-M.png" width="56" height="56" alt="Achanandhi-M"/><br/><sub>Achanandhi-M</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Aftabbs"><img src="https://github.com/Aftabbs.png" width="56" height="56" alt="Aftabbs"/><br/><sub>Aftabbs</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/AIRobotNic"><img src="https://github.com/AIRobotNic.png" width="56" height="56" alt="AIRobotNic"/><br/><sub>AIRobotNic</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Akaban"><img src="https://github.com/Akaban.png" width="56" height="56" alt="Akaban"/><br/><sub>Akaban</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/akiseleva-dev"><img src="https://github.com/akiseleva-dev.png" width="56" height="56" alt="akiseleva-dev"/><br/><sub>akiseleva-dev</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Alex3k"><img src="https://github.com/Alex3k.png" width="56" height="56" alt="Alex3k"/><br/><sub>Alex3k</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/AmadNaseem"><img src="https://github.com/AmadNaseem.png" width="56" height="56" alt="AmadNaseem"/><br/><sub>AmadNaseem</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/AmanAgarwal041"><img src="https://github.com/AmanAgarwal041.png" width="56" height="56" alt="AmanAgarwal041"/><br/><sub>AmanAgarwal041</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/amanagarwal042"><img src="https://github.com/amanagarwal042.png" width="56" height="56" alt="amanagarwal042"/><br/><sub>amanagarwal042</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/AmirF194"><img src="https://github.com/AmirF194.png" width="56" height="56" alt="AmirF194"/><br/><sub>AmirF194</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/amoha-enwithai"><img src="https://github.com/amoha-enwithai.png" width="56" height="56" alt="amoha-enwithai"/><br/><sub>amoha-enwithai</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Anai-Guo"><img src="https://github.com/Anai-Guo.png" width="56" height="56" alt="Anai-Guo"/><br/><sub>Anai-Guo</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/andrei-trandafir"><img src="https://github.com/andrei-trandafir.png" width="56" height="56" alt="andrei-trandafir"/><br/><sub>andrei-trandafir</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/aniketwaghh"><img src="https://github.com/aniketwaghh.png" width="56" height="56" alt="aniketwaghh"/><br/><sub>aniketwaghh</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/artur-nohup"><img src="https://github.com/artur-nohup.png" width="56" height="56" alt="artur-nohup"/><br/><sub>artur-nohup</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/bajrangostwal"><img src="https://github.com/bajrangostwal.png" width="56" height="56" alt="bajrangostwal"/><br/><sub>bajrangostwal</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/Barry2llen"><img src="https://github.com/Barry2llen.png" width="56" height="56" alt="Barry2llen"/><br/><sub>Barry2llen</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Bassel-Elwakil"><img src="https://github.com/Bassel-Elwakil.png" width="56" height="56" alt="Bassel-Elwakil"/><br/><sub>Bassel-Elwakil</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/benmezger"><img src="https://github.com/benmezger.png" width="56" height="56" alt="benmezger"/><br/><sub>benmezger</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/BetterAndBetterII"><img src="https://github.com/BetterAndBetterII.png" width="56" height="56" alt="BetterAndBetterII"/><br/><sub>BetterAndBetterII</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/bvjebin"><img src="https://github.com/bvjebin.png" width="56" height="56" alt="bvjebin"/><br/><sub>bvjebin</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Calvin-Huang"><img src="https://github.com/Calvin-Huang.png" width="56" height="56" alt="Calvin-Huang"/><br/><sub>Calvin-Huang</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/cbirkhold"><img src="https://github.com/cbirkhold.png" width="56" height="56" alt="cbirkhold"/><br/><sub>cbirkhold</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/chaizhenhua"><img src="https://github.com/chaizhenhua.png" width="56" height="56" alt="chaizhenhua"/><br/><sub>chaizhenhua</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/CherishCai"><img src="https://github.com/CherishCai.png" width="56" height="56" alt="CherishCai"/><br/><sub>CherishCai</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/cherrycove"><img src="https://github.com/cherrycove.png" width="56" height="56" alt="cherrycove"/><br/><sub>cherrycove</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/chibuike-okpara"><img src="https://github.com/chibuike-okpara.png" width="56" height="56" alt="chibuike-okpara"/><br/><sub>chibuike-okpara</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/chocoHacks33"><img src="https://github.com/chocoHacks33.png" width="56" height="56" alt="chocoHacks33"/><br/><sub>chocoHacks33</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/chris-araki"><img src="https://github.com/chris-araki.png" width="56" height="56" alt="chris-araki"/><br/><sub>chris-araki</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ChrisBlaa"><img src="https://github.com/ChrisBlaa.png" width="56" height="56" alt="ChrisBlaa"/><br/><sub>ChrisBlaa</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/chriskhanhtran"><img src="https://github.com/chriskhanhtran.png" width="56" height="56" alt="chriskhanhtran"/><br/><sub>chriskhanhtran</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/citizen204"><img src="https://github.com/citizen204.png" width="56" height="56" alt="citizen204"/><br/><sub>citizen204</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/cooleryu"><img src="https://github.com/cooleryu.png" width="56" height="56" alt="cooleryu"/><br/><sub>cooleryu</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/danchev"><img src="https://github.com/danchev.png" width="56" height="56" alt="danchev"/><br/><sub>danchev</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/danilbogdan"><img src="https://github.com/danilbogdan.png" width="56" height="56" alt="danilbogdan"/><br/><sub>danilbogdan</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/dbirks"><img src="https://github.com/dbirks.png" width="56" height="56" alt="dbirks"/><br/><sub>dbirks</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Dheeraj-Bhaskaruni"><img src="https://github.com/Dheeraj-Bhaskaruni.png" width="56" height="56" alt="Dheeraj-Bhaskaruni"/><br/><sub>Dheeraj-Bhaskaruni</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/didlawowo"><img src="https://github.com/didlawowo.png" width="56" height="56" alt="didlawowo"/><br/><sub>didlawowo</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/dogxii"><img src="https://github.com/dogxii.png" width="56" height="56" alt="dogxii"/><br/><sub>dogxii</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ebarkhordar"><img src="https://github.com/ebarkhordar.png" width="56" height="56" alt="ebarkhordar"/><br/><sub>ebarkhordar</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/eragon512"><img src="https://github.com/eragon512.png" width="56" height="56" alt="eragon512"/><br/><sub>eragon512</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ericcurtin"><img src="https://github.com/ericcurtin.png" width="56" height="56" alt="ericcurtin"/><br/><sub>ericcurtin</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ethanknights"><img src="https://github.com/ethanknights.png" width="56" height="56" alt="ethanknights"/><br/><sub>ethanknights</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/fazd"><img src="https://github.com/fazd.png" width="56" height="56" alt="fazd"/><br/><sub>fazd</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/FBISiri"><img src="https://github.com/FBISiri.png" width="56" height="56" alt="FBISiri"/><br/><sub>FBISiri</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/feiiiiii5"><img src="https://github.com/feiiiiii5.png" width="56" height="56" alt="feiiiiii5"/><br/><sub>feiiiiii5</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/fpreiss"><img src="https://github.com/fpreiss.png" width="56" height="56" alt="fpreiss"/><br/><sub>fpreiss</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/giulio-leone"><img src="https://github.com/giulio-leone.png" width="56" height="56" alt="giulio-leone"/><br/><sub>giulio-leone</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/Goutham-Annem"><img src="https://github.com/Goutham-Annem.png" width="56" height="56" alt="Goutham-Annem"/><br/><sub>Goutham-Annem</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Gthejesraj"><img src="https://github.com/Gthejesraj.png" width="56" height="56" alt="Gthejesraj"/><br/><sub>Gthejesraj</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/guyrosin"><img src="https://github.com/guyrosin.png" width="56" height="56" alt="guyrosin"/><br/><sub>guyrosin</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/GVengelen"><img src="https://github.com/GVengelen.png" width="56" height="56" alt="GVengelen"/><br/><sub>GVengelen</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Gwenn-LR"><img src="https://github.com/Gwenn-LR.png" width="56" height="56" alt="Gwenn-LR"/><br/><sub>Gwenn-LR</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/hagen1778"><img src="https://github.com/hagen1778.png" width="56" height="56" alt="hagen1778"/><br/><sub>hagen1778</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Henildiyora"><img src="https://github.com/Henildiyora.png" width="56" height="56" alt="Henildiyora"/><br/><sub>Henildiyora</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/icohangar-ops"><img src="https://github.com/icohangar-ops.png" width="56" height="56" alt="icohangar-ops"/><br/><sub>icohangar-ops</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/ijkbytes"><img src="https://github.com/ijkbytes.png" width="56" height="56" alt="ijkbytes"/><br/><sub>ijkbytes</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/imran-siddique"><img src="https://github.com/imran-siddique.png" width="56" height="56" alt="imran-siddique"/><br/><sub>imran-siddique</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/imxinde"><img src="https://github.com/imxinde.png" width="56" height="56" alt="imxinde"/><br/><sub>imxinde</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ishachinniah"><img src="https://github.com/ishachinniah.png" width="56" height="56" alt="ishachinniah"/><br/><sub>ishachinniah</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ishanjainn"><img src="https://github.com/ishanjainn.png" width="56" height="56" alt="ishanjainn"/><br/><sub>ishanjainn</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/jannikmaierhoefer"><img src="https://github.com/jannikmaierhoefer.png" width="56" height="56" alt="jannikmaierhoefer"/><br/><sub>jannikmaierhoefer</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/jaysheeldodia"><img src="https://github.com/jaysheeldodia.png" width="56" height="56" alt="jaysheeldodia"/><br/><sub>jaysheeldodia</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/josefonte"><img src="https://github.com/josefonte.png" width="56" height="56" alt="josefonte"/><br/><sub>josefonte</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/JoshKappler"><img src="https://github.com/JoshKappler.png" width="56" height="56" alt="JoshKappler"/><br/><sub>JoshKappler</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/jpv-costa"><img src="https://github.com/jpv-costa.png" width="56" height="56" alt="jpv-costa"/><br/><sub>jpv-costa</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/kaspernissen"><img src="https://github.com/kaspernissen.png" width="56" height="56" alt="kaspernissen"/><br/><sub>kaspernissen</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Krishnachaitanyakc"><img src="https://github.com/Krishnachaitanyakc.png" width="56" height="56" alt="Krishnachaitanyakc"/><br/><sub>Krishnachaitanyakc</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/kujjwal02"><img src="https://github.com/kujjwal02.png" width="56" height="56" alt="kujjwal02"/><br/><sub>kujjwal02</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/kuswardhanietidims-svg"><img src="https://github.com/kuswardhanietidims-svg.png" width="56" height="56" alt="kuswardhanietidims-svg"/><br/><sub>kuswardhanietidims-svg</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/llukito"><img src="https://github.com/llukito.png" width="56" height="56" alt="llukito"/><br/><sub>llukito</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/luisangelrod"><img src="https://github.com/luisangelrod.png" width="56" height="56" alt="luisangelrod"/><br/><sub>luisangelrod</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/manan-tech"><img src="https://github.com/manan-tech.png" width="56" height="56" alt="manan-tech"/><br/><sub>manan-tech</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/mfahadyousaf"><img src="https://github.com/mfahadyousaf.png" width="56" height="56" alt="mfahadyousaf"/><br/><sub>mfahadyousaf</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/mikemikimike"><img src="https://github.com/mikemikimike.png" width="56" height="56" alt="mikemikimike"/><br/><sub>mikemikimike</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/minimAluminiumalism"><img src="https://github.com/minimAluminiumalism.png" width="56" height="56" alt="minimAluminiumalism"/><br/><sub>minimAluminiumalism</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/MohanadAbugharbia"><img src="https://github.com/MohanadAbugharbia.png" width="56" height="56" alt="MohanadAbugharbia"/><br/><sub>MohanadAbugharbia</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/morgan-coded"><img src="https://github.com/morgan-coded.png" width="56" height="56" alt="morgan-coded"/><br/><sub>morgan-coded</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/naman-jain-15"><img src="https://github.com/naman-jain-15.png" width="56" height="56" alt="naman-jain-15"/><br/><sub>naman-jain-15</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/natez56"><img src="https://github.com/natez56.png" width="56" height="56" alt="natez56"/><br/><sub>natez56</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/NaveenKumarReddy8"><img src="https://github.com/NaveenKumarReddy8.png" width="56" height="56" alt="NaveenKumarReddy8"/><br/><sub>NaveenKumarReddy8</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Nidhin117"><img src="https://github.com/Nidhin117.png" width="56" height="56" alt="Nidhin117"/><br/><sub>Nidhin117</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/nirogu"><img src="https://github.com/nirogu.png" width="56" height="56" alt="nirogu"/><br/><sub>nirogu</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/nitin302"><img src="https://github.com/nitin302.png" width="56" height="56" alt="nitin302"/><br/><sub>nitin302</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Noone9029"><img src="https://github.com/Noone9029.png" width="56" height="56" alt="Noone9029"/><br/><sub>Noone9029</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/noy-solvin"><img src="https://github.com/noy-solvin.png" width="56" height="56" alt="noy-solvin"/><br/><sub>noy-solvin</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/obielin"><img src="https://github.com/obielin.png" width="56" height="56" alt="obielin"/><br/><sub>obielin</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/octo-patch"><img src="https://github.com/octo-patch.png" width="56" height="56" alt="octo-patch"/><br/><sub>octo-patch</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/okaditya84"><img src="https://github.com/okaditya84.png" width="56" height="56" alt="okaditya84"/><br/><sub>okaditya84</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Oxygen56"><img src="https://github.com/Oxygen56.png" width="56" height="56" alt="Oxygen56"/><br/><sub>Oxygen56</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/pacocartones"><img src="https://github.com/pacocartones.png" width="56" height="56" alt="pacocartones"/><br/><sub>pacocartones</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/patcher99"><img src="https://github.com/patcher99.png" width="56" height="56" alt="patcher99"/><br/><sub>patcher99</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/phueper"><img src="https://github.com/phueper.png" width="56" height="56" alt="phueper"/><br/><sub>phueper</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/pitonic"><img src="https://github.com/pitonic.png" width="56" height="56" alt="pitonic"/><br/><sub>pitonic</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/pragnyanramtha"><img src="https://github.com/pragnyanramtha.png" width="56" height="56" alt="pragnyanramtha"/><br/><sub>pragnyanramtha</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/pratiksinghchauhan"><img src="https://github.com/pratiksinghchauhan.png" width="56" height="56" alt="pratiksinghchauhan"/><br/><sub>pratiksinghchauhan</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/praveen5959"><img src="https://github.com/praveen5959.png" width="56" height="56" alt="praveen5959"/><br/><sub>praveen5959</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/psbuilds"><img src="https://github.com/psbuilds.png" width="56" height="56" alt="psbuilds"/><br/><sub>psbuilds</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/RinZ27"><img src="https://github.com/RinZ27.png" width="56" height="56" alt="RinZ27"/><br/><sub>RinZ27</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/RitwijParmar"><img src="https://github.com/RitwijParmar.png" width="56" height="56" alt="RitwijParmar"/><br/><sub>RitwijParmar</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ron-42"><img src="https://github.com/ron-42.png" width="56" height="56" alt="ron-42"/><br/><sub>ron-42</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/roy-tong"><img src="https://github.com/roy-tong.png" width="56" height="56" alt="roy-tong"/><br/><sub>roy-tong</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/rudimk"><img src="https://github.com/rudimk.png" width="56" height="56" alt="rudimk"/><br/><sub>rudimk</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/saivedant169"><img src="https://github.com/saivedant169.png" width="56" height="56" alt="saivedant169"/><br/><sub>saivedant169</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/SelfParody"><img src="https://github.com/SelfParody.png" width="56" height="56" alt="SelfParody"/><br/><sub>SelfParody</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/ShouryaRSharma"><img src="https://github.com/ShouryaRSharma.png" width="56" height="56" alt="ShouryaRSharma"/><br/><sub>ShouryaRSharma</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/silvercondor"><img src="https://github.com/silvercondor.png" width="56" height="56" alt="silvercondor"/><br/><sub>silvercondor</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/thekishandev"><img src="https://github.com/thekishandev.png" width="56" height="56" alt="thekishandev"/><br/><sub>thekishandev</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/Tyagiquamar"><img src="https://github.com/Tyagiquamar.png" width="56" height="56" alt="Tyagiquamar"/><br/><sub>Tyagiquamar</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/UstatleenKaur"><img src="https://github.com/UstatleenKaur.png" width="56" height="56" alt="UstatleenKaur"/><br/><sub>UstatleenKaur</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/VanshikaMehta18"><img src="https://github.com/VanshikaMehta18.png" width="56" height="56" alt="VanshikaMehta18"/><br/><sub>VanshikaMehta18</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/VedantMadane"><img src="https://github.com/VedantMadane.png" width="56" height="56" alt="VedantMadane"/><br/><sub>VedantMadane</sub></a></td>
</tr>
<tr>
<td align="center" valign="top"><a href="https://github.com/wenchun-tw"><img src="https://github.com/wenchun-tw.png" width="56" height="56" alt="wenchun-tw"/><br/><sub>wenchun-tw</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/yehia2amer"><img src="https://github.com/yehia2amer.png" width="56" height="56" alt="yehia2amer"/><br/><sub>yehia2amer</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/zeroshotmind"><img src="https://github.com/zeroshotmind.png" width="56" height="56" alt="zeroshotmind"/><br/><sub>zeroshotmind</sub></a></td>
<td align="center" valign="top"><a href="https://github.com/openlit/openlit/blob/main/CONTRIBUTING.md"><img src="https://img.shields.io/badge/-You%3F-F97316?style=flat-square" alt="Become a contributor"/><br/><sub>You?</sub></a></td>
</tr>
</table>

---

<div align="center">

### Build AI systems you can actually understand.

**⭐ Star OpenLIT on GitHub**

</div>
