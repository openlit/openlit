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

This project is proudly supported by:

<p>
<a href="https://www.testmuai.com/?utm_medium=sponsor&utm_source=openlit" target="_blank">
  <img src="docs/images/testmu-logo.png" alt="TestMu" height="80">
</a>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" alt="DigitalOcean" height="80" width="200">
</a>
</p>

---

# 💻 Contributors

<a href="https://github.com/openlit/openlit/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=openlit/openlit" alt="OpenLIT contributors">
</a>

---

<div align="center">

### Build AI systems you can actually understand.

**⭐ Star OpenLIT on GitHub**

</div>
