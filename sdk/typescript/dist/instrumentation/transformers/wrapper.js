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
const TASK_OPERATION = {
    // Generative chat-style (Python parity)
    'text-generation': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT, isEmbedding: false },
    // Sequence-to-sequence / extractive text producers
    'text2text-generation': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    summarization: { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    translation: { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    'fill-mask': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    'question-answering': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    'text-classification': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    'token-classification': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    'zero-shot-classification': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION, isEmbedding: false },
    // Embedding producers
    'feature-extraction': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING, isEmbedding: true },
    'sentence-similarity': { operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_EMBEDDING, isEmbedding: true },
};
/** Map a Pipeline subclass name to its canonical Transformers.js task string. */
const CLASS_TASK = {
    TextGenerationPipeline: 'text-generation',
    Text2TextGenerationPipeline: 'text2text-generation',
    SummarizationPipeline: 'summarization',
    TranslationPipeline: 'translation',
    FillMaskPipeline: 'fill-mask',
    QuestionAnsweringPipeline: 'question-answering',
    TextClassificationPipeline: 'text-classification',
    TokenClassificationPipeline: 'token-classification',
    ZeroShotClassificationPipeline: 'zero-shot-classification',
    FeatureExtractionPipeline: 'feature-extraction',
};
function resolveTask(instance, className) {
    return ((typeof instance?.task === 'string' && instance.task) ||
        CLASS_TASK[className] ||
        'text-generation');
}
function classifyTask(task) {
    return (TASK_OPERATION[task] || {
        operation: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
        isEmbedding: false,
    });
}
/**
 * Resolve the model identifier from a pipeline instance, mirroring Python's
 * `instance.model.config.name_or_path`. HF configs expose the path under a few
 * keys across versions, so we probe the common ones before falling back.
 */
function resolveModel(instance) {
    const config = instance?.model?.config ?? {};
    return (config._name_or_path ||
        config.name_or_path ||
        config.model_type ||
        instance?.model?.name_or_path ||
        (typeof instance?.task === 'string' ? instance.task : '') ||
        'unknown');
}
/**
 * Extract the generation parameters for a call, mirroring Python which reads
 * `instance._forward_params` (set at pipeline construction) merged with the
 * call-time options object.
 */
function resolveGenerationParams(instance, options) {
    const forward = instance?._forward_params ?? {};
    const opts = options ?? {};
    const pick = (key, altKey) => opts[key] ?? (altKey ? opts[altKey] : undefined) ?? forward[key] ?? (altKey ? forward[altKey] : undefined) ?? null;
    return {
        temperature: pick('temperature'),
        topK: pick('top_k'),
        topP: pick('top_p'),
        maxTokens: pick('max_new_tokens', 'max_length'),
    };
}
/**
 * Convert a Transformers.js pipeline result into a flat text string per task,
 * mirroring the task branches in Python's `process_chat_response`.
 */
