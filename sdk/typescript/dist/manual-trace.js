"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TracedSpan = void 0;
exports.startTrace = startTrace;
exports.trace = trace;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const config_1 = __importDefault(require("./config"));
const semantic_convention_1 = __importDefault(require("./semantic-convention"));
function getTracer() {
    const provider = config_1.default.tracer;
    return provider?.getTracer?.('openlit') ?? api_1.trace.getTracer('openlit');
}
function attachAppAttrs(span) {
    span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName ?? 'default');
    span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment ?? 'default');
}
/**
 * Wrapper for an OpenTelemetry span with helpers to set result and metadata.
 * Mirrors Python's TracedSpan — the span lifecycle is managed by startTrace() /
 * trace(), so you do not call end() yourself (like Python's `with` block).
 */
class TracedSpan {
    constructor(span) {
        this._span = span;
    }
    /** Record the AI output or function return value on the span. */
    setResult(result) {
        this._span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, result);
    }
    /** Stamp arbitrary key/value attributes onto the span. */
    setMetadata(metadata) {
        this._span.setAttributes(metadata);
    }
}
exports.TracedSpan = TracedSpan;
function runInActiveSpan(name, fn) {
    return getTracer().startActiveSpan(name, { kind: api_1.SpanKind.CLIENT }, (rawSpan) => {
        attachAppAttrs(rawSpan);
        const handle = new TracedSpan(rawSpan);
        const endOk = () => {
            rawSpan.setStatus({ code: api_1.SpanStatusCode.OK });
            rawSpan.end();
        };
        const endError = (err) => {
            rawSpan.recordException(err);
            rawSpan.setStatus({
                code: api_1.SpanStatusCode.ERROR,
                message: String(err),
            });
            rawSpan.end();
            throw err;
        };
        try {
            const result = fn(handle);
            if (result !== null && typeof result?.then === 'function') {
                return result.then((val) => {
                    endOk();
                    return val;
                }, (err) => endError(err));
            }
            endOk();
            return result;
        }
        catch (err) {
            return endError(err);
        }
    });
}
/**
 * Start a named CLIENT span scoped to a callback — the TypeScript equivalent of
 * Python's `with start_trace(name) as span:`.
 *
 * The span is active for the duration of `fn`, so child LLM spans nest correctly.
 *
 * @example
 *   const answer = await openlit.startTrace('my-operation', async (span) => {
 *     const result = await doWork();
 *     span.setResult(String(result));
 *     return result;
 *   });
 */
function startTrace(name, fn) {
    return runInActiveSpan(name, fn);
}
/**
 * Wrap a function call in a CLIENT span — the TypeScript equivalent of
 * Python's `@openlit.trace` decorator.
 *
 * @example
 *   const answer = await openlit.trace('my-chain', async (span) => {
 *     const result = await chain.invoke({ question });
 *     span.setResult(result.content);
 *     return result;
 *   });
 */
function trace(name, fn) {
    return runInActiveSpan(name, fn);
}
//# sourceMappingURL=manual-trace.js.map