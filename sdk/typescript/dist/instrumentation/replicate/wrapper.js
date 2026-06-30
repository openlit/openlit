"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
function spanCreationAttrs(operationName, requestModel) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: ReplicateWrapper.aiSystem,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: ReplicateWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: ReplicateWrapper.serverPort,
    };
}
class ReplicateWrapper extends base_wrapper_1.default {
    /**
     * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
     * (user override, if set) on the span and return the same attributes so
     * the caller can merge them into the inference event extras.
     */
    static _stampAgentVersion(span, args) {
        const out = {};
        try {
            const versionHash = helpers_1.default.computeAgentVersionHash({
                systemInstructions: args.systemInstructionsJson ?? null,
                toolDefinitions: args.toolDefinitionsJson ?? null,
                primaryModel: args.primaryModel ?? null,
                runtimeConfig: {
                    temperature: args.temperature ?? null,
                    top_p: args.top_p ?? null,
                    max_tokens: args.max_tokens ?? null,
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_REPLICATE,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_REPLICATE],
            });
            if (versionHash) {
                out[semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH] = versionHash;
                span.setAttribute(semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH, versionHash);
            }
        }
        catch {
            // Hash computation must never fail the wrapped call.
        }
        const versionLabel = (0, helpers_1.getCurrentAgentVersion)();
        if (versionLabel) {
            out[semantic_convention_1.default.GEN_AI_AGENT_VERSION] = versionLabel;
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_VERSION, versionLabel);
        }
        return out;
    }
    static _patchRun(tracer) {
        const genAIEndpoint = 'replicate.run';
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const identifier = typeof args[0] === 'string' ? args[0] : '';
                const requestModel = identifier.split(':')[0] || identifier;
                const spanName = `${semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, {
                    kind: api_1.SpanKind.CLIENT,
                    attributes: spanCreationAttrs(semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, requestModel),
                }, effectiveCtx);
                return api_1.context
                    .with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    return originalMethod.apply(this, args);
                })
                    .then((response) => ReplicateWrapper._run({ args, genAIEndpoint, response, span }))
                    .catch((e) => {
                    helpers_1.default.handleException(span, e);
                    base_wrapper_1.default.recordMetrics(span, {
                        genAIEndpoint,
                        model: requestModel,
                        aiSystem: ReplicateWrapper.aiSystem,
                        serverAddress: ReplicateWrapper.serverAddress,
                        serverPort: ReplicateWrapper.serverPort,
                        errorType: e?.constructor?.name || '_OTHER',
                    });
                    span.end();
                    throw e;
                });
            };
        };
    }
    static async _run({ args, genAIEndpoint, response, span, }) {
        let metricParams;
        try {
            const captureContent = config_1.default.captureMessageContent;
            const identifier = typeof args[0] === 'string' ? args[0] : '';
            const options = args[1] || {};
            const input = options.input || {};
            const prompt = input.prompt || '';
            const requestModel = identifier.split(':')[0] || identifier;
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
            let outputText = '';
            let outputType = semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
            if (typeof response === 'string') {
                outputText = response;
            }
            else if (Array.isArray(response)) {
                outputText = response.join('');
            }
            else if (response && typeof response === 'object') {
                outputType = semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_JSON;
                outputText = JSON.stringify(response);
            }
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, outputType);
            const promptTokens = helpers_1.default.generalTokens(prompt) ?? 0;
            const completionTokens = helpers_1.default.generalTokens(outputText) ?? 0;
            const pricingInfo = config_1.default.pricingInfo || {};
            const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, promptTokens, completionTokens);
            ReplicateWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint,
                model: requestModel,
                cost,
                aiSystem: ReplicateWrapper.aiSystem,
                serverAddress: ReplicateWrapper.serverAddress,
                serverPort: ReplicateWrapper.serverPort,
            });
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, requestModel);
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            let inputMessagesJson;
            let outputMessagesJson;
            // Replicate language models commonly accept a `system_prompt` input.
            const systemPrompt = typeof input.system_prompt === 'string' ? input.system_prompt :
                typeof input.system === 'string' ? input.system : '';
            // Compute system_instructions JSON regardless of captureContent so the
            // version hash stays consistent across runs even when content capture
            // is disabled.
            const systemInstructionsJson = systemPrompt
                ? JSON.stringify([{ type: 'text', content: systemPrompt }])
                : undefined;
            if (captureContent) {
                const messages = prompt ? [{ role: 'user', content: prompt }] : [];
                inputMessagesJson = helpers_1.default.buildInputMessages(messages);
                span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
                outputMessagesJson = helpers_1.default.buildOutputMessages(outputText, 'stop');
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
                if (systemInstructionsJson) {
                    span.setAttribute(semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemInstructionsJson);
                }
            }
            const versionExtras = ReplicateWrapper._stampAgentVersion(span, {
                systemInstructionsJson,
                primaryModel: requestModel,
                temperature: typeof input.temperature === 'number' ? input.temperature : null,
                top_p: typeof input.top_p === 'number' ? input.top_p : null,
                max_tokens: typeof input.max_tokens === 'number'
                    ? input.max_tokens
                    : typeof input.max_new_tokens === 'number'
                        ? input.max_new_tokens
                        : null,
            });
            if (!config_1.default.disableEvents) {
                const eventAttrs = {
                    [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                    [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                    [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: requestModel,
                    [semantic_convention_1.default.SERVER_ADDRESS]: ReplicateWrapper.serverAddress,
                    [semantic_convention_1.default.SERVER_PORT]: ReplicateWrapper.serverPort,
                    [semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
                    [semantic_convention_1.default.GEN_AI_OUTPUT_TYPE]: outputType,
                    [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: promptTokens,
                    [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: completionTokens,
                    ...versionExtras,
                };
                if (captureContent) {
                    if (inputMessagesJson)
                        eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                    if (outputMessagesJson)
                        eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
                    if (systemInstructionsJson)
                        eventAttrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = systemInstructionsJson;
                }
                helpers_1.default.emitInferenceEvent(span, eventAttrs);
            }
            metricParams = {
                genAIEndpoint,
                model: requestModel,
                cost,
                aiSystem: ReplicateWrapper.aiSystem,
            };
            return response;
        }
        catch (e) {
            helpers_1.default.handleException(span, e);
            throw e;
        }
        finally {
            span.end();
            if (metricParams) {
                base_wrapper_1.default.recordMetrics(span, metricParams);
            }
        }
    }
}
ReplicateWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_REPLICATE;
ReplicateWrapper.serverAddress = 'api.replicate.com';
ReplicateWrapper.serverPort = 443;
exports.default = ReplicateWrapper;
//# sourceMappingURL=wrapper.js.map