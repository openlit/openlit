import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { InstrumentationType, OpenlitInstrumentations } from '../types';

import { TracerProvider } from '@opentelemetry/api';
import OpenAIInstrumentation from './openai';
import AnthropicInstrumentation from './anthropic';
import CohereInstrumentation from './cohere';
import GroqInstrumentation from './groq';
import MistralInstrumentation from './mistral';
import GoogleAIInstrumentation from './google-ai';
import TogetherInstrumentation from './together';
import OllamaInstrumentation from './ollama';
import VercelAIInstrumentation from './vercel-ai';
import LangChainInstrumentation from './langchain';
import PineconeInstrumentation from './pinecone';
import BedrockInstrumentation from './bedrock';
import LlamaIndexInstrumentation from './llamaindex';
import HuggingFaceInstrumentation from './huggingface';
import ReplicateInstrumentation from './replicate';
import ChromaInstrumentation from './chroma';
import QdrantInstrumentation from './qdrant';
import MilvusInstrumentation from './milvus';
import AzureAIInferenceInstrumentation from './azure-ai-inference';

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
const OTEL_COMMUNITY_INSTRUMENTATIONS: Record<string, { pkg: string; cls: string }> = {
  // HTTP client instrumentations
  'http':         { pkg: '@opentelemetry/instrumentation-http',         cls: 'HttpInstrumentation' },
  'undici':       { pkg: '@opentelemetry/instrumentation-undici',       cls: 'UndiciInstrumentation' },
  // HTTP framework instrumentations
  'express':      { pkg: '@opentelemetry/instrumentation-express',      cls: 'ExpressInstrumentation' },
  'fastify':      { pkg: '@opentelemetry/instrumentation-fastify',      cls: 'FastifyInstrumentation' },
  'koa':          { pkg: '@opentelemetry/instrumentation-koa',          cls: 'KoaInstrumentation' },
  'hapi':         { pkg: '@opentelemetry/instrumentation-hapi',         cls: 'HapiInstrumentation' },
  'nestjs-core':  { pkg: '@opentelemetry/instrumentation-nestjs-core',  cls: 'NestInstrumentation' },
};

function loadOtelCommunityInstrumentations(disabledInstrumentors: string[]): any[] {
  const instances: any[] = [];
  for (const [name, { pkg, cls }] of Object.entries(OTEL_COMMUNITY_INSTRUMENTATIONS)) {
    if (disabledInstrumentors.includes(name)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(pkg);
      const InstrClass = mod[cls];
      if (InstrClass) {
        instances.push(new InstrClass());
      }
    } catch {
      // Package not installed — skip silently (same as Python SDK)
    }
  }
  return instances;
}

export default class Instrumentations {
  static availableInstrumentations: OpenlitInstrumentations = {
    openai: new OpenAIInstrumentation(),
    anthropic: new AnthropicInstrumentation(),
    cohere: new CohereInstrumentation(),
    groq: new GroqInstrumentation(),
    mistral: new MistralInstrumentation(),
    'google-ai': new GoogleAIInstrumentation(),
    together: new TogetherInstrumentation(),
    ollama: new OllamaInstrumentation(),
    'vercel-ai': new VercelAIInstrumentation(),
    langchain: new LangChainInstrumentation(),
    pinecone: new PineconeInstrumentation(),
    bedrock: new BedrockInstrumentation(),
    llamaindex: new LlamaIndexInstrumentation(),
    huggingface: new HuggingFaceInstrumentation(),
    replicate: new ReplicateInstrumentation(),
    chroma: new ChromaInstrumentation(),
    qdrant: new QdrantInstrumentation(),
    milvus: new MilvusInstrumentation(),
    'azure-ai-inference': new AzureAIInferenceInstrumentation(),
  };

  static setup(
    tracerProvider: TracerProvider,
    disabledInstrumentors: string[] = [],
    instrumentations?: OpenlitInstrumentations
  ) {
    const otelCommunity = loadOtelCommunityInstrumentations(disabledInstrumentors);

    if (instrumentations === undefined) {
      const filteredInstrumentations = this.getFilteredInstrumentations(disabledInstrumentors);
      registerInstrumentations({
        instrumentations: [
          ...filteredInstrumentations.map(([_, instrumentation]) => instrumentation),
          ...otelCommunity,
        ],
        tracerProvider,
      });
    } else {
      const filteredInstrumentations = this.getFilteredInstrumentations(
        disabledInstrumentors,
        instrumentations
      );
      filteredInstrumentations.forEach(([k, instrumentation]) => {
        if (this.availableInstrumentations[k].setTracerProvider) {
          this.availableInstrumentations[k].setTracerProvider(tracerProvider);
        }
        if (this.availableInstrumentations[k].manualPatch) {
          this.availableInstrumentations[k].manualPatch(instrumentation);
        }
      });
      registerInstrumentations({
        instrumentations: otelCommunity,
        tracerProvider,
      });
    }
  }

  static getFilteredInstrumentations(
    disabledInstrumentors: string[],
    instrumentations?: OpenlitInstrumentations
  ): [InstrumentationType, any][] {
    const availableInstrumentations = instrumentations || this.availableInstrumentations;
    return Object.keys(availableInstrumentations)
      .filter((k) => {
        if (disabledInstrumentors.includes(k)) {
          if (typeof availableInstrumentations[k as InstrumentationType].disable === 'function') {
            availableInstrumentations[k as InstrumentationType].disable();
          }
          return false;
        }

        if (typeof availableInstrumentations[k as InstrumentationType].enable === 'function') {
          availableInstrumentations[k as InstrumentationType].enable();
        }

        return true;
      })
      .map((k) => [k as InstrumentationType, availableInstrumentations[k as InstrumentationType]]);
  }
}
