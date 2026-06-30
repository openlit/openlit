import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  tool,
} from '@openai/agents';

const MOCK_HOST = process.env.MOCK_LLM_HOST || '127.0.0.1';
const MOCK_PORT = Number(process.env.MOCK_LLM_PORT || 8091);
const MODEL = process.env.AGENT_MODEL || 'gpt-4o-mini';
const REQUEST_INTERVAL_SECONDS = Number(process.env.REQUEST_INTERVAL_SECONDS || 20);

const prompts = [
  'Plan a practical three-step rollout for adding evals to an AI support agent.',
  'Summarize the operational risks of shipping a tool-using agent to production.',
  'Draft a concise checklist for debugging missing traces in a JavaScript agent app.',
  'Suggest a safe architecture for an agent that can query docs and create tickets.',
];

const toolResults = {
  lookup_runbook:
    'Runbook: verify SDK preload, confirm OTLP endpoint, check service.name, inspect resource attributes.',
  score_agent_risk:
    'Risk score: medium. Main controls: tool allowlists, retries, eval coverage, and trace review.',
};

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function hasToolResult(messages) {
  return Array.isArray(messages) && messages.some((message) => message.role === 'tool');
}

function buildChatCompletion(body) {
  const id = `chatcmpl-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const model = body.model || MODEL;
  const messages = body.messages || [];
  const tools = body.tools || [];

  let message;
  let finishReason;
  if (tools.length > 0 && !hasToolResult(messages)) {
    const requestedTool = tools.find((item) => item?.function?.name === 'lookup_runbook') || tools[0];
    message = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call_${randomUUID().replaceAll('-', '').slice(0, 10)}`,
          type: 'function',
          function: {
            name: requestedTool.function.name,
            arguments: JSON.stringify({ topic: 'agent observability' }),
          },
        },
      ],
    };
    finishReason = 'tool_calls';
  } else {
    message = {
      role: 'assistant',
      content:
        'Use a controller-injected OpenLIT SDK preload, keep framework spans separate from direct LLM calls, and validate with a mock LLM before production rollout.',
    };
    finishReason = 'stop';
  }

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 96,
      completion_tokens: 38,
      total_tokens: 134,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  };
}

function startMockServer() {
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = await readRequestBody(req);
      jsonResponse(res, 200, buildChatCompletion(body));
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      jsonResponse(res, 200, { status: 'ok' });
      return;
    }
    jsonResponse(res, 404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(MOCK_PORT, MOCK_HOST, () => {
      console.log(`[mock-llm] listening on http://${MOCK_HOST}:${MOCK_PORT}/v1`);
      resolve(server);
    });
  });
}

const lookupRunbook = tool({
  name: 'lookup_runbook',
  description: 'Look up an internal agent-observability runbook by topic.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Operational topic to look up.',
      },
    },
    required: ['topic'],
    additionalProperties: false,
  },
  strict: false,
  execute: async () => toolResults.lookup_runbook,
});

const scoreAgentRisk = tool({
  name: 'score_agent_risk',
  description: 'Return a simple operational risk summary for an agent workflow.',
  parameters: {
    type: 'object',
    properties: {
      workflow: {
        type: 'string',
        description: 'Agent workflow to assess.',
      },
    },
    required: ['workflow'],
    additionalProperties: false,
  },
  strict: false,
  execute: async () => toolResults.score_agent_risk,
});

await startMockServer();

setOpenAIAPI('chat_completions');
setDefaultOpenAIClient(
  new OpenAI({
    apiKey: 'sk-mock-not-real',
    baseURL: `http://${MOCK_HOST}:${MOCK_PORT}/v1`,
  }),
);
// Keep local mock runs quiet; controller-managed OpenLIT injection replaces
// the Agents SDK trace processor and needs tracing enabled for framework spans.
setTracingDisabled(process.env.OPENLIT_CONTROLLER_MODE !== 'agent_observability');

const agent = new Agent({
  name: 'js-agent-framework-demo',
  model: MODEL,
  instructions:
    'You are a production AI agent engineer. Use tools when useful, then answer with a concise operational recommendation.',
  tools: [lookupRunbook, scoreAgentRisk],
});

console.log(
  `[agent] OpenAI Agents JS demo starting with model='${MODEL}', interval=${REQUEST_INTERVAL_SECONDS}s`,
);

let i = 0;
while (true) {
  const prompt = prompts[i % prompts.length];
  try {
    const result = await run(agent, prompt, { maxTurns: 4 });
    console.log(`[${i}] ${result.finalOutput}`);
  } catch (error) {
    console.log(`[${i}] error: ${error?.stack || error}`);
  }
  i += 1;
  await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_SECONDS * 1000));
}
