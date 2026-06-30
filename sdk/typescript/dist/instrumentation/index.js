"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const openai_1 = __importDefault(require("./openai"));
const anthropic_1 = __importDefault(require("./anthropic"));
const cohere_1 = __importDefault(require("./cohere"));
const groq_1 = __importDefault(require("./groq"));
const ai21_1 = __importDefault(require("./ai21"));
const gradient_1 = __importDefault(require("./gradient"));
const mistral_1 = __importDefault(require("./mistral"));
const google_ai_1 = __importDefault(require("./google-ai"));
const vertexai_1 = __importDefault(require("./vertexai"));
const together_1 = __importDefault(require("./together"));
const ollama_1 = __importDefault(require("./ollama"));
const vercel_ai_1 = __importDefault(require("./vercel-ai"));
const langchain_1 = __importDefault(require("./langchain"));
const langgraph_1 = __importDefault(require("./langgraph"));
const pinecone_1 = __importDefault(require("./pinecone"));
const bedrock_1 = __importDefault(require("./bedrock"));
const llamaindex_1 = __importDefault(require("./llamaindex"));
const huggingface_1 = __importDefault(require("./huggingface"));
const replicate_1 = __importDefault(require("./replicate"));
const chroma_1 = __importDefault(require("./chroma"));
const qdrant_1 = __importDefault(require("./qdrant"));
const milvus_1 = __importDefault(require("./milvus"));
const azure_ai_inference_1 = __importDefault(require("./azure-ai-inference"));
const openai_agents_1 = __importDefault(require("./openai-agents"));
const strands_1 = __importDefault(require("./strands"));
const google_adk_1 = __importDefault(require("./google-adk"));
const claude_agent_sdk_1 = __importDefault(require("./claude-agent-sdk"));
const cursor_sdk_1 = __importDefault(require("./cursor-sdk"));
const astra_1 = __importDefault(require("./astra"));
const mcp_1 = __importDefault(require("./mcp"));
const mem0_1 = __importDefault(require("./mem0"));
const elevenlabs_1 = __importDefault(require("./elevenlabs"));
const transformers_1 = __importDefault(require("./transformers"));
/**
 * OTel community instrumentations loaded dynamically (like Python SDK).
 * Each entry maps a logical name to the npm package and exported class.
 * If the package is installed, the instrumentation is registered automatically.
 * If not installed, it is silently skipped.
 *
 * Node.js equivalents of the Python SDK's OTel instrumentations:
 *   Python: requests, urllib, urllib3  → Node: http  (@opentelemetry/instrumentation-http)
 *   Python: httpx, aiohttp-client     → Node: undici (@opentelemetry/instrumentation-undici)
 *   Python: django, flask, fastapi…   → Node: express, fastify, koa, hapi, nestjs-core
 */
const OTEL_COMMUNITY_INSTRUMENTATIONS = {
    // HTTP client instrumentations
    'http': { pkg: '@opentelemetry/instrumentation-http', cls: 'HttpInstrumentation' },
    'undici': { pkg: '@opentelemetry/instrumentation-undici', cls: 'UndiciInstrumentation' },
    // HTTP framework instrumentations
    'express': { pkg: '@opentelemetry/instrumentation-express', cls: 'ExpressInstrumentation' },
    'fastify': { pkg: '@opentelemetry/instrumentation-fastify', cls: 'FastifyInstrumentation' },
    'koa': { pkg: '@opentelemetry/instrumentation-koa', cls: 'KoaInstrumentation' },
    'hapi': { pkg: '@opentelemetry/instrumentation-hapi', cls: 'HapiInstrumentation' },
    'nestjs-core': { pkg: '@opentelemetry/instrumentation-nestjs-core', cls: 'NestInstrumentation' },
};
function loadOtelCommunityInstrumentations(disabledInstrumentors) {
    const instances = [];
    for (const [name, { pkg, cls }] of Object.entries(OTEL_COMMUNITY_INSTRUMENTATIONS)) {
        if (disabledInstrumentors.includes(name))
            continue;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require(pkg);
            const InstrClass = mod[cls];
            if (InstrClass) {
                instances.push(new InstrClass());
            }
        }
        catch {
            // Package not installed — skip silently (same as Python SDK)
        }
    }
    return instances;
}
class Instrumentations {
    static setup(tracerProvider, disabledInstrumentors = [], instrumentations) {
        const otelCommunity = loadOtelCommunityInstrumentations(disabledInstrumentors);
        if (instrumentations === undefined) {
            const filteredInstrumentations = this.getFilteredInstrumentations(disabledInstrumentors);
            (0, instrumentation_1.registerInstrumentations)({
                instrumentations: [
                    ...filteredInstrumentations.map(([_, instrumentation]) => instrumentation),
                    ...otelCommunity,
                ],
                tracerProvider,
            });
        }
        else {
            const filteredInstrumentations = this.getFilteredInstrumentations(disabledInstrumentors, instrumentations);
            filteredInstrumentations.forEach(([k, instrumentation]) => {
                if (this.availableInstrumentations[k].setTracerProvider) {
                    this.availableInstrumentations[k].setTracerProvider(tracerProvider);
                }
                if (this.availableInstrumentations[k].manualPatch) {
                    this.availableInstrumentations[k].manualPatch(instrumentation);
                }
            });
            (0, instrumentation_1.registerInstrumentations)({
                instrumentations: otelCommunity,
                tracerProvider,
            });
        }
    }
    static getFilteredInstrumentations(disabledInstrumentors, instrumentations) {
        const availableInstrumentations = instrumentations || this.availableInstrumentations;
        return Object.keys(availableInstrumentations)
            .filter((k) => {
            if (disabledInstrumentors.includes(k)) {
                if (typeof availableInstrumentations[k].disable === 'function') {
                    availableInstrumentations[k].disable();
                }
                return false;
            }
            if (typeof availableInstrumentations[k].enable === 'function') {
                availableInstrumentations[k].enable();
            }
            return true;
        })
            .map((k) => [k, availableInstrumentations[k]]);
    }
}
Instrumentations.availableInstrumentations = {
    openai: new openai_1.default(),
    anthropic: new anthropic_1.default(),
    cohere: new cohere_1.default(),
    groq: new groq_1.default(),
    ai21: new ai21_1.default(),
    gradient: new gradient_1.default(),
    mistral: new mistral_1.default(),
    'google-ai': new google_ai_1.default(),
    vertexai: new vertexai_1.default(),
    together: new together_1.default(),
    ollama: new ollama_1.default(),
    'vercel-ai': new vercel_ai_1.default(),
    langchain: new langchain_1.default(),
    langgraph: new langgraph_1.default(),
    pinecone: new pinecone_1.default(),
    bedrock: new bedrock_1.default(),
    llamaindex: new llamaindex_1.default(),
    huggingface: new huggingface_1.default(),
    replicate: new replicate_1.default(),
    chroma: new chroma_1.default(),
    qdrant: new qdrant_1.default(),
    milvus: new milvus_1.default(),
    'azure-ai-inference': new azure_ai_inference_1.default(),
    'openai-agents': new openai_agents_1.default(),
    strands: new strands_1.default(),
    'google-adk': new google_adk_1.default(),
    'claude-agent-sdk': new claude_agent_sdk_1.default(),
    'cursor-sdk': new cursor_sdk_1.default(),
    'astra': new astra_1.default(),
    mcp: new mcp_1.default(),
    mem0: new mem0_1.default(),
    elevenlabs: new elevenlabs_1.default(),
    transformers: new transformers_1.default(),
};
exports.default = Instrumentations;
//# sourceMappingURL=index.js.map