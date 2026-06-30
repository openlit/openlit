"use strict";
/**
 * Strands Agents SpanProcessor.
 *
 * Enriches Strands' native OTel spans with OpenLIT-specific attributes,
 * extracts content from span events into span attributes, emits
 * gen_ai.client.inference.operation.details log events for chat spans,
 * and records OpenLIT metrics.
 *
 * Provider-level chat spans (OpenAI, Anthropic, etc.) are suppressed
 * when they occur inside a Strands chat span via the shared
 * frameworkLlmActive flag.
 *
 * Mirrors: sdk/python/src/openlit/instrumentation/strands/processor.py
 */
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
exports.StrandsSpanProcessor = void 0;
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importStar(require("../../helpers"));
const utils_1 = require("./utils");
const STRANDS_TRACER_SCOPES = new Set([
    'strands.telemetry.tracer',
    'strands-agents',
]);
/**
 * Enriches Strands-generated spans with OpenLIT telemetry.
 * Added to the TracerProvider so it receives all spans; non-Strands
 * spans are ignored via the _isStrandsSpan() check.
 */
class StrandsSpanProcessor {
    constructor(strandsVersion = 'unknown') {
        this._chatSpanIds = new Set();
        this._chatInfo = new Map();
        this._strandsVersion = strandsVersion;
    }
    // -----------------------------------------------------------------
    // Span detection
    // -----------------------------------------------------------------
    static _isStrandsSpan(span) {
        const scope = span.instrumentationLibrary;
        if (scope && STRANDS_TRACER_SCOPES.has(scope.name)) {
            return true;
        }
        const attrs = span.attributes || {};
        const system = attrs['gen_ai.system'] || '';
        const provider = attrs['gen_ai.provider.name'] || '';
        return (system === semantic_convention_1.default.GEN_AI_SYSTEM_STRANDS ||
            system === 'strands-agents' ||
            provider === semantic_convention_1.default.GEN_AI_SYSTEM_STRANDS ||
            provider === 'strands-agents');
    }
    // -----------------------------------------------------------------
    // Attribute mutation helpers (span is read-only after onEnd)
    // -----------------------------------------------------------------
    static _setAttr(span, key, value) {
        try {
            if (span.attributes) {
                span.attributes[key] = value;
            }
        }
        catch {
            // ignore
        }
    }
    static _setAttrs(span, mapping) {
        try {
            if (span.attributes) {
                Object.assign(span.attributes, mapping);
            }
        }
        catch {
            // ignore
        }
    }
    static _setSpanName(span, name) {
        try {
            if ('_name' in span)
                span._name = name;
            if ('name' in span)
                span.name = name;
        }
        catch {
            // ignore
        }
    }
    // -----------------------------------------------------------------
    // SpanProcessor API
    // -----------------------------------------------------------------
    onStart(span, _parentContext) {
        if (!StrandsSpanProcessor._isStrandsSpan(span))
            return;
        try {
            span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, 'openlit');
            span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, this._strandsVersion);
            span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, config_1.default.environment || 'default');
            span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, config_1.default.applicationName || 'default');
            (0, helpers_1.applyCustomSpanAttributes)(span);
        }
        catch {
            // ignore
        }
        const spanName = span.name || '';
        if (spanName === 'chat') {
            try {
                span._kind = api_1.SpanKind.CLIENT;
            }
            catch {
                // ignore
            }
            try {
                (0, helpers_1.setFrameworkLlmActive)();
                const spanId = span.spanContext().spanId;
                this._chatSpanIds.add(spanId);
            }
            catch {
                // ignore
            }
        }
    }
    onEnd(span) {
        if (!StrandsSpanProcessor._isStrandsSpan(span))
            return;
        const spanId = span.spanContext().spanId;
        if (this._chatSpanIds.has(spanId)) {
            this._chatSpanIds.delete(spanId);
            try {
                (0, helpers_1.resetFrameworkLlmActive)();
            }
            catch {
                // ignore
            }
        }
        try {
            this._processSpan(span);
        }
        catch {
            // ignore
        }
    }
    shutdown() {
        return Promise.resolve();
    }
    forceFlush() {
        return Promise.resolve();
    }
    // -----------------------------------------------------------------
    // Core processing (mirrors Python _process_span)
    // -----------------------------------------------------------------
    _processSpan(span) {
        const attrs = span.attributes || {};
        let operation = String(attrs[semantic_convention_1.default.GEN_AI_OPERATION] || '');
        // Normalize agent id: agent_name-span_id_hex
        const agentName = attrs[semantic_convention_1.default.GEN_AI_AGENT_NAME];
        if (agentName && !attrs[semantic_convention_1.default.GEN_AI_AGENT_ID]) {
            const spanIdHex = span.spanContext().spanId;
            StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_AGENT_ID, `${agentName}-${spanIdHex}`);
        }
        // Normalize gen_ai.system → gen_ai.provider.name
        const genAiSystem = String(attrs['gen_ai.system'] || '');
        if (genAiSystem && !attrs[semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]) {
            const provider = genAiSystem === 'strands-agents' || genAiSystem === 'strands_agents'
                ? semantic_convention_1.default.GEN_AI_SYSTEM_STRANDS
                : genAiSystem;
            StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, provider);
        }
        // Normalize Strands-native cache token keys → OTel standard keys
        const cacheKeyMap = [
            ['gen_ai.usage.cache_read_input_tokens', semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
            ['gen_ai.usage.cache_write_input_tokens', semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS],
        ];
        for (const [strandsKey, otelKey] of cacheKeyMap) {
            const val = attrs[strandsKey];
            if (val != null && !attrs[otelKey]) {
                StrandsSpanProcessor._setAttr(span, otelKey, val);
            }
        }
        // Remap Strands-native system_prompt → gen_ai.system_instructions
        if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT) {
            const systemPrompt = attrs['system_prompt'];
            if (systemPrompt && !attrs[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS]) {
                StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS, systemPrompt);
            }
        }
        // Duration (HrTime → seconds)
        let duration = 0;
        if (span.endTime && span.startTime) {
            const endNs = span.endTime[0] * 1e9 + span.endTime[1];
            const startNs = span.startTime[0] * 1e9 + span.startTime[1];
            duration = (endNs - startNs) / 1e9;
        }
        StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_CLIENT_OPERATION_DURATION, duration);
        // Server address / port (inferred from model name)
        const modelName = String(attrs[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] || '');
        let serverAddress = String(attrs[semantic_convention_1.default.SERVER_ADDRESS] || '');
        let serverPort = Number(attrs[semantic_convention_1.default.SERVER_PORT] || 0);
        if (!serverAddress && modelName) {
            [serverAddress, serverPort] = (0, utils_1.inferServerAddress)(modelName);
            if (serverAddress) {
                StrandsSpanProcessor._setAttrs(span, {
                    [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
                    [semantic_convention_1.default.SERVER_PORT]: serverPort,
                });
            }
        }
        // Normalize multi-agent operation names to invoke_workflow
        if (operation === 'invoke_swarm' || operation === 'invoke_graph') {
            const workflowName = String(attrs[semantic_convention_1.default.GEN_AI_AGENT_NAME] || '');
            StrandsSpanProcessor._setAttrs(span, {
                [semantic_convention_1.default.GEN_AI_OPERATION]: semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK,
                [semantic_convention_1.default.GEN_AI_WORKFLOW_NAME]: workflowName,
            });
            operation = semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK;
        }
        // Output type for agent / workflow spans
        if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT ||
            operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK) {
            StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE, semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT);
        }
        // Tool type and tool call id
        if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS) {
            StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_TOOL_TYPE, 'function');
            if (!attrs[semantic_convention_1.default.GEN_AI_TOOL_CALL_ID]) {
                const tid = attrs['tool_use_id'] ||
                    attrs['toolUseId'] ||
                    attrs['gen_ai.tool.call.id'] ||
                    StrandsSpanProcessor._extractToolCallIdFromSpanEvents(span);
                if (tid) {
                    StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.GEN_AI_TOOL_CALL_ID, String(tid));
                }
            }
        }
        // OTel-compliant span names
        this._setOtelCompliantSpanName(span, operation);
        // Chat span enrichment: match provider span attributes
        if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT) {
            this._enrichChatSpan(span, attrs, modelName);
            this._storeChatInfoForParent(span, modelName);
        }
        // Propagate recommended attrs from child chat spans to invoke_agent
        if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT) {
            this._enrichAgentFromChildren(span);
        }
        // Content capture: extract from events → span attributes
        if (config_1.default.captureMessageContent) {
            this._extractAndSetContent(span, operation);
        }
        // Emit inference log event for chat spans
        if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_CHAT) {
            this._emitChatInferenceEvent(span, attrs, serverAddress, serverPort);
        }
        // Record OpenLIT metrics
        if (!config_1.default.disableMetrics && operation) {
            (0, utils_1.recordStrandsMetrics)(operation, duration, modelName, serverAddress, serverPort);
        }
        // Set error type if missing (low-cardinality per OTel spec)
        if (span.status && span.status.code === api_1.SpanStatusCode.ERROR) {
            const currentAttrs = span.attributes || {};
            if (!currentAttrs[semantic_convention_1.default.ERROR_TYPE]) {
                StrandsSpanProcessor._setAttr(span, semantic_convention_1.default.ERROR_TYPE, '_OTHER');
            }
        }
    }
    // -----------------------------------------------------------------
    // OTel-compliant span naming
    // -----------------------------------------------------------------
    _setOtelCompliantSpanName(span, operation) {
        if (operation !== semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT &&
            operation !== semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS &&
            operation !== semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK) {
            return;
        }
        try {
            const attrs = span.attributes || {};
            if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_AGENT) {
                const name = attrs[semantic_convention_1.default.GEN_AI_AGENT_NAME];
                if (name)
                    StrandsSpanProcessor._setSpanName(span, `invoke_agent ${name}`);
            }
            else if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS) {
                const name = attrs[semantic_convention_1.default.GEN_AI_TOOL_NAME];
                if (name)
                    StrandsSpanProcessor._setSpanName(span, `execute_tool ${name}`);
            }
            else if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_FRAMEWORK) {
                const name = attrs[semantic_convention_1.default.GEN_AI_WORKFLOW_NAME];
                if (name)
                    StrandsSpanProcessor._setSpanName(span, `invoke_workflow ${name}`);
            }
        }
        catch {
            // ignore
        }
    }
    // -----------------------------------------------------------------
    // Chat span enrichment (parity with provider spans)
    // -----------------------------------------------------------------
    _enrichChatSpan(span, attrs, modelName) {
        const enrichments = {};
        // Span name: "chat" → "chat {model}"
        if (modelName) {
            StrandsSpanProcessor._setSpanName(span, `chat ${modelName}`);
        }
        // Override gen_ai.provider.name with actual provider for chat spans
        const provider = modelName ? (0, utils_1.inferProviderName)(modelName) : '';
        if (provider) {
            enrichments[semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL] = provider;
        }
        // response.model: fall back to request model
        if (!attrs[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] && modelName) {
            enrichments[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] = modelName;
        }
        // response.id: extract from events
        if (!attrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID]) {
            const responseId = StrandsSpanProcessor._extractResponseId(span);
            if (responseId) {
                enrichments[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = responseId;
            }
        }
        // Finish reasons from output events
        const [, outputMsgs] = (0, utils_1.extractContentFromEvents)(span, 'chat');
        if (outputMsgs && outputMsgs.length > 0) {
            const finishReasons = outputMsgs
                .filter((m) => typeof m === 'object' && m.finish_reason)
                .map((m) => m.finish_reason);
            if (finishReasons.length > 0) {
                enrichments[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = finishReasons;
            }
        }
        enrichments[semantic_convention_1.default.GEN_AI_OUTPUT_TYPE] = semantic_convention_1.default.GEN_AI_OUTPUT_TYPE_TEXT;
        // Token totals and cost
        const inputTokens = Number(attrs['gen_ai.usage.input_tokens'] || 0);
        const outputTokens = Number(attrs['gen_ai.usage.output_tokens'] || 0);
        if (inputTokens || outputTokens) {
            enrichments[semantic_convention_1.default.GEN_AI_CLIENT_TOKEN_USAGE] = inputTokens + outputTokens;
        }
        if (config_1.default.pricingInfo && modelName) {
            const cost = helpers_1.default.getChatModelCost(modelName, config_1.default.pricingInfo, inputTokens, outputTokens);
            enrichments[semantic_convention_1.default.GEN_AI_USAGE_COST] = cost;
        }
        if (Object.keys(enrichments).length > 0) {
            StrandsSpanProcessor._setAttrs(span, enrichments);
        }
    }
    _storeChatInfoForParent(span, modelName) {
        try {
            const parentId = span.parentSpanId;
            if (!parentId)
                return;
            const finalAttrs = span.attributes || {};
            const info = {
                responseModel: finalAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] || modelName,
                responseId: finalAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID],
                finishReasons: finalAttrs[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON],
                inputTokens: finalAttrs['gen_ai.usage.input_tokens'] || 0,
                outputTokens: finalAttrs['gen_ai.usage.output_tokens'] || 0,
            };
            this._chatInfo.set(parentId, info);
        }
        catch {
            // ignore
        }
    }
    _enrichAgentFromChildren(span) {
        try {
            const spanId = span.spanContext().spanId;
            const info = this._chatInfo.get(spanId);
            this._chatInfo.delete(spanId);
            if (!info)
                return;
            const enrichments = {};
            const current = span.attributes || {};
            if (info.responseModel && !current[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL]) {
                enrichments[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] = info.responseModel;
            }
            if (info.responseId && !current[semantic_convention_1.default.GEN_AI_RESPONSE_ID]) {
                enrichments[semantic_convention_1.default.GEN_AI_RESPONSE_ID] = info.responseId;
            }
            if (info.finishReasons && !current[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON]) {
                enrichments[semantic_convention_1.default.GEN_AI_RESPONSE_FINISH_REASON] = info.finishReasons;
            }
            if (Object.keys(enrichments).length > 0) {
                StrandsSpanProcessor._setAttrs(span, enrichments);
            }
        }
        catch {
            // ignore
        }
    }
    // -----------------------------------------------------------------
    // Static extraction helpers
    // -----------------------------------------------------------------
    static _extractResponseId(span) {
        for (const event of span.events || []) {
            const ea = event.attributes || {};
            const rid = ea['gen_ai.response.id'] || ea['response_id'];
            if (rid)
                return String(rid);
        }
        return '';
    }
    static _extractToolCallIdFromSpanEvents(span) {
        for (const event of span.events || []) {
            if (event.name === 'gen_ai.tool.message') {
                const ea = event.attributes || {};
                const tid = ea['id'] || ea[semantic_convention_1.default.GEN_AI_TOOL_CALL_ID];
                if (tid)
                    return String(tid);
            }
        }
        for (const event of span.events || []) {
            const ea = event.attributes || {};
            const tid = ea[semantic_convention_1.default.GEN_AI_TOOL_CALL_ID] ||
                ea['tool_use_id'] ||
                ea['toolUseId'] ||
                ea['gen_ai.tool.call.id'];
            if (tid)
                return String(tid);
        }
        return null;
    }
    // -----------------------------------------------------------------
    // Content extraction → span attributes
    // -----------------------------------------------------------------
    _extractAndSetContent(span, operation) {
        try {
            const [inputMsgs, outputMsgs, systemInstr, toolDefs] = (0, utils_1.extractContentFromEvents)(span, operation);
            const additions = {};
            if (operation === semantic_convention_1.default.GEN_AI_OPERATION_TYPE_TOOLS) {
                if (inputMsgs.length > 0) {
                    const first = inputMsgs[0];
                    const parts = (typeof first === 'object' && first.parts) ? first.parts : [];
                    if (parts.length > 0) {
                        const arguments_ = parts[0].arguments || parts[0].response || '';
                        additions[semantic_convention_1.default.GEN_AI_TOOL_CALL_ARGUMENTS] = (0, utils_1.truncateContent)(typeof arguments_ === 'string' ? arguments_ : JSON.stringify(arguments_));
                    }
                }
                if (outputMsgs.length > 0) {
                    additions[semantic_convention_1.default.GEN_AI_TOOL_CALL_RESULT] = (0, utils_1.truncateContent)(JSON.stringify(outputMsgs));
                }
            }
            else {
                if (inputMsgs.length > 0) {
                    (0, utils_1.truncateMessageContent)(inputMsgs);
                    additions[semantic_convention_1.default.GEN_AI_INPUT_MESSAGES] = JSON.stringify(inputMsgs);
                }
                if (outputMsgs.length > 0) {
                    (0, utils_1.truncateMessageContent)(outputMsgs);
                    additions[semantic_convention_1.default.GEN_AI_OUTPUT_MESSAGES] = JSON.stringify(outputMsgs);
                }
                if (systemInstr) {
                    additions[semantic_convention_1.default.GEN_AI_SYSTEM_INSTRUCTIONS] = (0, utils_1.truncateContent)(String(systemInstr));
                }
                if (toolDefs) {
                    additions[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] = (0, utils_1.truncateContent)(String(toolDefs));
                }
            }
            if (Object.keys(additions).length > 0) {
                StrandsSpanProcessor._setAttrs(span, additions);
            }
        }
        catch {
            // ignore
        }
    }
    // -----------------------------------------------------------------
    // Chat inference log event
    // -----------------------------------------------------------------
    _emitChatInferenceEvent(span, attrs, serverAddress, serverPort) {
        try {
            const [inputMsgs, outputMsgs, systemInstr, toolDefs] = (0, utils_1.extractContentFromEvents)(span, 'chat');
            const extra = {};
            const inputTokens = attrs['gen_ai.usage.input_tokens'];
            const outputTokens = attrs['gen_ai.usage.output_tokens'];
            if (inputTokens != null)
                extra.inputTokens = inputTokens;
            if (outputTokens != null)
                extra.outputTokens = outputTokens;
            const cacheRead = attrs[semantic_convention_1.default.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] ||
                attrs['gen_ai.usage.cache_read_input_tokens'];
            const cacheWrite = attrs[semantic_convention_1.default.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] ||
                attrs['gen_ai.usage.cache_write_input_tokens'];
            if (cacheRead != null)
                extra.cacheReadInputTokens = cacheRead;
            if (cacheWrite != null)
                extra.cacheCreationInputTokens = cacheWrite;
            const responseId = attrs[semantic_convention_1.default.GEN_AI_RESPONSE_ID] ||
                StrandsSpanProcessor._extractResponseId(span);
            if (responseId)
                extra.responseId = responseId;
            if (systemInstr)
                extra.systemInstructions = systemInstr;
            // Tool definitions: prefer the event-sourced value, otherwise fall back to
            // whatever was already written to the span attribute (e.g. by native
            // Strands instrumentation upstream).
            const toolDefsAttr = toolDefs ||
                attrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS] ||
                attrs['gen_ai.tool.definitions'];
            if (toolDefsAttr)
                extra.toolDefinitions = toolDefsAttr;
            if (outputMsgs.length > 0) {
                const finishReasons = outputMsgs
                    .filter((m) => typeof m === 'object' && m.finish_reason)
                    .map((m) => m.finish_reason);
                if (finishReasons.length > 0)
                    extra.finishReasons = finishReasons;
            }
            extra.inputMessages = inputMsgs;
            extra.outputMessages = outputMsgs;
            // Stamp openlit.agent.version_hash + gen_ai.agent.version on the chat
            // span and surface them on the inference event extras so versions stay
            // attached even if the span attribute is dropped downstream.
            const requestModel = String(attrs[semantic_convention_1.default.GEN_AI_REQUEST_MODEL] || '');
            const responseModel = String(attrs[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] || '');
            extra.versionExtras = this._stampChatAgentVersion(span, attrs, {
                primaryModel: responseModel || requestModel,
                systemInstructionsJson: systemInstr ? String(systemInstr) : undefined,
                toolDefinitionsJson: toolDefs
                    ? String(toolDefs)
                    : (attrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS]
                        ? String(attrs[semantic_convention_1.default.GEN_AI_TOOL_DEFINITIONS])
                        : undefined),
            });
            (0, utils_1.emitStrandsInferenceEvent)(span, requestModel, serverAddress, serverPort, extra);
        }
        catch {
            // ignore
        }
    }
    // -----------------------------------------------------------------
    // Agent version stamping (Strands chat spans)
    // -----------------------------------------------------------------
    /**
     * Compute and write `openlit.agent.version_hash` (auto) and
     * `gen_ai.agent.version` (user override) onto a Strands chat span.
     * Returns the same attributes for inclusion in the inference event.
     */
    _stampChatAgentVersion(span, attrs, args) {
        const out = {};
        const additions = {};
        try {
            const temperature = attrs[semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE];
            const topP = attrs[semantic_convention_1.default.GEN_AI_REQUEST_TOP_P];
            const maxTokens = attrs[semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS];
            const versionHash = helpers_1.default.computeAgentVersionHash({
                systemInstructions: args.systemInstructionsJson ?? null,
                toolDefinitions: args.toolDefinitionsJson ?? null,
                primaryModel: args.primaryModel ?? null,
                runtimeConfig: {
                    temperature: typeof temperature === 'number' ? temperature : null,
                    top_p: typeof topP === 'number' ? topP : null,
                    max_tokens: typeof maxTokens === 'number' ? maxTokens : null,
                    provider: semantic_convention_1.default.GEN_AI_SYSTEM_STRANDS,
                },
                providers: [semantic_convention_1.default.GEN_AI_SYSTEM_STRANDS],
            });
            if (versionHash) {
                out[semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH] = versionHash;
                additions[semantic_convention_1.default.OPENLIT_AGENT_VERSION_HASH] = versionHash;
            }
        }
        catch {
            // Hash computation must never fail the wrapped call.
        }
        const versionLabel = (0, helpers_1.getCurrentAgentVersion)();
        if (versionLabel) {
            out[semantic_convention_1.default.GEN_AI_AGENT_VERSION] = versionLabel;
            additions[semantic_convention_1.default.GEN_AI_AGENT_VERSION] = versionLabel;
        }
        if (Object.keys(additions).length > 0) {
            StrandsSpanProcessor._setAttrs(span, additions);
        }
        return out;
    }
}
exports.StrandsSpanProcessor = StrandsSpanProcessor;
//# sourceMappingURL=processor.js.map