function extractCompletion(task, response) {
    const first = Array.isArray(response) ? response[0] : response;
    const fromEntry = (entry) => {
        if (entry === null || entry === undefined)
            return '';
        if (typeof entry !== 'object')
            return String(entry);
        // text-generation may nest a chat-message list under generated_text
        if (Array.isArray(entry.generated_text)) {
            const last = entry.generated_text[entry.generated_text.length - 1];
            return last?.content ?? String(last ?? '');
        }
        return (entry.generated_text ??
            entry.summary_text ??
            entry.translation_text ??
            entry.answer ??
            entry.sequence ??
            entry.token_str ??
            entry.label ??
            entry.text ??
            '');
    };
    switch (task) {
        case 'automatic-speech-recognition':
            return typeof response === 'object' && response !== null ? response.text ?? '' : '';
        case 'feature-extraction':
        case 'sentence-similarity':
            return '';
        default: {
            const out = fromEntry(first);
            if (out)
                return out;
            // Fall back to a stable serialization for unknown shapes.
            try {
                return typeof response === 'string' ? response : JSON.stringify(response);
            }
            catch {
                return String(response ?? '');
            }
        }
    }
}
function stringifyInputs(inputs) {
    if (typeof inputs === 'string')
        return inputs;
    if (Array.isArray(inputs)) {
        return inputs
            .map((i) => (typeof i === 'string' ? i : i?.content ?? JSON.stringify(i)))
            .join('\n');
    }
    if (inputs && typeof inputs === 'object') {
        // question-answering style { question, context }
        if (typeof inputs.question === 'string') {
            return inputs.context
                ? `question: ${inputs.question} context: ${inputs.context}`
                : inputs.question;
        }
        try {
            return JSON.stringify(inputs);
        }
        catch {
            return String(inputs);
        }
    }
    return String(inputs ?? '');
}
class TransformersWrapper extends base_wrapper_1.default {
    /**
     * Stamp `openlit.agent.version_hash` (auto) and `gen_ai.agent.version`
     * (user override) on the span and return them so the caller can merge them
     * into the inference-event extras.
     */
    static _stampAgentVersion(span, args) {
        const out = {};
        try {
            const versionHash = helpers_1.default.computeAgentVersionHash({
                systemInstructions: args.systemInstructionsJson ?? null,
                toolDefinitions: null,
                primaryModel: args.primaryModel ?? null,
                runtimeConfig: {
                    temperature: args.temperature ?? null,
                    top_p: args.top_p ?? null,
                    max_tokens: args.max_tokens ?? null,
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_HUGGING_FACE,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_HUGGING_FACE],
            });
            if (versionHash) {
                out[semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH] = versionHash;
                span.setAttribute(semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH, versionHash);
            }
        }
        catch {
            /* Hash computation must never fail the wrapped call. */
        }
        const versionLabel = (0, helpers_1.getCurrentAgentVersion)();
        if (versionLabel) {
            out[semantic_convention_1.default.GEN_AI_AGENT_VERSION] = versionLabel;
            span.setAttribute(semantic_convention_1.default.GEN_AI_AGENT_VERSION, versionLabel);
        }
        return out;
    }
    /**
     * Patch a Pipeline subclass `_call` (the method invoked when the pipeline
     * object is used as a function). `this` is the pipeline instance.
     * args[0] = inputs, args[1] = generation options.
     */
    static _patchPipelineCall(tracer, className, sdkVersion) {
        return (originalMethod) => {
            return async function (...args) {
                if ((0, helpers_1.isFrameworkLlmActive)())
                    return originalMethod.apply(this, args);
                const task = resolveTask(this, className);
                const requestModel = resolveModel(this);
                const { operation } = classifyTask(task);
                const genAIEndpoint = `transformers.${task}`;
                const spanName = `${operation} ${requestModel}`;
                const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT, attributes: spanCreationAttrs(operation, requestModel) }, effectiveCtx);
                return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                    let metricParams;
                    const startTime = Date.now();
                    try {
                        const response = await originalMethod.apply(this, args);
                        metricParams = TransformersWrapper._handleResponse({
                            instance: this,
                            args,
                            response,
                            span,
                            requestModel,
                            task,
                            operation,
                            genAIEndpoint,
                            ttft: (Date.now() - startTime) / 1000,
                            sdkVersion,
                        });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        base_wrapper_1.default.recordMetrics(span, {
                            genAIEndpoint,
                            model: requestModel,
                            aiSystem: TransformersWrapper.aiSystem,
                            serverAddress: TransformersWrapper.serverAddress,
                            serverPort: TransformersWrapper.serverPort,
                            errorType: e?.constructor?.name || '_OTHER',
                        });
                        throw e;
                    }
                    finally {
                        span.end();
                        if (metricParams) {
                            base_wrapper_1.default.recordMetrics(span, metricParams);
                        }
                    }
                });
            };
        };
    }
    /**
     * Patch the `pipeline()` factory as a fallback when no Pipeline subclass
     * prototype is exported. Wraps the returned callable so each invocation
     * emits a span. The original callable is invoked directly (not via the
     * wrapper) so we never lose its prototype behavior.
     */
    static _patchPipelineFactory(tracer, sdkVersion) {
        return (originalFactory) => {
            return async function (...factoryArgs) {
                const pipe = await originalFactory.apply(this, factoryArgs);
                if (typeof pipe !== 'function')
                    return pipe;
                const task = (typeof factoryArgs[0] === 'string' && factoryArgs[0]) ||
                    (typeof pipe.task === 'string' && pipe.task) ||
                    'text-generation';
                const { operation } = classifyTask(task);
                const genAIEndpoint = `transformers.${task}`;
                const wrappedPipe = async function (...callArgs) {
                    if ((0, helpers_1.isFrameworkLlmActive)())
                        return pipe.apply(this, callArgs);
                    const requestModel = resolveModel(pipe) ||
                        (typeof factoryArgs[1] === 'string' ? factoryArgs[1] : 'unknown');
                    const spanName = `${operation} ${requestModel}`;
                    const effectiveCtx = (0, helpers_1.getFrameworkParentContext)() ?? api_1.context.active();
                    const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT, attributes: spanCreationAttrs(operation, requestModel) }, effectiveCtx);
                    return api_1.context.with(api_1.trace.setSpan(effectiveCtx, span), async () => {
                        let metricParams;
                        const startTime = Date.now();
                        try {
                            const response = await pipe.apply(this, callArgs);
                            metricParams = TransformersWrapper._handleResponse({
                                instance: pipe,
                                args: callArgs,
                                response,
                                span,
                                requestModel,
                                task,
                                operation,
                                genAIEndpoint,
                                ttft: (Date.now() - startTime) / 1000,
                                sdkVersion,
                            });
                            return response;
                        }
                        catch (e) {
                            helpers_1.default.handleException(span, e);
                            base_wrapper_1.default.recordMetrics(span, {
                                genAIEndpoint,
                                model: requestModel,
                                aiSystem: TransformersWrapper.aiSystem,
                                serverAddress: TransformersWrapper.serverAddress,
                                serverPort: TransformersWrapper.serverPort,
                                errorType: e?.constructor?.name || '_OTHER',
                            });
                            throw e;
                        }
                        finally {
                            span.end();
                            if (metricParams) {
                                base_wrapper_1.default.recordMetrics(span, metricParams);
                            }
                        }
                    });
                };
                // Preserve callable identity so the wrapped pipe behaves like the original.
                Object.setPrototypeOf(wrappedPipe, Object.getPrototypeOf(pipe));
                Object.assign(wrappedPipe, pipe);
                return wrappedPipe;
            };
        };
    }
    /**
     * Synchronous attribute setter shared by the class- and factory-patch paths.
     * Returns the metric params so the caller can record metrics in `finally`.
     */
    static _handleResponse({ instance, args, response, span, requestModel, task, operation, genAIEndpoint, ttft, sdkVersion, }) {
        const captureContent = config_1.default.captureMessageContent;
        const { isEmbedding } = classifyTask(task);
        const inputs = args[0];
        const options = args[1] || {};
        const { temperature, topK, topP, maxTokens } = resolveGenerationParams(instance, options);
        const inputStr = stringifyInputs(inputs);
        const completion = extractCompletion(task, response);
        const inputTokens = helpers_1.default.generalTokens(inputStr) ?? 0;
        const outputTokens = isEmbedding ? 0 : helpers_1.default.generalTokens(completion) ?? 0;
        const pricingInfo = config_1.default.pricingInfo || {};
        const cost = helpers_1.default.getChatModelCost(requestModel, pricingInfo, inputTokens, outputTokens);
        // Common attributes (telemetry sdk, env, app, request model, cost, server).
        TransformersWrapper.setBaseSpanAttributes(span, {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: TransformersWrapper.aiSystem,
            serverAddress: TransformersWrapper.serverAddress,
            serverPort: TransformersWrapper.serverPort,
        });
        // Parity: Python stamps gen_ai.system and the transformers package version
        // (setBaseSpanAttributes uses OpenLIT's SDK version).
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME, TransformersWrapper.aiSystem);
        if (sdkVersion) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, sdkVersion);
        }
        // Request parameters (only when present, matching Python).
        if (temperature !== null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, temperature);
        }
        if (topK !== null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_K, topK);
        }
        if (topP !== null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, topP);
        }
        if (maxTokens !== null) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
        }
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, false);
        // Response parameters.
        span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_MODEL, requestModel);
        if (!isEmbedding) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
            span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        }
        // Tokens, cost, cache (cache stamped as 0 even when unused, like Python).
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE, inputTokens + outputTokens);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0);
        span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0);
        // Timing (Python always sets these; tbt is 0 for non-streaming pipelines).
        span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TTFT, ttft);
        span.setAttribute(semantic_convention_1.default.GEN_AI_SERVER_TBT, 0);
        const versionExtras = TransformersWrapper._stampAgentVersion(span, {
            systemInstructionsJson: null,
            primaryModel: requestModel,
            temperature,
            top_p: topP,
            max_tokens: maxTokens,
        });
        let inputMessagesJson;
        let outputMessagesJson;
        if (captureContent) {
            inputMessagesJson = helpers_1.default.buildInputMessages([{ role: 'user', content: inputStr }]);
            span.setAttribute(semantic_convention_1.default.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
            if (!isEmbedding) {
                outputMessagesJson = helpers_1.default.buildOutputMessages(completion, 'stop');
                span.setAttribute(semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
            }
        }
        if (!config_1.default.disableEvents) {
            const eventAttrs = {
                [semantic_convention_1.default.GEN_AI_OPERATION]: operation,
                [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
                [semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]: requestModel,
                [semantic_convention_1.default.SERVER_ADDRESS]: TransformersWrapper.serverAddress,
                [semantic_convention_1.default.SERVER_PORT]: TransformersWrapper.serverPort,
                [semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
                [semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
                ...versionExtras,
            };
            if (!isEmbedding) {
                eventAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = ['stop'];
                eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_TYPE] = semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
            }
            if (captureContent) {
                if (inputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
                if (outputMessagesJson)
                    eventAttrs[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
            }
            helpers_1.default.emitInferenceEvent(span, eventAttrs);
        }
        return {
            genAIEndpoint,
            model: requestModel,
            cost,
            aiSystem: TransformersWrapper.aiSystem,
            serverAddress: TransformersWrapper.serverAddress,
            serverPort: TransformersWrapper.serverPort,
        };
    }
}
TransformersWrapper.aiSystem = semantic_convention_1.default.GEN_AI_SYSTEM_HUGGING_FACE;
TransformersWrapper.serverAddress = '127.0.0.1';
TransformersWrapper.serverPort = 80;
function spanCreationAttrs(operationName, requestModel) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_HUGGING_FACE,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: TransformersWrapper.serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: TransformersWrapper.serverPort,
    };
}
exports.default = TransformersWrapper;
//# sourceMappingURL=wrapper.js.map