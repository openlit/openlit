"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGradientEndpoint = resolveGradientEndpoint;
exports.agentIdFromHost = agentIdFromHost;
exports.gradientSpanCreationAttrs = gradientSpanCreationAttrs;
exports.normalizeStopSequences = normalizeStopSequences;
exports.applyGradientChatRequestAttributes = applyGradientChatRequestAttributes;
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const DEFAULT_HOSTS = {
    inference: ['inference.do-ai.run', 443],
    agent: ['agents.do-ai.run', 443],
};
const ENDPOINT_ATTRS = {
    inference: 'inferenceEndpoint',
    agent: 'agentEndpoint',
};
/**
 * Walk the Gradient APIResource `_client` chain and read the per-route endpoint
 * from the root client (mirrors Python `_resolve_endpoint`).
 */
function resolveGradientEndpoint(instance, kind) {
    const [defaultHost, defaultPort] = DEFAULT_HOSTS[kind];
    const attr = ENDPOINT_ATTRS[kind];
    const candidates = [];
    const seen = new Set();
    let current = instance;
    while (current && !seen.has(current)) {
        seen.add(current);
        candidates.push(current);
        current = current._client;
    }
    for (const cand of candidates) {
        const raw = cand?.[attr];
        if (!raw)
            continue;
        try {
            const url = new URL(String(raw).includes('://') ? String(raw) : `https://${raw}`);
            const host = url.hostname || defaultHost;
            const port = url.port
                ? Number(url.port)
                : url.protocol === 'http:'
                    ? 80
                    : 443;
            return [host, port];
        }
        catch {
            const host = String(raw).split(':')[0] || defaultHost;
            return [host, defaultPort];
        }
    }
    return DEFAULT_HOSTS[kind];
}
/** Extract agent UUID from `{uuid}.agents.do-ai.run` hostnames (Python parity). */
function agentIdFromHost(host) {
    if (!host || !host.includes('agents.do-ai.run'))
        return undefined;
    const head = host.split('.agents.do-ai.run')[0];
    return head || undefined;
}
function gradientSpanCreationAttrs(operationName, requestModel, serverAddress, serverPort) {
    return {
        [semantic_convention_1.default.GEN_AI_OPERATION]: operationName,
        [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: semantic_convention_1.default.GEN_AI_SYSTEM_DIGITALOCEAN,
        [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: requestModel,
        [semantic_convention_1.default.SERVER_ADDRESS]: serverAddress,
        [semantic_convention_1.default.SERVER_PORT]: serverPort,
    };
}
/** Normalize OpenAI-style stop sequences (Python `_normalize_stop`). */
function normalizeStopSequences(stop) {
    if (stop == null)
        return undefined;
    if (Array.isArray(stop)) {
        const out = stop.filter((s) => s != null && String(s).length > 0).map(String);
        return out.length > 0 ? out : undefined;
    }
    const s = String(stop);
    return s ? [s] : undefined;
}
/** Request attributes shared by chat and agent-chat surfaces. */
function applyGradientChatRequestAttributes(span, body) {
    if (body.temperature != null) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TEMPERATURE, body.temperature);
    }
    if (body.top_p != null) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_TOP_P, body.top_p);
    }
    const maxTokens = body.max_completion_tokens ?? body.max_tokens;
    if (maxTokens != null) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MAX_TOKENS, maxTokens);
    }
    if (body.frequency_penalty != null) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_FREQUENCY_PENALTY, body.frequency_penalty);
    }
    if (body.presence_penalty != null) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_PRESENCE_PENALTY, body.presence_penalty);
    }
    const stopSequences = normalizeStopSequences(body.stop ?? body.stop_sequences);
    if (stopSequences) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
    }
    if (body.seed != null) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_SEED, Number(body.seed));
    }
    if (body.n != null && body.n !== 1) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_CHOICE_COUNT, body.n);
    }
    if (body.user) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_USER, body.user);
    }
    if (body.reasoning_effort) {
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_REASONING_EFFORT, body.reasoning_effort);
    }
    span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_IS_STREAM, Boolean(body.stream));
}
//# sourceMappingURL=utils.js.map