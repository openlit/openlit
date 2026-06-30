"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const constant_1 = require("../constant");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const semantic_convention_1 = __importDefault(require("../semantic-convention"));
const api_1 = require("@opentelemetry/api");
const metrics_1 = __importDefault(require("../otel/metrics"));
const helpers_1 = require("../helpers");
class BaseWrapper {
    static setBaseSpanAttributes(span, { genAIEndpoint: _genAIEndpoint, model, user, cost, aiSystem, serverAddress, serverPort }) {
        const applicationName = config_1.default.applicationName;
        const environment = config_1.default.environment;
        if (!applicationName) {
            throw new Error("[Openlit] OpenlitConfig.applicationName is not set. Please check your configuration.");
        }
        if (!environment) {
            throw new Error("[Openlit] OpenlitConfig.environment is not set. Please check your configuration.");
        }
        span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
        span.setAttribute(semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL, aiSystem);
        span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, environment);
        span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, applicationName);
        span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_MODEL, model);
        span.setAttribute(semantic_convention_1.default.GEN_AI_SDK_VERSION, constant_1.SDK_VERSION);
        if (serverAddress) {
            span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, serverAddress);
        }
        if (serverPort !== undefined) {
            span.setAttribute(semantic_convention_1.default.SERVER_PORT, serverPort);
        }
        if (typeof user === 'string' || typeof user === 'number') {
            span.setAttribute(semantic_convention_1.default.GEN_AI_REQUEST_USER, user);
        }
        if (cost !== undefined) {
            span.setAttribute(semantic_convention_1.default.GEN_AI_USAGE_COST, cost);
        }
        (0, helpers_1.applyCustomSpanAttributes)(span);
        span.setStatus({ code: api_1.SpanStatusCode.OK });
    }
    static recordMetrics(span, baseAttributes) {
        const applicationName = config_1.default.applicationName;
        const environment = config_1.default.environment;
        const { model, aiSystem, cost, errorType } = baseAttributes;
        const inputTokens = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_USAGE_INPUT_TOKENS);
        const outputTokens = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_USAGE_OUTPUT_TOKENS);
        const duration = BaseWrapper.getSpanAttribute(span, 'duration') ?? BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_DURATION_LEGACY);
        const operationName = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_OPERATION);
        const responseModel = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_RESPONSE_MODEL);
        const serverAddress = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.SERVER_ADDRESS);
        const serverPort = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.SERVER_PORT);
        const attributes = {
            [semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME]: constant_1.SDK_NAME,
            [semantic_conventions_1.ATTR_SERVICE_NAME]: applicationName,
            [semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
            [semantic_convention_1.default.GEN_AI_PROVIDER_NAME_OTEL]: aiSystem,
            [semantic_convention_1.default.GEN_AI_REQUEST_MODEL]: model,
        };
        if (operationName)
            attributes[semantic_convention_1.default.GEN_AI_OPERATION] = operationName;
        if (responseModel)
            attributes[semantic_convention_1.default.GEN_AI_RESPONSE_MODEL] = responseModel;
        if (serverAddress)
            attributes[semantic_convention_1.default.SERVER_ADDRESS] = serverAddress;
        if (serverPort !== undefined)
            attributes[semantic_convention_1.default.SERVER_PORT] = serverPort;
        if (errorType)
            attributes[semantic_convention_1.default.ERROR_TYPE] = errorType;
        if (Number.isFinite(inputTokens)) {
            metrics_1.default.genaiClientUsageTokens?.record(inputTokens, {
                ...attributes,
                [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_INPUT,
            });
        }
        if (Number.isFinite(outputTokens)) {
            metrics_1.default.genaiClientUsageTokens?.record(outputTokens, {
                ...attributes,
                [semantic_convention_1.default.GEN_AI_TOKEN_TYPE]: semantic_convention_1.default.GEN_AI_TOKEN_TYPE_OUTPUT,
            });
        }
        if (Number.isFinite(duration)) {
            metrics_1.default.genaiClientOperationDuration?.record(duration / 1e9, attributes);
        }
        const tbt = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_SERVER_TBT);
        if (Number.isFinite(tbt))
            metrics_1.default.genaiServerTbt?.record(tbt, attributes);
        const ttft = BaseWrapper.getSpanAttribute(span, semantic_convention_1.default.GEN_AI_SERVER_TTFT);
        if (Number.isFinite(ttft))
            metrics_1.default.genaiServerTtft?.record(ttft, attributes);
        if (Number.isFinite(ttft) && ttft > 0) {
            metrics_1.default.genaiClientTimeToFirstChunk?.record(ttft, attributes);
        }
        if (Number.isFinite(tbt) && tbt > 0) {
            metrics_1.default.genaiClientTimePerOutputChunk?.record(tbt, attributes);
            const outputTokensVal = Number.isFinite(outputTokens) ? outputTokens : 0;
            const serverRequestDuration = ttft + tbt * Math.max(outputTokensVal - 1, 0);
            metrics_1.default.genaiServerRequestDuration?.record(serverRequestDuration, attributes);
        }
        if (cost !== undefined) {
            const numericCost = typeof cost === 'number' ? cost : Number(cost);
            if (Number.isFinite(numericCost)) {
                metrics_1.default.genaiCost?.record(numericCost, attributes);
            }
        }
    }
    static getSpanAttribute(span, key) {
        if (key === 'duration') {
            // Use duration if present, even if 0
            const s = span;
            if (s.attributes && typeof s.attributes.duration !== 'undefined') {
                const attrDuration = s.attributes.duration;
                if (typeof attrDuration === 'number' && !isNaN(attrDuration)) {
                    return attrDuration;
                }
            }
            if (typeof s.duration === 'number' && !isNaN(s.duration))
                return s.duration;
            if (typeof s._duration === 'number' && !isNaN(s._duration))
                return s._duration;
            if (s.endTime && s.startTime) {
                const [endSec, endNano] = s.endTime;
                const [startSec, startNano] = s.startTime;
                const end = endSec * 1e9 + endNano;
                const start = startSec * 1e9 + startNano;
                if (end > start) {
                    return end - start;
                }
            }
            return undefined;
        }
        // @ts-expect-error: OpenTelemetry Span may have attributes property in some implementations
        return typeof span.attributes === 'object' ? span.attributes[key] : undefined;
    }
}
exports.default = BaseWrapper;
//# sourceMappingURL=base-wrapper.js.map