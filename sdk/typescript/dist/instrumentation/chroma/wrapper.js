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
class ChromaWrapper extends base_wrapper_1.default {
    static _setCommonAttributes(span, dbOperation, collectionName) {
        const applicationName = config_1.default.applicationName || '';
        const environment = config_1.default.environment || '';
        span.setAttribute(semantic_convention_1.default.DB_SYSTEM_NAME, ChromaWrapper.dbSystem);
        span.setAttribute(semantic_convention_1.default.DB_OPERATION_NAME, dbOperation);
        span.setAttribute(semantic_convention_1.default.DB_COLLECTION_NAME, collectionName);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, ChromaWrapper.serverAddress);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, ChromaWrapper.serverPort);
        span.setAttribute(semantic_convention_1.default.GEN_AI_ENVIRONMENT, environment);
        span.setAttribute(semantic_convention_1.default.GEN_AI_APPLICATION_NAME, applicationName);
    }
    static _patchCollectionMethod(tracer, dbOperation) {
        return (originalMethod) => {
            return async function (...args) {
                // `this` is a Collection instance; name is stored as this.name
                const collectionName = this?.name || 'unknown';
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        const params = args[0] || {};
                        ChromaWrapper._setCommonAttributes(span, dbOperation, collectionName);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        // Operation-specific attributes
                        switch (dbOperation) {
                            case semantic_convention_1.default.DB_OPERATION_QUERY: {
                                const nResults = params.nResults || params.n_results || 10;
                                span.setAttribute(semantic_convention_1.default.DB_VECTOR_QUERY_TOP_K, nResults);
                                if (params.where)
                                    span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.where));
                                if (params.whereDocument)
                                    span.setAttribute(semantic_convention_1.default.DB_WHERE_DOCUMENT, JSON.stringify(params.whereDocument));
                                const returnedCount = response?.ids?.[0]?.length || 0;
                                span.setAttribute(semantic_convention_1.default.DB_N_RESULTS, returnedCount);
                                if (config_1.default.captureMessageContent && params.queryTexts) {
                                    span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, JSON.stringify(params.queryTexts));
                                }
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} n_results=${nResults}`);
                                break;
                            }
                            case semantic_convention_1.default.DB_OPERATION_INSERT:
                            case semantic_convention_1.default.DB_OPERATION_UPSERT: {
                                const count = Array.isArray(params.ids) ? params.ids.length : (params.ids ? 1 : 0);
                                span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, count);
                                span.setAttribute(semantic_convention_1.default.DB_VECTOR_COUNT, count);
                                if (Array.isArray(params.documents)) {
                                    span.setAttribute(semantic_convention_1.default.DB_DOCUMENTS_COUNT, params.documents.length);
                                }
                                if (Array.isArray(params.metadatas)) {
                                    span.setAttribute(semantic_convention_1.default.DB_METADATA_COUNT, params.metadatas.length);
                                }
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} count=${count}`);
                                break;
                            }
                            case semantic_convention_1.default.DB_OPERATION_GET: {
                                const ids = params.ids;
                                const idCount = Array.isArray(ids) ? ids.length : (ids ? 1 : 0);
                                if (idCount > 0)
                                    span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, idCount);
                                if (params.where)
                                    span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.where));
                                const returnedRows = response?.ids?.length || 0;
                                span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, returnedRows);
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} ids=${idCount}`);
                                break;
                            }
                            case semantic_convention_1.default.DB_OPERATION_DELETE: {
                                const ids = params.ids;
                                const idCount = Array.isArray(ids) ? ids.length : (ids ? 1 : 0);
                                if (idCount > 0)
                                    span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, idCount);
                                if (params.where)
                                    span.setAttribute(semantic_convention_1.default.DB_FILTER, JSON.stringify(params.where));
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} ids=${idCount}`);
                                break;
                            }
                            case semantic_convention_1.default.DB_OPERATION_PEEK: {
                                const limit = params.limit || params || 10;
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_LIMIT, typeof limit === 'number' ? limit : 10);
                                const returnedRows = response?.ids?.length || 0;
                                span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, returnedRows);
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName}`);
                                break;
                            }
                            case semantic_convention_1.default.DB_OPERATION_UPDATE: {
                                const ids = params.ids;
                                const idCount = Array.isArray(ids) ? ids.length : (ids ? 1 : 0);
                                if (idCount > 0)
                                    span.setAttribute(semantic_convention_1.default.DB_ID_COUNT, idCount);
                                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} ids=${idCount}`);
                                break;
                            }
                        }
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
}
ChromaWrapper.dbSystem = semantic_convention_1.default.DB_SYSTEM_CHROMA;
ChromaWrapper.serverAddress = 'localhost';
ChromaWrapper.serverPort = 8000;
exports.default = ChromaWrapper;
//# sourceMappingURL=wrapper.js.map