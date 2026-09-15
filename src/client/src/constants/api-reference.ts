export interface ApiEndpoint {
	id: string;
	method: "GET" | "POST" | "DELETE" | "PUT";
	path: string;
	summary: string;
	description: string;
	requestBody?: string;
	responseBody?: string;
	curlExample: (apiKey: string) => string;
}

/** Organisation → Project → Environment headers for signal-routed API-key calls. */
export const OPENLIT_CONTEXT_CURL_HEADERS = `  -H "x-openlit-organisation-id: <organisation-id>" \\
  -H "x-openlit-project-id: <project-id>" \\
  -H "x-openlit-environment: production"`;

/** Preferred SDK context: signal routing. Optional db-config header remains supported. */
export const OPENLIT_SDK_CONTEXT_CURL_HEADERS = `  -H "x-openlit-organisation-id: <organisation-id>" \\
  -H "x-openlit-project-id: <project-id>" \\
  -H "x-openlit-environment: production"`;

export function bearerAuthHeaders(apiKey: string) {
	return `  -H "Authorization: Bearer ${apiKey}" \\
${OPENLIT_CONTEXT_CURL_HEADERS}`;
}

export function bearerSdkAuthHeaders(apiKey: string) {
	return `  -H "Authorization: Bearer ${apiKey}" \\
${OPENLIT_SDK_CONTEXT_CURL_HEADERS}`;
}

