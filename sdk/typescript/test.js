/**
 * Comprehensive instrumentation test for ALL GenAI providers AND agent frameworks.
 *
 * Usage:
 *   Set the API keys for the providers you want to test, then run:
 *
 *   OPENAI_API_KEY=sk-...                    \
 *   ANTHROPIC_API_KEY=sk-ant-...             \
 *   COHERE_API_KEY=...                       \
 *   MISTRAL_API_KEY=...                      \
 *   GROQ_API_KEY=gsk_...                     \
 *   TOGETHER_API_KEY=...                     \
 *   GOOGLE_API_KEY=...                       \
 *   HF_TOKEN=hf_...                          \
 *   REPLICATE_API_TOKEN=r8_...               \
 *   AZURE_AI_INFERENCE_ENDPOINT=https://...  \
 *   AZURE_AI_INFERENCE_API_KEY=...           \
 *   node test.js
 *
 *   Providers without keys are automatically skipped.
 *   Ollama requires a local server at 127.0.0.1:11434 (set OLLAMA_TEST=1 to enable).
 *   Bedrock requires AWS credentials in env (set AWS_REGION + AWS creds, or AWS_BEARER_TOKEN_BEDROCK).
 *   Vercel AI requires provider SDK + ai package (set VERCEL_AI_TEST=1 to enable).
 *
 *   Agent Framework tests (require OPENAI_API_KEY and/or ANTHROPIC_API_KEY):
 *     - LangChain:        @langchain/openai + @langchain/core (uses OpenAI)
 *     - LangGraph:        @langchain/langgraph (uses OpenAI, ReAct agent with tools)
 *     - OpenAI Agents:    @openai/agents (uses OpenAI, agent with function tools)
 *     - LlamaIndex:       llamaindex (uses OpenAI, ReAct agent with tools)
 *     - Claude Agent SDK: @anthropic-ai/claude-agent-sdk (uses Anthropic, query with MCP tools)
 *     - Google ADK:       @google/adk (uses GOOGLE_API_KEY)
 *     - Mastra:           @mastra/core (SpanProcessor — needs full Mastra OTel setup)
 *     - Strands:          @strands-agents/sdk (SpanProcessor — needs Strands OTel setup)
 */

const openlit = require('./dist').default;
const { usingAttributes, injectAdditionalAttributes } = require('./dist');

openlit.init({
  customSpanAttributes: { 'team': 'ml-ops', 'project': 'openlit-test' },
  // otlpEndpoint: 'http://localhost:4318',
});

function separator(label) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(70)}\n`);
}

function skip(provider) {
  console.log(`  [SKIP] ${provider} — no API key set\n`);
}

const results = { passed: [], skipped: [], failed: [] };

async function run(name, fn) {
  try {
    await fn();
    results.passed.push(name);
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e.message}`);
    results.failed.push(name);
  }
}

