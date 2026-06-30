"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineResult = exports.GuardConfigError = exports.GuardTimeoutError = exports.GuardDeniedError = exports.GuardError = exports.GuardPhase = exports.GuardAction = exports.Guard = exports.Pipeline = exports.Custom = exports.Schema = exports.TopicRestriction = exports.SensitiveTopic = exports.Moderation = exports.PromptInjection = exports.PII = exports.trace = exports.startTrace = exports.TracedSpan = exports.logScore = exports.injectAdditionalAttributes = exports.usingAttributes = exports.Openlit = void 0;
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const api_1 = require("@opentelemetry/api");
const tracing_1 = __importDefault(require("./otel/tracing"));
const events_1 = __importDefault(require("./otel/events"));
const constant_1 = require("./constant");
const base_1 = __importDefault(require("./features/base"));
const config_1 = __importDefault(require("./config"));
const helpers_1 = __importDefault(require("./helpers"));
const helpers_2 = require("./helpers");
Object.defineProperty(exports, "usingAttributes", { enumerable: true, get: function () { return helpers_2.usingAttributes; } });
Object.defineProperty(exports, "injectAdditionalAttributes", { enumerable: true, get: function () { return helpers_2.injectAdditionalAttributes; } });
const evals_1 = require("./evals");
const score_1 = require("./score");
Object.defineProperty(exports, "logScore", { enumerable: true, get: function () { return score_1.logScore; } });
const manual_trace_1 = require("./manual-trace");
Object.defineProperty(exports, "TracedSpan", { enumerable: true, get: function () { return manual_trace_1.TracedSpan; } });
Object.defineProperty(exports, "startTrace", { enumerable: true, get: function () { return manual_trace_1.startTrace; } });
Object.defineProperty(exports, "trace", { enumerable: true, get: function () { return manual_trace_1.trace; } });
const metrics_1 = __importDefault(require("./otel/metrics"));
const semantic_convention_1 = __importDefault(require("./semantic-convention"));
const utils_1 = require("./otel/utils");
const integration_1 = require("./guard/integration");
const pii_1 = require("./guard/pii");
Object.defineProperty(exports, "PII", { enumerable: true, get: function () { return pii_1.PII; } });
const prompt_injection_1 = require("./guard/prompt-injection");
Object.defineProperty(exports, "PromptInjection", { enumerable: true, get: function () { return prompt_injection_1.PromptInjection; } });
const moderation_1 = require("./guard/moderation");
Object.defineProperty(exports, "Moderation", { enumerable: true, get: function () { return moderation_1.Moderation; } });
const sensitive_topic_1 = require("./guard/sensitive-topic");
Object.defineProperty(exports, "SensitiveTopic", { enumerable: true, get: function () { return sensitive_topic_1.SensitiveTopic; } });
const topic_restriction_1 = require("./guard/topic-restriction");
Object.defineProperty(exports, "TopicRestriction", { enumerable: true, get: function () { return topic_restriction_1.TopicRestriction; } });
const schema_1 = require("./guard/schema");
Object.defineProperty(exports, "Schema", { enumerable: true, get: function () { return schema_1.Schema; } });
const custom_1 = require("./guard/custom");
Object.defineProperty(exports, "Custom", { enumerable: true, get: function () { return custom_1.Custom; } });
const pipeline_1 = require("./guard/pipeline");
Object.defineProperty(exports, "Pipeline", { enumerable: true, get: function () { return pipeline_1.Pipeline; } });
const base_2 = require("./guard/base");
Object.defineProperty(exports, "Guard", { enumerable: true, get: function () { return base_2.Guard; } });
Object.defineProperty(exports, "GuardAction", { enumerable: true, get: function () { return base_2.GuardAction; } });
Object.defineProperty(exports, "GuardPhase", { enumerable: true, get: function () { return base_2.GuardPhase; } });
Object.defineProperty(exports, "GuardError", { enumerable: true, get: function () { return base_2.GuardError; } });
Object.defineProperty(exports, "GuardDeniedError", { enumerable: true, get: function () { return base_2.GuardDeniedError; } });
Object.defineProperty(exports, "GuardTimeoutError", { enumerable: true, get: function () { return base_2.GuardTimeoutError; } });
Object.defineProperty(exports, "GuardConfigError", { enumerable: true, get: function () { return base_2.GuardConfigError; } });
Object.defineProperty(exports, "PipelineResult", { enumerable: true, get: function () { return base_2.PipelineResult; } });
/**
 * Resolve OpenlitOptions into a single ResolvedOptions object.
 * Precedence: arg > env var > default.
 */
