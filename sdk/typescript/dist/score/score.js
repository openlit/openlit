"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logScore = logScore;
const api_1 = require("@opentelemetry/api");
const api_logs_1 = require("@opentelemetry/api-logs");
const config_1 = __importDefault(require("../config"));
const helpers_1 = require("../helpers");
const events_1 = __importDefault(require("../otel/events"));
const semantic_convention_1 = __importDefault(require("../semantic-convention"));
function normalizeScoreValue(value) {
    if (typeof value === 'boolean') {
        return {
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_VALUE]: value ? 1.0 : 0.0,
            [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_LABEL]: value ? 'true' : 'false',
        };
    }
    if (typeof value === 'number') {
        return { [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_VALUE]: value };
    }
    return { [semantic_convention_1.default.GEN_AI_EVALUATION_SCORE_LABEL]: value };
}
function eventsDisabled() {
    return Boolean(config_1.default.disableEvents);
}
function isOtelSafeMetadataValue(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
function mergeMetadata(eventAttributes, metadata) {
    if (!metadata) {
        return;
    }
    for (const [key, value] of Object.entries(metadata)) {
        if (value === undefined || value === null) {
            continue;
        }
        if (isOtelSafeMetadataValue(value)) {
            eventAttributes[key] = value;
            continue;
        }
        if (Array.isArray(value) && value.every(isOtelSafeMetadataValue)) {
            eventAttributes[key] = value;
        }
    }
}
function mergeCustomEventAttributes(eventAttributes) {
    const customAttrs = (0, helpers_1.getMergedCustomAttributes)();
    for (const [key, value] of Object.entries(customAttrs)) {
        if (value !== undefined && value !== null) {
            if (!(key in eventAttributes)) {
                eventAttributes[key] = value;
            }
        }
    }
}
const HEX_RE = /^[0-9a-fA-F]+$/;
function validHexId(value, expectedLen) {
    return value.length === expectedLen && HEX_RE.test(value);
}
function spanFromIds(traceId, spanId) {
    if (!validHexId(traceId, 32) || !validHexId(spanId, 16)) {
        return undefined;
    }
    const spanContext = {
        traceId,
        spanId,
        traceFlags: api_1.TraceFlags.SAMPLED,
        isRemote: true,
    };
    return api_1.trace.wrapSpanContext(spanContext);
}
function resolveTargetSpan(options) {
    if (options.span) {
        return options.span;
    }
    const activeSpan = api_1.trace.getActiveSpan();
    if (activeSpan?.isRecording()) {
        return activeSpan;
    }
    if (options.traceId && options.spanId) {
        return spanFromIds(options.traceId, options.spanId);
    }
    return activeSpan ?? undefined;
}
function emitScoreLogEvent(eventAttributes, targetSpan) {
    if (eventsDisabled() || !events_1.default.logger) {
        return false;
    }
    events_1.default.logger.emit({
        eventName: semantic_convention_1.default.GEN_AI_EVALUATION_RESULT,
        context: api_1.trace.setSpan(api_1.context.active(), targetSpan),
        severityNumber: api_logs_1.SeverityNumber.INFO,
        severityText: 'INFO',
        body: semantic_convention_1.default.GEN_AI_EVALUATION_RESULT,
        attributes: {
            ...eventAttributes,
            'event.name': semantic_convention_1.default.GEN_AI_EVALUATION_RESULT,
        },
    });
    return true;
}
function logScore(options) {
    const { name, value, comment, idempotencyKey, metadata } = options;
    if (!name) {
        throw new Error('name is required');
    }
    const targetSpan = resolveTargetSpan(options);
    if (!targetSpan) {
        return false;
    }
    const eventAttributes = {
        [semantic_convention_1.default.GEN_AI_EVALUATION_NAME]: name,
        ...normalizeScoreValue(value),
    };
    if (comment) {
        eventAttributes[semantic_convention_1.default.GEN_AI_EVALUATION_EXPLANATION] = comment;
    }
    if (idempotencyKey) {
        eventAttributes[semantic_convention_1.default.OPENLIT_SCORE_IDEMPOTENCY_KEY] = idempotencyKey;
    }
    mergeMetadata(eventAttributes, metadata);
    mergeCustomEventAttributes(eventAttributes);
    let emitted = false;
    if (targetSpan.isRecording()) {
        targetSpan.addEvent(semantic_convention_1.default.GEN_AI_EVALUATION_RESULT, eventAttributes);
        emitted = true;
    }
    if (emitScoreLogEvent(eventAttributes, targetSpan)) {
        emitted = true;
    }
    return emitted;
}
//# sourceMappingURL=score.js.map