function tryRequire(pkg) {
  try { return require(pkg); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OPENAI
// ═══════════════════════════════════════════════════════════════════════════════

async function testOpenAI() {
  separator('OPENAI');
  if (!process.env.OPENAI_API_KEY) { skip('OpenAI'); results.skipped.push('openai'); return; }
  const OpenAIMod = tryRequire('openai');
  if (!OpenAIMod) { console.log('  [SKIP] openai not installed\n'); results.skipped.push('openai'); return; }
  const OpenAI = OpenAIMod.default || OpenAIMod;
  const client = new OpenAI();

  await run('openai/chat', async () => {
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 10, temperature: 0.5, seed: 42,
    });
    console.log('  Chat:', res.choices[0].message.content);
  });

  await run('openai/chat-stream', async () => {
    const stream = await client.chat.completions.create({
      model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      max_tokens: 30, stream: true,
    });
    let text = '';
    for await (const chunk of stream) { text += chunk.choices[0]?.delta?.content || ''; }
    console.log('  Stream:', text);
  });

  await run('openai/embeddings', async () => {
    const res = await client.embeddings.create({
      model: 'text-embedding-3-small', input: 'Hello world', dimensions: 256,
    });
    console.log('  Embedding dim:', res.data[0].embedding.length, '| tokens:', res.usage.prompt_tokens);
  });

  await run('openai/tools', async () => {
    const res = await injectAdditionalAttributes(
      () => client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [{
          type: 'function', function: {
            name: 'get_weather', description: 'Get weather',
            parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
          },
        }],
        tool_choice: 'auto',
      }),
      { 'user.id': 'user-99' },
    );
    const msg = res.choices[0].message;
    console.log('  Tools:', msg.tool_calls ? msg.tool_calls.map(t => t.function.name).join(', ') : msg.content);
  });

  await run('openai/error', async () => {
    try {
      await client.chat.completions.create({ model: 'nonexistent-model', messages: [{ role: 'user', content: 'test' }] });
      throw new Error('Should have thrown');
    } catch (e) {
      if (e.message === 'Should have thrown') throw e;
      console.log('  Error caught:', e.constructor.name);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ANTHROPIC
// ═══════════════════════════════════════════════════════════════════════════════

async function testAnthropic() {
  separator('ANTHROPIC');
  if (!process.env.ANTHROPIC_API_KEY) { skip('Anthropic'); results.skipped.push('anthropic'); return; }
  const AnthropicMod = tryRequire('@anthropic-ai/sdk');
  if (!AnthropicMod) { console.log('  [SKIP] @anthropic-ai/sdk not installed\n'); results.skipped.push('anthropic'); return; }
  const Anthropic = AnthropicMod.default || AnthropicMod;
  const client = new Anthropic();

  await run('anthropic/chat', async () => {
    const res = await client.messages.create({
      model: 'claude-3-haiku-20240307', max_tokens: 30,
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
    });
    console.log('  Chat:', res.content[0].text);
  });

  await run('anthropic/chat-stream', async () => {
    const stream = await client.messages.create({
      model: 'claude-3-haiku-20240307', max_tokens: 50,
      messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      stream: true,
    });
    let text = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
      }
    }
    console.log('  Stream:', text);
  });

  await run('anthropic/tools', async () => {
    const res = await client.messages.create({
      model: 'claude-3-haiku-20240307', max_tokens: 100,
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      tools: [{
        name: 'get_weather', description: 'Get weather',
        input_schema: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
      }],
    });
    const toolUse = res.content.find(b => b.type === 'tool_use');
    console.log('  Tools:', toolUse ? toolUse.name : 'no tool call');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COHERE
// ═══════════════════════════════════════════════════════════════════════════════

async function testCohere() {
  separator('COHERE');
  if (!process.env.COHERE_API_KEY) { skip('Cohere'); results.skipped.push('cohere'); return; }
  const cohereMod = tryRequire('cohere-ai');
  if (!cohereMod) { console.log('  [SKIP] cohere-ai not installed\n'); results.skipped.push('cohere'); return; }
  const { CohereClient } = cohereMod;
  const client = new CohereClient({ token: process.env.COHERE_API_KEY });

  await run('cohere/chat', async () => {
    const res = await client.chat({
      model: 'command-r-plus-08-2024', message: 'Say hello in one word.',
      maxTokens: 20,
    });
    console.log('  Chat:', res.text);
  });

  await run('cohere/chat-stream', async () => {
    const stream = await client.chatStream({
      model: 'command-r-plus-08-2024', message: 'Count 1 to 3.',
      maxTokens: 50,
    });
    let text = '';
    for await (const event of stream) {
      if (event.eventType === 'text-generation') { text += event.text; }
    }
    console.log('  Stream:', text);
  });

  await run('cohere/embeddings', async () => {
    const res = await client.embed({
      model: 'embed-english-v3.0',
      texts: ['Hello world'],
      inputType: 'search_document',
    });
    console.log('  Embedding dim:', res.embeddings[0]?.length || res.embeddings?.float?.[0]?.length);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MISTRAL
// ═══════════════════════════════════════════════════════════════════════════════

async function testMistral() {
  separator('MISTRAL');
  if (!process.env.MISTRAL_API_KEY) { skip('Mistral'); results.skipped.push('mistral'); return; }
  const mistralMod = tryRequire('@mistralai/mistralai');
  if (!mistralMod) { console.log('  [SKIP] @mistralai/mistralai not installed\n'); results.skipped.push('mistral'); return; }
  const { Mistral } = mistralMod;
  const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

  await run('mistral/chat', async () => {
    const res = await client.chat.complete({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      maxTokens: 20,
    });
    console.log('  Chat:', res.choices[0].message.content);
  });

  await run('mistral/chat-stream', async () => {
    const stream = await client.chat.stream({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      maxTokens: 50,
    });
    let text = '';
    for await (const chunk of stream) {
      text += chunk.data?.choices?.[0]?.delta?.content || '';
    }
    console.log('  Stream:', text);
  });

  await run('mistral/embeddings', async () => {
    const res = await client.embeddings.create({
      model: 'mistral-embed',
      inputs: ['Hello world'],
    });
    console.log('  Embedding dim:', res.data[0].embedding.length);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GROQ
// ═══════════════════════════════════════════════════════════════════════════════

async function testGroq() {
  separator('GROQ');
  if (!process.env.GROQ_API_KEY) { skip('Groq'); results.skipped.push('groq'); return; }
  const GroqMod = tryRequire('groq-sdk');
  if (!GroqMod) { console.log('  [SKIP] groq-sdk not installed\n'); results.skipped.push('groq'); return; }
  const Groq = GroqMod.default || GroqMod;
  const client = new Groq();

  await run('groq/chat', async () => {
    const res = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 20,
    });
    console.log('  Chat:', res.choices[0].message.content);
  });

  await run('groq/chat-stream', async () => {
    const stream = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      max_tokens: 50, stream: true,
    });
    let text = '';
    for await (const chunk of stream) { text += chunk.choices[0]?.delta?.content || ''; }
    console.log('  Stream:', text);
  });

  await run('groq/tools', async () => {
    const res = await client.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      tools: [{
        type: 'function', function: {
          name: 'get_weather', description: 'Get weather',
          parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
        },
      }],
      tool_choice: 'auto',
    });
    const msg = res.choices[0].message;
    console.log('  Tools:', msg.tool_calls ? msg.tool_calls.map(t => t.function.name).join(', ') : msg.content);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TOGETHER
// ═══════════════════════════════════════════════════════════════════════════════

async function testTogether() {
  separator('TOGETHER');
  if (!process.env.TOGETHER_API_KEY) { skip('Together'); results.skipped.push('together'); return; }
  const TogetherMod = tryRequire('together-ai');
  if (!TogetherMod) { console.log('  [SKIP] together-ai not installed\n'); results.skipped.push('together'); return; }
  const Together = TogetherMod.default || TogetherMod;
  const client = new Together();

  await run('together/chat', async () => {
    const res = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 20,
    });
    console.log('  Chat:', res.choices[0].message.content);
  });

  await run('together/chat-stream', async () => {
    const stream = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      max_tokens: 50, stream: true,
    });
    let text = '';
    for await (const chunk of stream) { text += chunk.choices[0]?.delta?.content || ''; }
    console.log('  Stream:', text);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GOOGLE AI (Gemini)
// ═══════════════════════════════════════════════════════════════════════════════

async function testGoogleAI() {
  separator('GOOGLE AI');
  if (!process.env.GOOGLE_API_KEY) { skip('Google AI'); results.skipped.push('google-ai'); return; }
  const googleMod = tryRequire('@google/generative-ai');
  if (!googleMod) { console.log('  [SKIP] @google/generative-ai not installed\n'); results.skipped.push('google-ai'); return; }
  const { GoogleGenerativeAI } = googleMod;
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

  await run('google-ai/chat', async () => {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const res = await model.generateContent('Say hello in one word.');
    console.log('  Chat:', res.response.text());
  });

  await run('google-ai/chat-stream', async () => {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const res = await model.generateContentStream('Count 1 to 3.');
    let text = '';
    for await (const chunk of res.stream) { text += chunk.text(); }
    console.log('  Stream:', text);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OLLAMA (local)
// ═══════════════════════════════════════════════════════════════════════════════

async function testOllama() {
  separator('OLLAMA');
  if (!process.env.OLLAMA_TEST) { skip('Ollama (set OLLAMA_TEST=1)'); results.skipped.push('ollama'); return; }
  const ollamaMod = tryRequire('ollama');
  if (!ollamaMod) { console.log('  [SKIP] ollama not installed\n'); results.skipped.push('ollama'); return; }
  const { Ollama } = ollamaMod;
  const client = new Ollama();

  await run('ollama/chat', async () => {
    const res = await client.chat({
      model: 'llama3.2', messages: [{ role: 'user', content: 'Say hello in one word.' }],
    });
    console.log('  Chat:', res.message.content);
  });

  await run('ollama/chat-stream', async () => {
    const res = await client.chat({
      model: 'llama3.2', messages: [{ role: 'user', content: 'Count 1 to 3.' }],
      stream: true,
    });
    let text = '';
    for await (const chunk of res) { text += chunk.message?.content || ''; }
    console.log('  Stream:', text);
  });

  await run('ollama/embeddings', async () => {
    const res = await client.embeddings({ model: 'llama3.2', prompt: 'Hello world' });
    console.log('  Embedding dim:', res.embedding?.length);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AWS BEDROCK
// ═══════════════════════════════════════════════════════════════════════════════

async function testBedrock() {
  separator('BEDROCK');
  if (!process.env.AWS_REGION && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    skip('Bedrock (set AWS_REGION + AWS creds, or AWS_BEARER_TOKEN_BEDROCK)');
    results.skipped.push('bedrock'); return;
  }
  const bedrockMod = tryRequire('@aws-sdk/client-bedrock-runtime');
  if (!bedrockMod) { console.log('  [SKIP] @aws-sdk/client-bedrock-runtime not installed\n'); results.skipped.push('bedrock'); return; }
  const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = bedrockMod;
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new BedrockRuntimeClient({ region });

  await run('bedrock/chat', async () => {
    const res = await client.send(new ConverseCommand({
      modelId: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', content: [{ text: 'Say hello in one word.' }] }],
      inferenceConfig: { maxTokens: 30, temperature: 0.7 },
    }));
    console.log('  Chat:', res.output?.message?.content?.[0]?.text);
  });

  await run('bedrock/chat-stream', async () => {
    const res = await client.send(new ConverseStreamCommand({
      modelId: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', content: [{ text: 'Count 1 to 3.' }] }],
      inferenceConfig: { maxTokens: 50, temperature: 0.7 },
    }));
    let text = '';
    for await (const event of res.stream) {
      if (event.contentBlockDelta?.delta?.text) { text += event.contentBlockDelta.delta.text; }
    }
    console.log('  Stream:', text);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HUGGINGFACE
// ═══════════════════════════════════════════════════════════════════════════════

async function testHuggingFace() {
  separator('HUGGINGFACE');
  if (!process.env.HF_TOKEN) { skip('HuggingFace'); results.skipped.push('huggingface'); return; }
  const hfMod = tryRequire('@huggingface/inference');
  if (!hfMod) { console.log('  [SKIP] @huggingface/inference not installed\n'); results.skipped.push('huggingface'); return; }
  const { InferenceClient } = hfMod;
  const client = new InferenceClient(process.env.HF_TOKEN);

  await run('huggingface/chat', async () => {
    const res = await client.chatCompletion({
      model: 'mistralai/Mistral-7B-Instruct-v0.3',
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 20,
    });
    console.log('  Chat:', res.choices[0].message.content);
  });

  await run('huggingface/text-generation', async () => {
    const res = await client.textGeneration({
      model: 'mistralai/Mistral-7B-Instruct-v0.3',
      inputs: 'The capital of France is',
      parameters: { max_new_tokens: 20 },
    });
    console.log('  TextGen:', res.generated_text);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REPLICATE
// ═══════════════════════════════════════════════════════════════════════════════

async function testReplicate() {
  separator('REPLICATE');
  if (!process.env.REPLICATE_API_TOKEN) { skip('Replicate'); results.skipped.push('replicate'); return; }
  const replicateMod = tryRequire('replicate');
  if (!replicateMod) { console.log('  [SKIP] replicate not installed\n'); results.skipped.push('replicate'); return; }
  const Replicate = replicateMod.default || replicateMod;
  const client = new Replicate();

  await run('replicate/run', async () => {
    const output = await client.run('meta/meta-llama-3-8b-instruct', {
      input: { prompt: 'Say hello in one word.', max_tokens: 20 },
    });
    const text = Array.isArray(output) ? output.join('') : String(output);
    console.log('  Run:', text.trim());
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AZURE AI INFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

async function testAzureAIInference() {
  separator('AZURE AI INFERENCE');
  if (!process.env.AZURE_AI_INFERENCE_ENDPOINT || !process.env.AZURE_AI_INFERENCE_API_KEY) {
    skip('Azure AI Inference'); results.skipped.push('azure-ai-inference'); return;
  }
  const azureInfMod = tryRequire('@azure-rest/ai-inference');
  const azureAuthMod = tryRequire('@azure/core-auth');
  if (!azureInfMod || !azureAuthMod) { console.log('  [SKIP] @azure-rest/ai-inference or @azure/core-auth not installed\n'); results.skipped.push('azure-ai-inference'); return; }
  const createClient = azureInfMod.default || azureInfMod;
  const { AzureKeyCredential } = azureAuthMod;
  const client = createClient(
    process.env.AZURE_AI_INFERENCE_ENDPOINT,
    new AzureKeyCredential(process.env.AZURE_AI_INFERENCE_API_KEY),
  );

  await run('azure/chat', async () => {
    const res = await client.path('/chat/completions').post({
      body: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
        max_tokens: 20,
      },
    });
    console.log('  Chat:', res.body.choices[0].message.content);
  });

  await run('azure/chat-stream', async () => {
    const coreSseMod = tryRequire('@azure/core-sse');
    if (!coreSseMod) { console.log('  [SKIP] @azure/core-sse not installed'); return; }
    const { createSseStream } = coreSseMod;
    const streamResp = await client.path('/chat/completions').post({
      body: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Count 1 to 3.' }],
        max_tokens: 50, stream: true,
      },
    }).asNodeStream();
    const sseStream = createSseStream(streamResp.body);
    let text = '';
    for await (const event of sseStream) {
      if (event.data === '[DONE]') continue;
      try { text += JSON.parse(event.data).choices?.[0]?.delta?.content || ''; } catch {}
    }
    console.log('  Stream:', text);
  });

  await run('azure/embeddings', async () => {
    const res = await client.path('/embeddings').post({
      body: { model: 'text-embedding-3-small', input: ['Hello world'] },
    });
    console.log('  Embedding dim:', res.body.data[0].embedding.length);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LANGCHAIN (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testLangChain() {
  separator('LANGCHAIN');
  if (!process.env.OPENAI_API_KEY) { skip('LangChain (needs OPENAI_API_KEY)'); results.skipped.push('langchain'); return; }
  const lcOpenAI = tryRequire('@langchain/openai');
  const lcTools = tryRequire('@langchain/core/tools');
  const zod = tryRequire('zod');
  if (!lcOpenAI || !lcTools || !zod) {
    console.log('  [SKIP] @langchain/openai, @langchain/core/tools, or zod not installed');
    results.skipped.push('langchain'); return;
  }
  const { ChatOpenAI } = lcOpenAI;
  const { tool: lcTool } = lcTools;
  const { z } = zod;

  const model = new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0, maxTokens: 100 });

  await run('langchain/chat', async () => {
    const res = await model.invoke('Say hello in one word.');
    console.log('  Chat:', typeof res.content === 'string' ? res.content : JSON.stringify(res.content));
  });

  await run('langchain/tools', async () => {
    const getWeather = lcTool(
      async ({ location }) => `Sunny, 22°C in ${location}`,
      {
        name: 'get_weather',
        description: 'Get weather for a location',
        schema: z.object({ location: z.string().describe('City name') }),
      }
    );
    const modelWithTools = model.bindTools([getWeather]);
    const res = await modelWithTools.invoke('What is the weather in Paris?');
    const toolCalls = res.tool_calls || [];
    console.log('  Tool calls:', toolCalls.length ? toolCalls.map(t => `${t.name}(${JSON.stringify(t.args)})`).join(', ') : res.content);
  });

  await run('langchain/stream', async () => {
    let text = '';
    const stream = await model.stream('Count 1 to 3 briefly.');
    for await (const chunk of stream) { text += (typeof chunk.content === 'string' ? chunk.content : ''); }
    console.log('  Stream:', text);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LANGGRAPH (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testLangGraph() {
  separator('LANGGRAPH');
  if (!process.env.OPENAI_API_KEY) { skip('LangGraph (needs OPENAI_API_KEY)'); results.skipped.push('langgraph'); return; }
  const lgPrebuilt = tryRequire('@langchain/langgraph/prebuilt');
  const lcOpenAI = tryRequire('@langchain/openai');
  const lcTools = tryRequire('@langchain/core/tools');
  const zod = tryRequire('zod');
  if (!lgPrebuilt || !lcOpenAI || !lcTools || !zod) {
    console.log('  [SKIP] @langchain/langgraph/prebuilt, @langchain/openai, @langchain/core/tools, or zod not installed');
    results.skipped.push('langgraph'); return;
  }
  const { createReactAgent } = lgPrebuilt;
  const { ChatOpenAI } = lcOpenAI;
  const { tool: lcTool } = lcTools;
  const { z } = zod;

  const getWeather = lcTool(
    async ({ location }) => `Sunny, 22°C in ${location}`,
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      schema: z.object({ location: z.string().describe('City name') }),
    }
  );

  const calculate = lcTool(
    async ({ expression }) => {
      try { return String(Function('"use strict"; return (' + expression + ')')()); }
      catch { return 'Error evaluating expression'; }
    },
    {
      name: 'calculate',
      description: 'Evaluate a math expression',
      schema: z.object({ expression: z.string().describe('Math expression like "2+2"') }),
    }
  );

  const model = new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0 });
  const agent = createReactAgent({ llm: model, tools: [getWeather, calculate] });

  await run('langgraph/agent-invoke', async () => {
    const res = await agent.invoke(
      { messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }] }
    );
    const last = res.messages[res.messages.length - 1];
    console.log('  Agent:', typeof last.content === 'string' ? last.content : JSON.stringify(last.content));
  });

  await run('langgraph/agent-stream', async () => {
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: 'What is 42 * 17?' }] }
    );
    let lastContent = '';
    for await (const chunk of stream) {
      const msgs = chunk.agent?.messages || chunk.__end__?.messages;
      if (msgs && msgs.length > 0) {
        const c = msgs[msgs.length - 1].content;
        if (c) lastContent = typeof c === 'string' ? c : JSON.stringify(c);
      }
    }
    console.log('  Stream:', lastContent);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OPENAI AGENTS (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testOpenAIAgents() {
  separator('OPENAI AGENTS');
  if (!process.env.OPENAI_API_KEY) { skip('OpenAI Agents (needs OPENAI_API_KEY)'); results.skipped.push('openai-agents'); return; }
  const agentsMod = tryRequire('@openai/agents');
  const zod = tryRequire('zod');
  if (!agentsMod || !zod) {
    console.log('  [SKIP] @openai/agents or zod not installed');
    results.skipped.push('openai-agents'); return;
  }
  const { Agent, run: agentRun, tool: agentTool } = agentsMod;
  const { z } = zod;

  const getWeather = agentTool({
    name: 'get_weather',
    description: 'Get the current weather for a city',
    parameters: z.object({ city: z.string() }),
    async execute({ city }) {
      return `The weather in ${city} is sunny, 22°C.`;
    },
  });

  const lookupCity = agentTool({
    name: 'lookup_city',
    description: 'Look up a city by country name',
    parameters: z.object({ country: z.string() }),
    async execute({ country }) {
      const capitals = { France: 'Paris', Japan: 'Tokyo', Germany: 'Berlin' };
      return capitals[country] || `Capital of ${country}`;
    },
  });

  const agent = new Agent({
    name: 'WeatherBot',
    model: 'gpt-4o-mini',
    instructions: 'You are a helpful weather assistant. Use tools to answer questions. Be concise.',
    tools: [getWeather, lookupCity],
  });

  await run('openai-agents/agent-run', async () => {
    const result = await agentRun(agent, 'What is the weather in Paris?');
    console.log('  Agent:', result.finalOutput);
  });

  await run('openai-agents/agent-multi-tool', async () => {
    const result = await agentRun(agent, 'Look up the capital of Japan and tell me its weather.');
    console.log('  Multi-tool:', result.finalOutput);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LLAMAINDEX (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testLlamaIndex() {
  separator('LLAMAINDEX');
  if (!process.env.OPENAI_API_KEY) { skip('LlamaIndex (needs OPENAI_API_KEY)'); results.skipped.push('llamaindex'); return; }
  const li = tryRequire('llamaindex');
  if (!li) { console.log('  [SKIP] llamaindex not installed'); results.skipped.push('llamaindex'); return; }
  const { ReActAgent, FunctionTool, Settings } = li;

  const llamaOpenAIMod = tryRequire('@llamaindex/openai');
  if (!llamaOpenAIMod) { console.log('  [SKIP] @llamaindex/openai not installed'); results.skipped.push('llamaindex'); return; }
  const { OpenAI: LlamaOpenAI } = llamaOpenAIMod;
  Settings.llm = new LlamaOpenAI({ model: 'gpt-4o-mini', temperature: 0 });

  const weatherTool = FunctionTool.from(
    ({ location }) => `The weather in ${location} is sunny, 22°C.`,
    {
      name: 'get_weather',
      description: 'Get weather for a location',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'City name' } },
        required: ['location'],
      },
    }
  );

  const calculatorTool = FunctionTool.from(
    ({ expression }) => {
      try { return String(Function('"use strict"; return (' + expression + ')')()); }
      catch { return 'Error evaluating expression'; }
    },
    {
      name: 'calculate',
      description: 'Evaluate a mathematical expression',
      parameters: {
        type: 'object',
        properties: { expression: { type: 'string', description: 'Math expression like "2+2"' } },
        required: ['expression'],
      },
    }
  );

  const agent = new ReActAgent({
    tools: [weatherTool, calculatorTool],
  });

  await run('llamaindex/agent-chat', async () => {
    const res = await agent.chat({ message: 'What is the weather in London?' });
    console.log('  Agent:', res.message?.content || String(res));
  });

  await run('llamaindex/agent-tool-chain', async () => {
    const res = await agent.chat({ message: 'What is 123 * 456?' });
    console.log('  Calculator:', res.message?.content || String(res));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLAUDE AGENT SDK (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testClaudeAgentSDK() {
  separator('CLAUDE AGENT SDK');
  if (!process.env.ANTHROPIC_API_KEY) { skip('Claude Agent SDK (needs ANTHROPIC_API_KEY)'); results.skipped.push('claude-agent-sdk'); return; }
  const claudeMod = tryRequire('@anthropic-ai/claude-agent-sdk');
  const zod = tryRequire('zod');
  if (!claudeMod || !zod) {
    console.log('  [SKIP] @anthropic-ai/claude-agent-sdk or zod not installed');
    results.skipped.push('claude-agent-sdk'); return;
  }
  const { query, tool: claudeTool, createSdkMcpServer } = claudeMod;
  const { z } = zod;

  const getWeather = claudeTool(
    'get_weather',
    'Get the current weather for a location',
    { location: z.string().describe('City name') },
    async (args) => ({
      content: [{ type: 'text', text: `Sunny, 22°C in ${args.location}` }],
    })
  );

  const weatherServer = createSdkMcpServer({
    name: 'weather',
    version: '1.0.0',
    tools: [getWeather],
  });

  await run('claude-agent-sdk/query-with-tool', async () => {
    let resultText = '';
    for await (const message of query({
      prompt: 'What is the weather in Paris? Be very brief.',
      options: {
        model: 'claude-sonnet-4-20250514',
        maxTurns: 3,
        mcpServers: { weather: weatherServer },
        allowedTools: ['mcp__weather__get_weather'],
      },
    })) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result || '';
      }
      if (message.type === 'assistant' && message.message?.content) {
        const textBlocks = message.message.content.filter(b => b.type === 'text');
        if (textBlocks.length > 0) resultText = textBlocks.map(b => b.text).join('');
      }
    }
    console.log('  Agent:', resultText.substring(0, 200));
  });

  await run('claude-agent-sdk/query-simple', async () => {
    let resultText = '';
    for await (const message of query({
      prompt: 'Say hello in one word.',
      options: { model: 'claude-sonnet-4-20250514', maxTurns: 1 },
    })) {
      if (message.type === 'result' && message.subtype === 'success') {
        resultText = message.result || '';
      }
      if (message.type === 'assistant' && message.message?.content) {
        const textBlocks = message.message.content.filter(b => b.type === 'text');
        if (textBlocks.length > 0) resultText = textBlocks.map(b => b.text).join('');
      }
    }
    console.log('  Simple:', resultText.substring(0, 200));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GOOGLE ADK (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testGoogleADK() {
  separator('GOOGLE ADK');
  if (!process.env.GOOGLE_API_KEY) { skip('Google ADK (needs GOOGLE_API_KEY)'); results.skipped.push('google-adk'); return; }
  const adkMod = tryRequire('@google/adk');
  if (!adkMod) { console.log('  [SKIP] @google/adk not installed or missing deps'); results.skipped.push('google-adk'); return; }

  const LlmAgent = adkMod.LlmAgent || adkMod.Agent;
  const Runner = adkMod.Runner;
  if (!LlmAgent || !Runner) { console.log('  [SKIP] @google/adk missing LlmAgent or Runner'); results.skipped.push('google-adk'); return; }

  const agent = new LlmAgent({
    name: 'weather_agent',
    model: 'gemini-2.0-flash',
    instruction: 'You are a helpful weather assistant. Be concise.',
  });

  await run('google-adk/agent', async () => {
    const runner = new Runner({ agent, appName: 'openlit-test' });
    const res = await runner.runAsync({ userId: 'test-user', sessionId: 'test-session', newMessage: 'Say hello.' });
    let text = '';
    for await (const event of res) {
      if (event.content?.parts) text = event.content.parts.map(p => p.text || '').join('');
    }
    console.log('  Agent:', text);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MASTRA (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testMastra() {
  separator('MASTRA');
  const mastraMod = tryRequire('@mastra/core');
  if (!mastraMod) { console.log('  [SKIP] @mastra/core not installed'); results.skipped.push('mastra'); return; }
  if (!process.env.OPENAI_API_KEY) { skip('Mastra (needs OPENAI_API_KEY)'); results.skipped.push('mastra'); return; }

  console.log('  [SKIP] Mastra requires @mastra/otel-bridge setup for span generation.');
  console.log('  The OpenLIT instrumentation enriches Mastra-produced spans via SpanProcessor.');
  console.log('  For a full test, set up a Mastra app with OTel bridge enabled.');
  results.skipped.push('mastra');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STRANDS AGENTS (Agent Framework)
// ═══════════════════════════════════════════════════════════════════════════════

async function testStrands() {
  separator('STRANDS AGENTS');
  const strandsMod = tryRequire('@strands-agents/sdk');
  if (!strandsMod) { console.log('  [SKIP] @strands-agents/sdk not installed'); results.skipped.push('strands'); return; }

  console.log('  [SKIP] Strands requires its own tracer setup (strands.telemetry.tracer) for span generation.');
  console.log('  The OpenLIT instrumentation enriches Strands-produced spans via SpanProcessor.');
  console.log('  For a full test, set up a Strands agent app with its native OTel telemetry enabled.');
  results.skipped.push('strands');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('OpenLIT Instrumentation Test — Providers + Agent Frameworks');
  console.log('Providers/Frameworks without API keys or deps will be skipped.\n');
  console.log('Check span output for:');
  console.log('  - Span names: "{operation} {model}"');
  console.log('  - gen_ai.provider.name, gen_ai.operation.name');
  console.log('  - server.address, server.port');
  console.log('  - gen_ai.usage.input_tokens, gen_ai.usage.output_tokens');
  console.log('  - error.type on error spans');
  console.log('  - Events: gen_ai.client.inference.operation.details');
  console.log('  - Custom attrs: team, project (global), user.id (context)');
  console.log('  - Agent spans: create_agent, invoke_agent, invoke_workflow, execute_tool\n');

  // --- Provider tests ---
  separator('═══  PROVIDER TESTS  ═══');
  await testOpenAI();
  await testAnthropic();
  await testCohere();
  await testMistral();
  await testGroq();
  await testTogether();
  await testGoogleAI();
  await testOllama();
  await testBedrock();
  await testHuggingFace();
  await testReplicate();
  await testAzureAIInference();

  // --- Agent Framework tests ---
  separator('═══  AGENT FRAMEWORK TESTS  ═══');
  await testLangChain();
  await testLangGraph();
  await testOpenAIAgents();
  await testLlamaIndex();
  await testClaudeAgentSDK();
  await testGoogleADK();
  await testMastra();
  await testStrands();

  separator('SUMMARY');
  console.log(`  Passed:  ${results.passed.length} — ${results.passed.join(', ') || 'none'}`);
  console.log(`  Skipped: ${results.skipped.length} — ${results.skipped.join(', ') || 'none'}`);
  console.log(`  Failed:  ${results.failed.length} — ${results.failed.join(', ') || 'none'}`);

  const { trace: traceApi } = require('@opentelemetry/api');
  const { logs } = require('@opentelemetry/api-logs');
  const { metrics } = require('@opentelemetry/api');

  const tracerProvider = traceApi.getTracerProvider();
  if (tracerProvider && typeof tracerProvider.forceFlush === 'function') {
    await tracerProvider.forceFlush();
  }
  const loggerProvider = logs.getLoggerProvider();
  if (loggerProvider && typeof loggerProvider.forceFlush === 'function') {
    await loggerProvider.forceFlush();
  }
  const meterProvider = metrics.getMeterProvider();
  if (meterProvider && typeof meterProvider.forceFlush === 'function') {
    await meterProvider.forceFlush();
  }
  await new Promise(r => setTimeout(r, 2000));
  process.exit(0);
}

main();
