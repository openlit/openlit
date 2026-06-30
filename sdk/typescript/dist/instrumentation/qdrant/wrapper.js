"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const config_1 = __importDefault(require("../../config"));
const helpers_1 = __importDefault(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
class QdrantWrapper extends base_wrapper_1.default {
    static _setCommonAttributes(span, dbOperation, collectionName) {
        const applicationName = config_1.default.applicationName || '';
        const environment = config_1.default.environment || '';
        span.setAttribute(semantic_convention_1.default.DB_SYSTEM_NAME, QdrantWrapper.dbSystem);
        span.setAttribute(semantic_convention_1.default.DB_OPERATION_NAME, dbOperation);
        span.setAttribute(semantic_convention_1.default.DB_COLLECTION_NAME, collectionName);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, QdrantWrapper.serverAddress);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, QdrantWrapper.serverPort);
        span.setAttribute(semantic_convention_1.default.GEN_AI_ENVIRONMENT, environment);
        span.setAttribute(semantic_convention_1.default.GEN_AI_APPLICATION_NAME, applicationName);
    }
    static _patchSearch(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_SEARCH;
        return (originalMethod) => {
            return async function (...args) {
                // args[0] = collectionName, args[1] = searchParams
                const collectionName = typeof args[0] === 'string' ? args[0] : 'unknown';
                const params = args[1] || {};
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_QUERY_TOP_K, params.limit || 10);
                        if (params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.filter));
                        }
                        if (params.with_payload !== undefined) {
                            span.setAttribute(semantic_convention_1.default.DB_WITH_PAYLOAD, String(params.with_payload));
                        }
                        const resultCount = Array.isArray(response) ? response.length : 0;
                        span.setAttribute(semantic_convention_1.default.DB_N_RESULTS, resultCount);
                        if (config_1.default.captureMessageContent && params.vector) {
                            const vectorPreview = Array.isArray(params.vector)
                                ? JSON.stringify(params.vector.slice(0, 10))
                                : String(params.vector);
                            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, vectorPreview);
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} limit=${params.limit || 10} filtered=${params.filter ? 'true' : 'false'}`);
                        span.setStatus({ code: 1 });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        throw e;
                    }
                    finally {
                        span.end();
                    }
                });
            };
        };
    }
    static _patchUpsert(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_UPSERT;
        return (originalMethod) => {
            return async function (...args) {
                const collectionName = typeof args[0] === 'string' ? args[0] : 'unknown';
                const params = args[1] || {};
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        const points = params.points || [];
                        QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_COUNT, points.length);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} points=${points.length}`);
                        span.setStatus({ code: 1 });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        throw e;
                    }
                    finally {
                        span.end();
                    }
                });
            };
        };
    }
    static _patchDelete(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_DELETE;
        return (originalMethod) => {
            return async function (...args) {
                const collectionName = typeof args[0] === 'string' ? args[0] : 'unknown';
                const params = args[1] || {};
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        const points = params.points || [];
                        if (points.length > 0) {
                            span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, points.length);
                        }
                        if (params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.filter));
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} points=${points.length}`);
                        span.setStatus({ code: 1 });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        throw e;
                    }
                    finally {
                        span.end();
                    }
                });
            };
        };
    }
    static _patchRetrieve(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_GET;
        return (originalMethod) => {
            return async function (...args) {
                const collectionName = typeof args[0] === 'string' ? args[0] : 'unknown';
                const params = args[1] || {};
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        const ids = Array.isArray(params.ids) ? params.ids : [];
                        span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, ids.length);
                        const resultCount = Array.isArray(response) ? response.length : 0;
                        span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, resultCount);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} ids=${ids.length}`);
                        span.setStatus({ code: 1 });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        throw e;
                    }
                    finally {
                        span.end();
                    }
                });
            };
        };
    }
    static _patchScroll(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_GET;
        return (originalMethod) => {
            return async function (...args) {
                const collectionName = typeof args[0] === 'string' ? args[0] : 'unknown';
                const params = args[1] || {};
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_LIMIT, params.limit || 10);
                        if (params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.filter));
                        }
                        const resultCount = response?.points?.length || 0;
                        span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, resultCount);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} limit=${params.limit || 10}`);
                        span.setStatus({ code: 1 });
                        return response;
                    }
                    catch (e) {
                        helpers_1.default.handleException(span, e);
                        throw e;
                    }
                    finally {
                        span.end();
                    }
                });
            };
        };
    }
}
QdrantWrapper.dbSystem = semantic_convention_1.default.DB_SYSTEM_QDRANT;
QdrantWrapper.serverAddress = 'localhost';
QdrantWrapper.serverPort = 6333;
exports.default = QdrantWrapper;
//# sourceMappingURL=wrapper.js.map