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

export const API_REFERENCE_ENDPOINTS: ApiEndpoint[] = [
	{
		id: "query-logs",
		method: "POST",
		path: "/api/telemetry/logs",
		summary: "Query logs",
		description: "Retrieve a paginated list of telemetry logs matching the provided filters.",
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}"`,
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}" \\
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
		description: "Fetch and compile a prompt by name with dynamic variable interpolation.",
		curlExample: (apiKey) => `curl -X GET "http://localhost:3000/api/prompt/get-compiled?name=summarize-prompt" \\
  -H "Authorization: Bearer ${apiKey}"`,
	},
	{
		id: "get-secrets",
		method: "GET",
		path: "/api/vault/get-secrets",
		summary: "Fetch secrets from Vault",
		description: "Safely retrieve API keys or credentials stored in the OpenLIT Vault.",
		curlExample: (apiKey) => `curl -X GET http://localhost:3000/api/vault/get-secrets \\
  -H "Authorization: Bearer ${apiKey}"`,
	},
	{
		id: "evaluate-rules",
		method: "POST",
		path: "/api/rule-engine/evaluate",
		summary: "Evaluate rule engine config",
		description: "Evaluate rules (e.g. redaction, prompts, guardrails) against inputs.",
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}"`,
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  "evalType": "toxicity",
  "inputText": "Evaluate this prompt"
}`,
		responseBody: `{
  "success": true,
  "score": 0.1,
  "verdict": "passed"
}`,
		curlExample: (apiKey) => `curl -X POST http://localhost:3000/api/evaluation/offline \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "evalType": "toxicity",
    "inputText": "Evaluate this prompt"
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}"`,
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
  -H "Authorization: Bearer ${apiKey}" \\
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
		description: "Retrieve a paginated list of telemetry trace spans matching the provided filters. Pass `includeFilters=true` as a query parameter or `includeFilters: true` in the JSON body to retrieve inline pagination and dynamic filter metadata.",
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}" \\
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
  -H "Authorization: Bearer ${apiKey}"`,
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
  -H "Authorization: Bearer ${apiKey}"`,
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
  -H "Authorization: Bearer ${apiKey}"`,
	},
];
