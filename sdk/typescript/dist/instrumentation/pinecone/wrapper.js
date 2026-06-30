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
class PineconeWrapper extends base_wrapper_1.default {
    // Safely resolve the namespace string from the Index instance.
    // `this.namespace` on a Pinecone Index is a METHOD that creates namespace-scoped
    // sub-indices, not a string property. The actual namespace string may be stored
    // internally in `this.target.namespace` depending on the SDK version.
    static _resolveNamespace(indexInstance, paramsNamespace) {
        if (paramsNamespace && typeof paramsNamespace === 'string')
            return paramsNamespace;
        const ns = indexInstance?.target?.namespace ?? indexInstance?._namespace ?? '';
        return typeof ns === 'string' && ns ? ns : 'default';
    }
    static _setCommonAttributes(span, dbOperation, namespace) {
        const applicationName = config_1.default.applicationName || '';
        const environment = config_1.default.environment || '';
        span.setAttribute(semantic_convention_1.default.DB_SYSTEM_NAME, PineconeWrapper.dbSystem);
        span.setAttribute(semantic_convention_1.default.DB_OPERATION_NAME, dbOperation);
        span.setAttribute(semantic_convention_1.default.DB_NAMESPACE, namespace);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, PineconeWrapper.serverAddress);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, PineconeWrapper.serverPort);
        span.setAttribute(semantic_convention_1.default.GEN_AI_ENVIRONMENT, environment);
        span.setAttribute(semantic_convention_1.default.GEN_AI_APPLICATION_NAME, applicationName);
    }
    static _patchQuery(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_QUERY;
        return (originalMethod) => {
            return async function (...args) {
                const params = args[0] || {};
                const namespace = PineconeWrapper._resolveNamespace(this, params.namespace);
                const spanName = `${dbOperation} ${namespace}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        PineconeWrapper._setCommonAttributes(span, dbOperation, namespace);
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_QUERY_TOP_K, params.topK || 0);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        if (params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.filter));
                        }
                        const matchCount = response?.matches?.length || 0;
                        span.setAttribute(semantic_convention_1.default.DB_N_RESULTS, matchCount);
                        if (config_1.default.captureMessageContent && params.vector) {
                            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, JSON.stringify(params.vector?.slice(0, 10)));
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${namespace} top_k=${params.topK || 0} filtered=${params.filter ? 'true' : 'false'}`);
                        span.setStatus({ code: 1 }); // SpanStatusCode.OK
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
                const namespace = PineconeWrapper._resolveNamespace(this);
                const spanName = `${dbOperation} ${namespace}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const records = Array.isArray(args[0]) ? args[0] : [];
                        const duration = (Date.now() - startTime) / 1000;
                        PineconeWrapper._setCommonAttributes(span, dbOperation, namespace);
                        span.setAttribute(semantic_convention_1.default.DB_VECTOR_COUNT, records.length);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${namespace} vectors_count=${records.length}`);
                        if (config_1.default.captureMessageContent && records.length > 0) {
                            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, JSON.stringify(records.map((r) => r.id)));
                        }
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
    static _patchDelete(tracer, operationName) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_DELETE;
        return (originalMethod) => {
            return async function (...args) {
                const namespace = PineconeWrapper._resolveNamespace(this);
                const spanName = `${dbOperation} ${namespace}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const params = args[0] || {};
                        const duration = (Date.now() - startTime) / 1000;
                        PineconeWrapper._setCommonAttributes(span, `${dbOperation}.${operationName}`, namespace);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        // deleteOne passes an id string; deleteMany passes an array of ids
                        let ids = [];
                        if (typeof params === 'string') {
                            ids = [params];
                            span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, 1);
                        }
                        else if (Array.isArray(params)) {
                            ids = params;
                            span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, params.length);
                        }
                        else if (params.ids) {
                            ids = Array.isArray(params.ids) ? params.ids : [params.ids];
                            span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, ids.length);
                        }
                        if (params.deleteAll) {
                            span.setAttribute(semantic_convention_1.default.DB_DELETE_ALL, true);
                        }
                        if (params.filter) {
                            span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.filter));
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${namespace} ids=${JSON.stringify(ids)} delete_all=${params.deleteAll || false}`);
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
    static _patchUpdate(tracer) {
        const dbOperation = semantic_convention_1.default.DB_OPERATION_UPDATE;
        return (originalMethod) => {
            return async function (...args) {
                const namespace = PineconeWrapper._resolveNamespace(this);
                const spanName = `${dbOperation} ${namespace}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const params = args[0] || {};
                        const duration = (Date.now() - startTime) / 1000;
                        PineconeWrapper._setCommonAttributes(span, dbOperation, namespace);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        if (params.id)
                            span.setAttribute(semantic_convention_1.default.DB_UPDATE_ID, params.id);
                        if (params.values)
                            span.setAttribute(semantic_convention_1.default.DB_UPDATE_VALUES, String(params.values?.length || 0));
                        if (params.metadata) {
                            span.setAttribute(semantic_convention_1.default.DB_UPDATE_METADATA, JSON.stringify(params.metadata));
                        }
                        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${namespace} id=${params.id || ''} values=${params.values?.length || 0} set_metadata=${params.metadata ? JSON.stringify(params.metadata) : ''}`);
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
PineconeWrapper.dbSystem = semantic_convention_1.default.DB_SYSTEM_PINECONE;
PineconeWrapper.serverAddress = 'pinecone.io';
PineconeWrapper.serverPort = 443;
exports.default = PineconeWrapper;
//# sourceMappingURL=wrapper.js.map