function resolveOptions(options) {
    const o = options || {};
    const environment = o.environment ?? constant_1.DEFAULT_ENVIRONMENT;
    const applicationName = o.applicationName ?? constant_1.DEFAULT_APPLICATION_NAME;
    const rawEndpoint = o.otlpEndpoint ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        undefined;
    const otlpEndpoint = rawEndpoint
        ? rawEndpoint.replace(/\/v1\/traces$/, '')
        : undefined;
    let otlpHeaders = o.otlpHeaders ?? undefined;
    if (!otlpHeaders && process.env.OTEL_EXPORTER_OTLP_HEADERS) {
        otlpHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').reduce((acc, item) => {
            const keyVal = item.split('=');
            acc[keyVal[0]] = keyVal[1];
            return acc;
        }, {});
    }
    if (!otlpHeaders)
        otlpHeaders = {};
    let disableBatch = o.disableBatch ?? undefined;
    const envDisableBatch = (0, utils_1.parseBoolEnv)('OPENLIT_DISABLE_BATCH');
    if (disableBatch === undefined) {
        disableBatch = envDisableBatch ?? false;
    }
    let captureMessageContent = o.captureMessageContent ?? undefined;
    const envCapture = (0, utils_1.parseBoolEnv)('OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT');
    if (captureMessageContent === undefined) {
        captureMessageContent = envCapture ?? true;
    }
    let disableMetrics = o.disableMetrics ?? undefined;
    const envDisableMetrics = (0, utils_1.parseBoolEnv)('OPENLIT_DISABLE_METRICS');
    if (disableMetrics === undefined) {
        disableMetrics = envDisableMetrics ?? false;
    }
    let disableEvents = o.disableEvents ?? undefined;
    const envDisableEvents = (0, utils_1.parseBoolEnv)('OPENLIT_DISABLE_EVENTS');
    if (disableEvents === undefined) {
        disableEvents = envDisableEvents ?? false;
    }
    const openlitApiKey = o.openlitApiKey ?? process.env.OPENLIT_API_KEY ?? undefined;
    const openlitUrl = o.openlitUrl ?? process.env.OPENLIT_URL ?? undefined;
    return {
        environment,
        applicationName,
        tracer: o.tracer,
        otlpEndpoint,
        otlpHeaders,
        disableBatch,
        captureMessageContent,
        disabledInstrumentors: o.disabledInstrumentors,
        instrumentations: o.instrumentations,
        disableMetrics,
        disableEvents,
        pricingJson: o.pricingJson,
        maxContentLength: o.maxContentLength ?? null,
        customSpanAttributes: o.customSpanAttributes ?? null,
        openlitApiKey,
        openlitUrl,
        guards: o.guards,
        guardFailOpen: o.guardFailOpen ?? true,
    };
}
class Openlit extends base_1.default {
    static init(options) {
        try {
            api_1.diag.setLogger(new api_1.DiagConsoleLogger(), api_1.DiagLogLevel.WARN);
            const resolved = resolveOptions(options);
            this.options = resolved;
            this.resource = (0, resources_1.resourceFromAttributes)({
                [semantic_conventions_1.ATTR_SERVICE_NAME]: resolved.applicationName,
                [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: resolved.environment,
                [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
            });
            const setupBase = {
                ...resolved,
                resource: this.resource,
            };
            tracing_1.default.setup(setupBase);
            if (!resolved.disableEvents) {
                events_1.default.setup(setupBase);
            }
            if (!resolved.disableMetrics) {
                const exportIntervalMillis = Number(process.env.OTEL_EXPORTER_OTLP_METRICS_EXPORT_INTERVAL ?? 60000) || 60000;
                metrics_1.default.setup({
                    ...setupBase,
                    exportIntervalMillis,
                });
            }
            config_1.default.openlitApiKey = resolved.openlitApiKey;
            config_1.default.openlitUrl = resolved.openlitUrl;
            helpers_1.default.fetchPricingInfo(resolved.pricingJson).then((info) => { config_1.default.pricingInfo = info; }, () => { config_1.default.pricingInfo = {}; });
            if (resolved.guards && resolved.guards.length > 0) {
                (0, integration_1.setupAutoGuards)(resolved.guards, resolved.guardFailOpen);
            }
        }
        catch (e) {
            console.error('OpenLIT initialization failed:', e);
        }
    }
}
exports.Openlit = Openlit;
// Top-level guard class exports
Openlit.PII = pii_1.PII;
Openlit.PromptInjection = prompt_injection_1.PromptInjection;
Openlit.Moderation = moderation_1.Moderation;
Openlit.SensitiveTopic = sensitive_topic_1.SensitiveTopic;
Openlit.TopicRestriction = topic_restriction_1.TopicRestriction;
Openlit.Schema = schema_1.Schema;
Openlit.Custom = custom_1.Custom;
Openlit.Pipeline = pipeline_1.Pipeline;
Openlit.GuardAction = base_2.GuardAction;
Openlit.GuardPhase = base_2.GuardPhase;
Openlit.GuardError = base_2.GuardError;
Openlit.GuardDeniedError = base_2.GuardDeniedError;
Openlit.GuardTimeoutError = base_2.GuardTimeoutError;
Openlit.GuardConfigError = base_2.GuardConfigError;
Openlit.eval = evals_1.runEval;
Openlit.evalBatch = evals_1.runEvalBatch;
Openlit.getEvalTypes = evals_1.fetchEvalTypes;
Openlit.logScore = score_1.logScore;
/**
 * Public API: stamp every subsequent chat span / inference event in the
 * current async scope with a user-supplied agent version label
 * (`gen_ai.agent.version`). Useful when you want versions to follow a
 * release tag, git SHA, or business-meaningful name instead of the SDK's
 * auto-computed fingerprint.
 *
 * For a one-shot block, prefer `OpenLit.withAgentVersion(label, fn)`.
 */
Openlit.setAgentVersion = helpers_2.setAgentVersion;
/**
 * Clear the agent version label set by `setAgentVersion`. Always call this
 * in a `finally` block when you use `setAgentVersion` directly, otherwise
 * the label will persist on subsequent requests handled by the same
 * worker. Prefer `withAgentVersion(label, fn)` for scoped usage.
 */
Openlit.resetAgentVersion = helpers_2.resetAgentVersion;
Openlit.withAgentVersion = helpers_2.runWithAgentVersion;
Openlit.getAgentVersion = helpers_2.getCurrentAgentVersion;
Openlit.startTrace = manual_trace_1.startTrace;
Openlit.trace = manual_trace_1.trace;
const openlit = Openlit;
openlit.usingAttributes = helpers_2.usingAttributes;
openlit.injectAdditionalAttributes = helpers_2.injectAdditionalAttributes;
exports.default = openlit;
//# sourceMappingURL=index.js.map