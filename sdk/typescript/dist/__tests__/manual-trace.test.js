"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const config_1 = __importDefault(require("../config"));
const semantic_convention_1 = __importDefault(require("../semantic-convention"));
const manual_trace_1 = require("../manual-trace");
describe('manual-trace', () => {
    let exporter;
    let provider;
    beforeAll(() => {
        exporter = new sdk_trace_base_1.InMemorySpanExporter();
        provider = new sdk_trace_node_1.NodeTracerProvider({
            spanProcessors: [new sdk_trace_base_1.SimpleSpanProcessor(exporter)],
        });
        provider.register();
        config_1.default.updateConfig({
            tracer: provider,
            applicationName: 'TestApp',
            environment: 'TestEnv',
        });
    });
    beforeEach(() => {
        exporter.reset();
    });
    afterAll(async () => {
        await provider.shutdown();
    });
    it('startTrace nests child spans under the manual span', async () => {
        await (0, manual_trace_1.startTrace)('parent-operation', async () => {
            await api_1.trace.getTracer('openlit').startActiveSpan('child-llm', (child) => {
                child.setAttribute('gen_ai.system', 'openai');
                child.end();
            });
        });
        const spans = exporter.getFinishedSpans();
        expect(spans).toHaveLength(2);
        const parentSpan = spans.find((s) => s.name === 'parent-operation');
        const childSpan = spans.find((s) => s.name === 'child-llm');
        expect(parentSpan).toBeDefined();
        expect(childSpan).toBeDefined();
        expect(childSpan.parentSpanContext?.spanId).toBe(parentSpan.spanContext().spanId);
        expect(parentSpan.attributes[semantic_conventions_1.ATTR_SERVICE_NAME]).toBe('TestApp');
        expect(parentSpan.attributes[semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe('TestEnv');
        expect(parentSpan.status.code).toBe(api_1.SpanStatusCode.OK);
    });
    it('startTrace nests child spans across await boundaries', async () => {
        await (0, manual_trace_1.startTrace)('async-parent', async () => {
            await Promise.resolve();
            api_1.trace.getTracer('openlit').startActiveSpan('async-child', (child) => {
                child.end();
            });
        });
        const spans = exporter.getFinishedSpans();
        const parentSpan = spans.find((s) => s.name === 'async-parent');
        const childSpan = spans.find((s) => s.name === 'async-child');
        expect(childSpan.parentSpanContext?.spanId).toBe(parentSpan.spanContext().spanId);
    });
    it('startTrace setResult and setMetadata stamp attributes', async () => {
        await (0, manual_trace_1.startTrace)('metadata-test', async (span) => {
            span.setResult('hello');
            span.setMetadata({ 'custom.key': 'value', count: 3 });
        });
        const finished = exporter.getFinishedSpans()[0];
        expect(finished.attributes[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]).toBe('hello');
        expect(finished.attributes['custom.key']).toBe('value');
        expect(finished.attributes.count).toBe(3);
    });
    it('trace() ends span on sync success and nests children', () => {
        const result = (0, manual_trace_1.trace)('sync-chain', (span) => {
            api_1.trace.getTracer('openlit').startActiveSpan('sync-child', (child) => {
                child.end();
            });
            span.setResult('done');
            return 42;
        });
        expect(result).toBe(42);
        const spans = exporter.getFinishedSpans();
        const parentSpan = spans.find((s) => s.name === 'sync-chain');
        const childSpan = spans.find((s) => s.name === 'sync-child');
        expect(childSpan.parentSpanContext?.spanId).toBe(parentSpan.spanContext().spanId);
        expect(parentSpan.attributes[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]).toBe('done');
        expect(parentSpan.status.code).toBe(api_1.SpanStatusCode.OK);
    });
    it('trace() ends span on async success', async () => {
        const result = await (0, manual_trace_1.trace)('async-chain', async (span) => {
            await Promise.resolve();
            span.setResult('async-done');
            return 'ok';
        });
        expect(result).toBe('ok');
        const parentSpan = exporter.getFinishedSpans().find((s) => s.name === 'async-chain');
        expect(parentSpan.attributes[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES]).toBe('async-done');
        expect(parentSpan.status.code).toBe(api_1.SpanStatusCode.OK);
    });
    it('trace() records errors and sets ERROR status', () => {
        expect(() => (0, manual_trace_1.trace)('failing-sync', () => {
            throw new Error('boom');
        })).toThrow('boom');
        const parentSpan = exporter.getFinishedSpans().find((s) => s.name === 'failing-sync');
        expect(parentSpan.status.code).toBe(api_1.SpanStatusCode.ERROR);
        expect(parentSpan.events.some((e) => e.name === 'exception')).toBe(true);
    });
    it('trace() records async rejection', async () => {
        await expect((0, manual_trace_1.trace)('failing-async', async () => {
            await Promise.resolve();
            throw new Error('async-boom');
        })).rejects.toThrow('async-boom');
        const parentSpan = exporter.getFinishedSpans().find((s) => s.name === 'failing-async');
        expect(parentSpan.status.code).toBe(api_1.SpanStatusCode.ERROR);
    });
});
//# sourceMappingURL=manual-trace.test.js.map