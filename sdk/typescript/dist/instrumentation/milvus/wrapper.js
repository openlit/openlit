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
class MilvusWrapper extends base_wrapper_1.default {
    static _setCommonAttributes(span, dbOperation, collectionName) {
        const applicationName = config_1.default.applicationName || '';
        const environment = config_1.default.environment || '';
        span.setAttribute(semantic_convention_1.default.DB_SYSTEM_NAME, MilvusWrapper.dbSystem);
        span.setAttribute(semantic_convention_1.default.DB_OPERATION_NAME, dbOperation);
        span.setAttribute(semantic_convention_1.default.DB_COLLECTION_NAME, collectionName);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, MilvusWrapper.serverAddress);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, MilvusWrapper.serverPort);
        span.setAttribute(semantic_convention_1.default.GEN_AI_ENVIRONMENT, environment);
        span.setAttribute(semantic_convention_1.default.GEN_AI_APPLICATION_NAME, applicationName);
    }
    // Milvus SDK uses `collection_name` in params for most methods
    static _getCollectionName(params) {
        return params?.collection_name || params?.collectionName || 'unknown';
    }
    static _patchSearch(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_SEARCH;
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const collectionName = MilvusWrapper._getCollectionName(params);
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_QUERY_TOP_K, params.topk || params.limit || 10);
                        if (params.expr || params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, params.expr || params.filter);
                        }
                        if (params.output_fields) {
                            span.setAttribute(semantic_convention_1.default.DB_OUTPUT_FIELDS, JSON.stringify(params.output_fields));
                        }
                        const resultCount = response?.results?.length || 0;
                        span.setAttribute(semantic_convention_1.default.DB_N_RESULTS, resultCount);
                        if (config_1.default.captureMessageContent && params.vectors) {
                            const vectors = Array.isArray(params.vectors) ? params.vectors : [];
                            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, JSON.stringify(vectors.slice(0, 1).map((v) => v?.slice(0, 10))));
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} topk=${params.topk || params.limit || 10}`);
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
    static _patchInsert(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_INSERT;
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const collectionName = MilvusWrapper._getCollectionName(params);
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        const data = params.data || params.fields_data || [];
                        const rowCount = Array.isArray(data) ? data.length : 0;
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_COUNT, rowCount);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} rows=${rowCount}`);
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
                const params = args[0] || {};
                const collectionName = MilvusWrapper._getCollectionName(params);
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        const data = params.data || params.fields_data || [];
                        const rowCount = Array.isArray(data) ? data.length : 0;
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_COUNT, rowCount);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} rows=${rowCount}`);
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
                const params = args[0] || {};
                const collectionName = MilvusWrapper._getCollectionName(params);
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        if (params.expr || params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, params.expr || params.filter);
                        }
                        const ids = params.ids || [];
                        if (Array.isArray(ids) && ids.length > 0) {
                            span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, ids.length);
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName}`);
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
    static _patchQuery(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_QUERY;
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const collectionName = MilvusWrapper._getCollectionName(params);
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        if (params.expr || params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, params.expr || params.filter);
                        }
                        if (params.limit) {
                            span.setAttribute(semantic_convention_1.default.DB_QUERY_LIMIT, params.limit);
                        }
                        if (params.output_fields) {
                            span.setAttribute(semantic_convention_1.default.DB_OUTPUT_FIELDS, JSON.stringify(params.output_fields));
                        }
                        const resultCount = response?.data?.length || 0;
                        span.setAttribute(semantic_convention_1.default.DB_N_RESULTS, resultCount);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} results=${resultCount}`);
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
MilvusWrapper.dbSystem = semantic_convention_1.default.DB_SYSTEM_MILVUS;
MilvusWrapper.serverAddress = 'localhost';
MilvusWrapper.serverPort = 19530;
exports.default = MilvusWrapper;
//# sourceMappingURL=wrapper.js.map