export const API_REFERENCE_ENDPOINTS: ApiEndpoint[] = [
	{
		id: "query-logs",
		method: "POST",
		path: "/api/telemetry/logs",
		summary: "Query logs",
		description: "Retrieve a paginated list of telemetry logs matching the provided filters. Requires an OpenLIT API key plus organisation/project/environment headers for signal routing.",
		requestBody: `{
  "timeLimit": {
    "type": "24H",
    "start": "2026-07-07T13:08:52.311Z",
    "end": "2026-07-08T13:09:17.114Z"
  },
  "limit": 25,
  "offset": 0
}`,
		responseBody: `{
  "records": [
    {
      "rowId": "18446744073709551615",
      "Timestamp": "2026-07-08 00:00:00",
      "TraceId": "a1b2c3d4e5f6g7h8",
      "SpanId": "9a8b7c6d5e4f",
      "SeverityText": "INFO",
      "Body": "Application started successfully",
      "ServiceName": "my-llm-service"
    }
  ],
  "total": 1
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/telemetry/logs \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "timeLimit": {
      "type": "24H",
      "start": "2026-07-07T13:08:52.311Z",
      "end": "2026-07-08T13:09:17.114Z"
    },
    "limit": 25
  }'`,
	},
	{
		id: "get-log",
		method: "GET",
		path: "/api/telemetry/logs/{id}",
		summary: "Get log detail",
		description: "Retrieve details of a specific log entry by its hash/row ID.",
		responseBody: `{
  "record": {
    "Timestamp": "2026-07-08 00:00:00",
    "TraceId": "a1b2c3d4e5f6g7h8",
    "SpanId": "9a8b7c6d5e4f",
    "SeverityText": "INFO",
    "Body": "Application started successfully",
    "ServiceName": "my-llm-service",
    "LogAttributes": {
      "environment": "production",
      "version": "1.0.0"
    }
  }
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/telemetry/logs/18446744073709551615 \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "query-metrics",
		method: "POST",
		path: "/api/telemetry/metrics",
		summary: "Query metrics list",
		description: "Retrieve list of aggregated metrics matching the filters.",
		requestBody: `{
  "timeLimit": {
    "type": "24H",
    "start": "2026-07-07T13:08:52.311Z",
    "end": "2026-07-08T13:09:17.114Z"
  }
}`,
		responseBody: `{
  "records": [
    {
      "metricName": "gen_ai.usage.total_tokens",
      "metricType": "Sum",
      "serviceName": "chat-service",
      "latestValue": 1024,
      "avgValue": 512,
      "minValue": 12,
      "maxValue": 2048,
      "pointCount": 84,
      "observationCount": 84,
      "lastSeen": "2026-07-08 00:50:00"
    }
  ],
  "total": 1
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/telemetry/metrics \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "timeLimit": {
      "type": "24H",
      "start": "2026-07-07T13:08:52.311Z",
      "end": "2026-07-08T13:09:17.114Z"
    }
  }'`,
	},
	{
		id: "get-metric-detail",
		method: "POST",
		path: "/api/telemetry/metrics/{name}",
		summary: "Get metric detail",
		description: "Retrieve time-series graph points and detail records for a specific metric.",
		requestBody: `{
  "timeLimit": {
    "type": "24H",
    "start": "2026-07-07T13:08:52.311Z",
    "end": "2026-07-08T13:09:17.114Z"
  },
  "metricType": "Sum",
  "serviceName": "chat-service"
}`,
		responseBody: `{
  "series": [
    {
      "request_time": "2026/07/08 00:00",
      "value": 512
    }
  ],
  "points": []
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/telemetry/metrics/gen_ai.usage.total_tokens \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "timeLimit": {
      "type": "24H",
      "start": "2026-07-07T13:08:52.311Z",
      "end": "2026-07-08T13:09:17.114Z"
    },
    "metricType": "Sum"
  }'`,
	},
	{
		id: "get-compiled-prompt",
		method: "GET",
		path: "/api/prompt/get-compiled",
		summary: "Fetch compiled prompt",
		description:
			"Fetch and compile a prompt by name. Prefer project/environment signal routing for the intelligence ClickHouse; API-key-only clients and optional x-openlit-database-config-id remain supported.",
		curlExample: (apiKey) => `curl -X POST "http://localhost:3000/api/prompt/get-compiled" \\
${bearerSdkAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "summarize-prompt", "shouldCompile": true }'`,
	},
	{
		id: "get-secrets",
		method: "GET",
		path: "/api/vault/get-secrets",
		summary: "Fetch secrets from Vault",
		description:
			"Retrieve Vault secrets. Prefer project/environment signal routing; API-key-only clients and optional x-openlit-database-config-id remain supported.",
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/vault/get-secrets \\
${bearerSdkAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{ "key": "OPENAI_API_KEY" }'`,
	},
	{
		id: "evaluate-rules",
		method: "POST",
		path: "/api/rule-engine/evaluate",
		summary: "Evaluate rule engine config",
		description:
			"Evaluate rules against inputs. Prefer project/environment signal routing; API-key-only clients and optional x-openlit-database-config-id remain supported.",
		requestBody: `{
  "entity_type": "prompt",
  "fields": {
    "input_text": "I need to reset my password, my email is admin@gmail.com"
  }
}`,
		responseBody: `{
  "isRedacted": true,
  "redactedText": "I need to reset my password, my email is [REDACTED]"
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/rule-engine/evaluate \\
${bearerSdkAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "entity_type": "prompt",
    "fields": {
      "input_text": "I need to reset my password, my email is admin@gmail.com"
    }
  }'`,
	},
	{
		id: "rule-list",
		method: "GET",
		path: "/api/rule-engine/rules",
		summary: "List rules",
		description: "Retrieve a list of all defined rules in the rule engine.",
		requestBody: ``,
		responseBody: `[]`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/rule-engine/rules \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "controller-poll",
		method: "POST",
		path: "/api/controller/poll",
		summary: "Controller poll heartbeat",
		description: "Heartbeat and state synchronization endpoint for OpenLIT controllers.",
		requestBody: `{
  "instance_id": "controller-instance-abc",
  "cluster_id": "default",
  "version": "1.0.0",
  "services": []
}`,
		responseBody: `{
  "config_changed": false,
  "config_hash": "a1b2c3d4",
  "actions": []
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/controller/poll \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "instance_id": "controller-instance-abc",
    "cluster_id": "default",
    "version": "1.0.0",
    "services": []
  }'`,
	},
	{
		id: "evaluation-offline",
		method: "POST",
		path: "/api/evaluation/offline",
		summary: "Offline LLM evaluation",
		description: "Run LLM evaluation on historical or external data.",
		requestBody: `{
  "prompt": "I need to reset my password, my email is admin@gmail.com",
  "response": "I can help with that. Please verify your identity.",
  "contexts": [
    "User password reset procedure document."
  ],
  "eval_types": [
    "toxicity",
    "pii"
  ],
  "threshold_score": 0.5,
  "store_results": true,
  "run_id": "run-998877",
  "metadata": {
    "environment": "production"
  }
}`,
		responseBody: `{
  "success": true,
  "evaluations": [
    {
      "type": "toxicity",
      "score": 0.1,
      "verdict": "passed",
      "classification": "safe",
      "explanation": "No toxic language detected."
    }
  ],
  "context_applied": false,
  "metadata": {}
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/evaluation/offline \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "I need to reset my password, my email is admin@gmail.com",
    "response": "I can help with that. Please verify your identity.",
    "contexts": ["User password reset procedure document."],
    "eval_types": ["toxicity", "pii"],
    "threshold_score": 0.5,
    "store_results": true,
    "run_id": "run-998877",
    "metadata": {
      "environment": "production"
    }
  }'`,
	},
	{
		id: "create-prompt",
		method: "POST",
		path: "/api/prompt",
		summary: "Create prompt",
		description: "Create or save prompt configurations in OpenLIT Prompt Hub.",
		requestBody: `{
  "name": "summarize-prompt",
  "prompt": "Summarize this: {{text}}",
  "version": "1.0.0"
}`,
		responseBody: `{
  "success": true
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/prompt \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "summarize-prompt",
    "prompt": "Summarize this: {{text}}",
    "version": "1.0.0"
  }'`,
	},
	{
		id: "get-prompt",
		method: "POST",
		path: "/api/prompt/get",
		summary: "Get prompt details",
		description: "Retrieve details of a prompt version by its name.",
		requestBody: `{
  "name": "summarize-prompt"
}`,
		responseBody: `{
  "id": "prompt-id-123",
  "name": "summarize-prompt",
  "prompt": "Summarize this: {{text}}",
  "version": "1.0.0"
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/prompt/get \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "summarize-prompt"
  }'`,
	},
	{
		id: "list-prompts",
		method: "POST",
		path: "/api/prompt/get",
		summary: "List prompts",
		description: "Retrieve a list of all prompt configurations saved in the Prompt Hub.",
		requestBody: ``,
		responseBody: `[]`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/prompt/get \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "upsert-secret",
		method: "POST",
		path: "/api/vault",
		summary: "Upsert Vault secret",
		description: "Add or update secrets inside the Vault store.",
		requestBody: `{
  "key": "OPENAI_API_KEY",
  "value": "sk-proj-...",
  "tags": ["production"]
}`,
		responseBody: `{
  "id": "secret-id-123",
  "key": "OPENAI_API_KEY",
  "tags": ["production"]
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/vault \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "key": "OPENAI_API_KEY",
    "value": "sk-proj-...",
    "tags": ["production"]
  }'`,
	},
	{
		id: "query-traces",
		method: "POST",
		path: "/api/telemetry/trace",
		summary: "Query traces list",
		description: "Retrieve a paginated list of telemetry trace spans matching the provided filters. Pass `includeFilters=true` as a query parameter or `includeFilters: true` in the JSON body to retrieve inline pagination and dynamic filter metadata. Requires an OpenLIT API key plus project/environment headers for signal routing.",
		requestBody: `{
  "timeLimit": {
    "type": "24H",
    "start": "${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}",
    "end": "${new Date().toISOString()}"
  },
  "limit": 10,
  "offset": 0,
  "selectedConfig": {
    "models": ["gpt-4o", "claude-3-5-sonnet"],
    "providers": ["openai", "anthropic"],
    "serviceNames": ["web-app"],
    "environments": ["production"]
  },
  "sorting": {
    "type": "Timestamp",
    "direction": "desc"
  },
  "includeFilters": true
}`,
		responseBody: `{
  "records": [],
  "total": 0,
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 0
  },
  "filters": {
    "models": ["gpt-4o", "claude-3-5-sonnet"],
    "providers": ["openai", "anthropic"],
    "serviceNames": ["web-app"],
    "environments": ["production"],
    "maxCost": 0.05,
    "totalRows": 150
  }
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/telemetry/trace?includeFilters=true \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "timeLimit": {
      "type": "24H",
      "start": "${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}",
      "end": "${new Date().toISOString()}"
    },
    "limit": 10
  }'`,
	},
	{
		id: "query-exceptions",
		method: "POST",
		path: "/api/telemetry/exception",
		summary: "Query exceptions list",
		description: "Retrieve a paginated list of telemetry exception spans matching the provided filters. Pass `includeFilters=true` as a query parameter or `includeFilters: true` in the JSON body to retrieve inline pagination and dynamic filter metadata.",
		requestBody: `{
  "timeLimit": {
    "type": "24H",
    "start": "${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}",
    "end": "${new Date().toISOString()}"
  },
  "limit": 10,
  "offset": 0,
  "selectedConfig": {
    "models": ["gpt-4o", "claude-3-5-sonnet"],
    "providers": ["openai", "anthropic"],
    "serviceNames": ["web-app"],
    "environments": ["production"]
  },
  "sorting": {
    "type": "Timestamp",
    "direction": "desc"
  },
  "includeFilters": true
}`,
		responseBody: `{
  "records": [],
  "total": 0,
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 0
  },
  "filters": {
    "models": ["gpt-4o", "claude-3-5-sonnet"],
    "providers": ["openai", "anthropic"],
    "serviceNames": ["web-app"],
    "environments": ["production"],
    "maxCost": 0.05,
    "totalRows": 12
  }
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/telemetry/exception?includeFilters=true \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "timeLimit": {
      "type": "24H",
      "start": "${new Date(Date.now() - 24 * 3600 * 1000).toISOString()}",
      "end": "${new Date().toISOString()}"
    },
    "limit": 10
  }'`,
	},
	{
		id: "get-span-detail",
		method: "GET",
		path: "/api/telemetry/trace/span/{id}",
		summary: "Get span detail by ID",
		description: "Retrieve details of a specific trace span by its ID (along with optional evaluation summary data).",
		requestBody: ``,
		responseBody: `{
  "err": null,
  "record": {}
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/telemetry/trace/span/some-span-id \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "get-trace-detail",
		method: "GET",
		path: "/api/telemetry/trace/trace/{id}",
		summary: "Get trace detail by Trace ID",
		description: "Retrieve details of a trace (such as its root span or transaction info) using the Trace ID.",
		requestBody: ``,
		responseBody: `{
  "err": null,
  "record": {}
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/telemetry/trace/trace/some-trace-id \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "get-span-hierarchy",
		method: "GET",
		path: "/api/telemetry/trace/span/{id}/heirarchy",
		summary: "Get trace span hierarchy tree",
		description: "Retrieve the tree hierarchy representation of all related spans associated with a trace span.",
		requestBody: ``,
		responseBody: `{
  "err": null,
  "record": {}
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/telemetry/trace/span/some-span-id/heirarchy \\
${bearerAuthHeaders(apiKey)}`,
	},

	{
		id: "get-ai-analysis",
		method: "GET",
		path: "/api/chat/improvement/{spanId}",
		summary: "Get AI Analysis runs",
		description:
			"Retrieve saved AI Analysis runs for a trace hierarchy (`scope=trace`) or a single span (`scope=span`). Requires an OpenLIT API key plus organisation/project/environment context headers for signal routing.",
		responseBody: `{
  "data": {
    "rootSpanId": "557a2bd43ff129ad",
    "runs": [
      {
        "id": "run-1",
        "scope": "trace",
        "summary": "Focused analysis completed across 6 dimension passes.",
        "createdAt": "2026-09-02T12:00:00.000Z"
      }
    ]
  }
}`,
		curlExample: (apiKey) => `curl -X GET "http://localhost:3000/api/chat/improvement/some-span-id?scope=trace&traceId=some-trace-id" \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "run-ai-analysis",
		method: "POST",
		path: "/api/chat/improvement/{spanId}",
		summary: "Run AI Analysis",
		description:
			"Start a streaming AI Analysis for a trace or span. Requires an OpenLIT API key, Chat Settings, an intelligence ClickHouse connector, and organisation/project/environment context headers.",
		responseBody: `progress events + completed dimension findings (text/plain stream)`,
		curlExample: (apiKey) => `curl -X POST "http://localhost:3000/api/chat/improvement/some-span-id?scope=trace" \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "get-otter-config",
		method: "GET",
		path: "/api/chat/config",
		summary: "Get Ask Otter config",
		description: "Return the Ask Otter provider/model/Vault binding for the current organisation. Requires an OpenLIT API key plus organisation/project/environment context headers.",
		responseBody: `{
  "data": {
    "provider": "openai",
    "model": "gpt-4o",
    "vaultId": "vault-secret-id",
    "meta": "{}"
  }
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/chat/config \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "upsert-otter-config",
		method: "POST",
		path: "/api/chat/config",
		summary: "Upsert Ask Otter config",
		description: "Save the AI provider, model, and Vault secret used by Ask Otter and AI Analysis.",
		requestBody: `{
  "provider": "openai",
  "model": "gpt-4o",
  "vaultId": "vault-secret-id",
  "meta": "{}"
}`,
		responseBody: `{
  "provider": "openai",
  "model": "gpt-4o",
  "vaultId": "vault-secret-id"
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/chat/config \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "provider": "openai",
    "model": "gpt-4o",
    "vaultId": "vault-secret-id"
  }'`,
	},
	{
		id: "list-otter-conversations",
		method: "GET",
		path: "/api/chat/conversation",
		summary: "List Ask Otter conversations",
		description: "List chat conversations for the current user.",
		responseBody: `{
  "data": [
    {
      "id": "conv-1",
      "title": "Investigate high cost traces",
      "provider": "openai",
      "model": "gpt-4o",
      "totalMessages": 4,
      "totalCost": 0.012
    }
  ]
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/chat/conversation \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "create-otter-conversation",
		method: "POST",
		path: "/api/chat/conversation",
		summary: "Create Ask Otter conversation",
		description: "Create a new Ask Otter conversation with optional title, provider, and model.",
		requestBody: `{
  "title": "Investigate high cost traces",
  "provider": "openai",
  "model": "gpt-4o"
}`,
		responseBody: `{
  "data": {
    "id": "conv-1",
    "title": "Investigate high cost traces",
    "provider": "openai",
    "model": "gpt-4o",
    "totalMessages": 0
  }
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/chat/conversation \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Investigate high cost traces",
    "provider": "openai",
    "model": "gpt-4o"
  }'`,
	},
	{
		id: "get-otter-conversation",
		method: "GET",
		path: "/api/chat/conversation/{id}",
		summary: "Get Ask Otter conversation",
		description: "Retrieve a conversation and its message history.",
		responseBody: `{
  "data": {
    "id": "conv-1",
    "title": "Investigate high cost traces",
    "messages": [
      {
        "id": "msg-1",
        "role": "user",
        "content": "Analyze the slowest traces from the last 24 hours"
      }
    ]
  }
}`,
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/chat/conversation/conv-1 \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "delete-otter-conversation",
		method: "DELETE",
		path: "/api/chat/conversation/{id}",
		summary: "Delete Ask Otter conversation",
		description: "Delete a conversation and its messages.",
		responseBody: `{
  "data": "Conversation deleted"
}`,
		curlExample: (apiKey) => `curl -X DELETE http://localhost:3000/api/chat/conversation/conv-1 \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "send-otter-message",
		method: "POST",
		path: "/api/chat/message",
		summary: "Send Ask Otter message",
		description:
			"Stream an assistant reply for a conversation (NDJSON events: delta, step, done, error). Requires organisation/project/environment context for connector routing.",
		requestBody: `{
  "conversationId": "conv-1",
  "content": "Analyze the slowest traces from the last 24 hours"
}`,
		responseBody: `{"type":"step","status":"active","label":"Planning"}
{"type":"delta","text":"Looking at recent high-latency traces..."}
{"type":"done"}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/chat/message \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "conversationId": "conv-1",
    "content": "Analyze the slowest traces from the last 24 hours"
  }'`,
	},
	{
		id: "execute-otter-sql",
		method: "POST",
		path: "/api/chat/message/execute",
		summary: "Execute Ask Otter SQL",
		description:
			"Run a validated read-only SQL query from Ask Otter against the intelligence ClickHouse connector for the active environment. Returns 409 when native SQL chat is unavailable.",
		requestBody: `{
  "messageId": "msg-1",
  "query": "SELECT SpanName, Duration FROM otel_traces LIMIT 10"
}`,
		responseBody: `{
  "data": [],
  "stats": {
    "rowsRead": 0,
    "executionTimeMs": 12,
    "bytesRead": 0
  }
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/chat/message/execute \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "messageId": "msg-1",
    "query": "SELECT SpanName, Duration FROM otel_traces LIMIT 10"
  }'`,
	},
	{
		id: "save-otter-widget",
		method: "POST",
		path: "/api/chat/message/save-widget",
		summary: "Save Ask Otter query as widget",
		description: "Persist a chat SQL query as a dashboard widget.",
		requestBody: `{
  "title": "Slow spans",
  "description": "Top latency spans",
  "type": "table",
  "query": "SELECT SpanName, Duration FROM otel_traces ORDER BY Duration DESC LIMIT 25",
  "boardId": "board-1"
}`,
		responseBody: `{
  "data": {
    "id": "widget-1"
  }
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/chat/message/save-widget \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Slow spans",
    "type": "table",
    "query": "SELECT SpanName, Duration FROM otel_traces ORDER BY Duration DESC LIMIT 25"
  }'`,
	},
	{
		id: "get-otter-usage",
		method: "GET",
		path: "/api/chat/usage",
		summary: "Get Ask Otter usage",
		description: "Aggregate token and cost usage for Otter chat and analysis runs.",
		responseBody: `{
  "data": {
    "totalPromptTokens": 1200,
    "totalCompletionTokens": 800,
    "totalCost": 0.045
  }
}`,
		curlExample: (apiKey) => `curl -X GET "http://localhost:3000/api/chat/usage?start=2026-09-01T00:00:00.000Z&end=2026-09-02T00:00:00.000Z" \\
${bearerAuthHeaders(apiKey)}`,
	},
	{
		id: "improve-prompt-otter",
		method: "POST",
		path: "/api/prompt/improve",
		summary: "Improve prompt with Otter",
		description: "Ask Otter to propose precise prompt edits. Requires an OpenLIT API key, Chat Settings, and organisation/project/environment context headers.",
		requestBody: `{
  "prompt": "You are a helpful assistant. Answer the user question.",
  "promptId": "prompt-1",
  "criteria": [
    "Keep the prompt concise",
    "Preserve template variables"
  ]
}`,
		responseBody: `{
  "data": {
    "suggestions": [
      {
        "id": "add-output-format",
        "dimension": "Output",
        "rationale": "Make the expected response shape explicit.",
        "original": "Answer the user question.",
        "replacement": "Answer the user question as JSON with keys answer and confidence."
      }
    ],
    "provider": "openai",
    "model": "gpt-4o"
  }
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/prompt/improve \\
${bearerAuthHeaders(apiKey)} \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "You are a helpful assistant. Answer the user question.",
    "promptId": "prompt-1"
  }'`,
	},

];
