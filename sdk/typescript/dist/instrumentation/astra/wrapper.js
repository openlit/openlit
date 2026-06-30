"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const config_1 = __importDefault(require("../../config"));
const constant_1 = require("../../constant");
const helpers_1 = __importDefault(require("../../helpers"));
const semantic_convention_1 = __importDefault(require("../../semantic-convention"));
const base_wrapper_1 = __importDefault(require("../base-wrapper"));
const DEFAULT_SERVER = {
    serverAddress: 'astra.datastax.com',
    serverPort: 443,
};
let astraDbSdkVersion = 'unknown';
try {
    // Optional runtime dependency: keep this guarded so OpenLIT can load without Astra installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    astraDbSdkVersion = require('@datastax/astra-db-ts/package.json')?.version || 'unknown';
}
catch {
    astraDbSdkVersion = 'unknown';
}
class AstraWrapper extends base_wrapper_1.default {
    static _setCommonAttributes(span, dbOperation, collectionName, instance) {
        const applicationName = config_1.default.applicationName || '';
        const environment = config_1.default.environment || '';
        const { serverAddress, serverPort } = AstraWrapper._getServerAddressAndPort(instance);
        span.setAttribute(semantic_convention_1.default.DB_SYSTEM_NAME, AstraWrapper.dbSystem);
        span.setAttribute(semantic_convention_1.default.DB_OPERATION_NAME, dbOperation);
        span.setAttribute(semantic_convention_1.default.DB_COLLECTION_NAME, collectionName);
        span.setAttribute(semantic_convention_1.default.SERVER_ADDRESS, serverAddress);
        span.setAttribute(semantic_convention_1.default.SERVER_PORT, serverPort);
        span.setAttribute(semantic_conventions_1.ATTR_TELEMETRY_SDK_NAME, constant_1.SDK_NAME);
        span.setAttribute(semantic_convention_1.default.GEN_AI_OPERATION, semantic_convention_1.default.GEN_AI_OPERATION_TYPE_VECTORDB);
        span.setAttribute(semantic_convention_1.default.ATTR_DEPLOYMENT_ENVIRONMENT, environment);
        span.setAttribute(semantic_conventions_1.ATTR_SERVICE_NAME, applicationName);
        span.setAttribute(semantic_convention_1.default.DB_SDK_VERSION, astraDbSdkVersion);
        span.setAttribute(semantic_convention_1.default.GEN_AI_ENVIRONMENT, environment);
    }
    /**
     * Async wrapper for methods that return Promises (all Collection CRUD methods except `find`).
     */
    static _patchCollectionMethod(tracer, dbOperation) {
        return (originalMethod) => {
            return async function (...args) {
                const collectionName = this?.name || 'unknown';
                const spanName = `${dbOperation} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                return api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), async () => {
                    try {
                        const response = await originalMethod.apply(this, args);
                        const duration = (Date.now() - startTime) / 1000;
                        const actualDbOperation = AstraWrapper._getActualDbOperation(dbOperation, args);
                        AstraWrapper._setCommonAttributes(span, actualDbOperation, collectionName, this);
                        span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                        AstraWrapper._setOperationAttributes(span, {
                            dbOperation: actualDbOperation,
                            collectionName,
                            args,
                            response,
                        });
                        span.setStatus({ code: api_1.SpanStatusCode.OK });
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
    /**
     * Synchronous wrapper for `find()` which returns a cursor synchronously.
     * Wrapping it as async would break the cursor API (e.g. `collection.find({}).toArray()`).
     */
    static _patchSyncFindMethod(tracer) {
        return (originalMethod) => {
            return function (...args) {
                const collectionName = this?.name || 'unknown';
                const spanName = `${semantic_convention_1.default.DB_OPERATION_SELECT} ${collectionName}`;
                const span = tracer.startSpan(spanName, { kind: api_1.SpanKind.CLIENT });
                const startTime = Date.now();
                try {
                    const cursor = originalMethod.apply(this, args);
                    const duration = (Date.now() - startTime) / 1000;
                    AstraWrapper._setCommonAttributes(span, semantic_convention_1.default.DB_OPERATION_SELECT, collectionName, this);
                    span.setAttribute(semantic_convention_1.default.DB_CLIENT_OPERATION_DURATION, duration);
                    AstraWrapper._setOperationAttributes(span, {
                        dbOperation: semantic_convention_1.default.DB_OPERATION_SELECT,
                        collectionName,
                        args,
                        response: cursor,
                    });
                    span.setStatus({ code: api_1.SpanStatusCode.OK });
                    return cursor;
                }
                catch (e) {
                    helpers_1.default.handleException(span, e);
                    throw e;
                }
                finally {
                    span.end();
                }
            };
        };
    }
    static _setOperationAttributes(span, context) {
        switch (context.dbOperation) {
            case semantic_convention_1.default.DB_OPERATION_INSERT:
                AstraWrapper._setInsertAttributes(span, context);
                break;
            case semantic_convention_1.default.DB_OPERATION_UPDATE:
                AstraWrapper._setUpdateAttributes(span, context);
                break;
            case semantic_convention_1.default.DB_OPERATION_REPLACE:
            case semantic_convention_1.default.DB_OPERATION_UPSERT:
                AstraWrapper._setReplaceAttributes(span, context);
                break;
            case semantic_convention_1.default.DB_OPERATION_SELECT:
                AstraWrapper._setSelectAttributes(span, context);
                break;
            case semantic_convention_1.default.DB_OPERATION_DELETE:
            case semantic_convention_1.default.DB_OPERATION_FIND_AND_DELETE:
                AstraWrapper._setDeleteAttributes(span, context);
                break;
            default:
                span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${context.dbOperation} ${context.collectionName}`);
        }
    }
    static _setInsertAttributes(span, { dbOperation, collectionName, args, response }) {
        const documents = args[0];
        const documentsCount = AstraWrapper._objectCount(documents);
        span.setAttribute(semantic_convention_1.default.DB_DOCUMENTS_COUNT, documentsCount);
        if (config_1.default.captureMessageContent) {
            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, AstraWrapper._safeStringify(documents));
        }
        const returnedRows = AstraWrapper._getInsertReturnedRows(response);
        if (returnedRows !== undefined) {
            span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, returnedRows);
        }
        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} documents_count=${documentsCount}`);
    }
    static _setUpdateAttributes(span, { dbOperation, collectionName, args, response }) {
        const filter = args[0] || {};
        const update = args[1] || {};
        AstraWrapper._setFilterAttribute(span, filter);
        if (config_1.default.captureMessageContent) {
            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, AstraWrapper._safeStringify(update));
        }
        const returnedRows = AstraWrapper._getUpdateReturnedRows(response);
        if (returnedRows !== undefined) {
            span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, returnedRows);
        }
        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)} update=${AstraWrapper._summaryValue(update)}`);
    }
    static _setReplaceAttributes(span, { dbOperation, collectionName, args }) {
        const filter = args[0] || {};
        const upsert = AstraWrapper._hasUpsertOption(args);
        AstraWrapper._setFilterAttribute(span, filter);
        if (config_1.default.captureMessageContent) {
            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, AstraWrapper._safeStringify(filter));
        }
        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)} upsert=${upsert}`);
    }
    static _setSelectAttributes(span, { dbOperation, collectionName, args, response }) {
        const filter = args[0] || {};
        AstraWrapper._setFilterAttribute(span, filter);
        if (config_1.default.captureMessageContent) {
            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, AstraWrapper._safeStringify(filter));
        }
        const returnedRows = AstraWrapper._getSelectReturnedRows(response);
        if (returnedRows !== undefined) {
            span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, returnedRows);
        }
        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)}`);
    }
    static _setDeleteAttributes(span, { dbOperation, collectionName, args, response }) {
        const filter = args[0] || {};
        AstraWrapper._setFilterAttribute(span, filter);
        if (config_1.default.captureMessageContent) {
            span.setAttribute(semantic_convention_1.default.DB_QUERY_TEXT, AstraWrapper._safeStringify(filter));
        }
        const returnedRows = AstraWrapper._getDeleteReturnedRows(response, dbOperation);
        if (returnedRows !== undefined) {
            span.setAttribute(semantic_convention_1.default.DB_RESPONSE_RETURNED_ROWS, returnedRows);
        }
        span.setAttribute(semantic_convention_1.default.DB_QUERY_SUMMARY, `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)}`);
    }
    static _getActualDbOperation(dbOperation, args) {
        if (dbOperation === semantic_convention_1.default.DB_OPERATION_REPLACE && AstraWrapper._hasUpsertOption(args)) {
            return semantic_convention_1.default.DB_OPERATION_UPSERT;
        }
        return dbOperation;
    }
    static _hasUpsertOption(args) {
        return args.slice(2).some((arg) => arg && typeof arg === 'object' && arg.upsert === true);
    }
    static _setFilterAttribute(span, filter) {
        if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
            span.setAttribute(semantic_convention_1.default.DB_FILTER, AstraWrapper._safeStringify(filter));
        }
    }
    static _getInsertReturnedRows(response) {
        if (!response)
            return undefined;
        if (typeof response.insertedCount === 'number')
            return response.insertedCount;
        if (typeof response.inserted_count === 'number')
            return response.inserted_count;
        if (Array.isArray(response.insertedIds))
            return response.insertedIds.length;
        if (Array.isArray(response.inserted_ids))
            return response.inserted_ids.length;
        if (response.insertedIds && typeof response.insertedIds === 'object')
            return Object.keys(response.insertedIds).length;
        if (response.inserted_ids && typeof response.inserted_ids === 'object')
            return Object.keys(response.inserted_ids).length;
        if (response.insertedId || response.inserted_id)
            return 1;
        return undefined;
    }
    static _getUpdateReturnedRows(response) {
        if (!response)
            return undefined;
        if (typeof response.modifiedCount === 'number')
            return response.modifiedCount;
        if (typeof response.modified_count === 'number')
            return response.modified_count;
        if (typeof response.matchedCount === 'number')
            return response.matchedCount;
        if (typeof response.matched_count === 'number')
            return response.matched_count;
        if (typeof response.update_info?.nModified === 'number')
            return response.update_info.nModified;
        if (typeof response.updateInfo?.nModified === 'number')
            return response.updateInfo.nModified;
        return undefined;
    }
    static _getSelectReturnedRows(response) {
        if (!response || AstraWrapper._isCursorLike(response))
            return undefined;
        if (Array.isArray(response))
            return response.length;
        if (typeof response.length === 'number')
            return response.length;
        return 1;
    }
    static _getDeleteReturnedRows(response, dbOperation) {
        if (!response)
            return dbOperation === semantic_convention_1.default.DB_OPERATION_FIND_AND_DELETE ? 0 : undefined;
        if (typeof response.deletedCount === 'number')
            return response.deletedCount;
        if (typeof response.deleted_count === 'number')
            return response.deleted_count;
        if (dbOperation === semantic_convention_1.default.DB_OPERATION_FIND_AND_DELETE)
            return 1;
        return undefined;
    }
    static _objectCount(obj) {
        if (Array.isArray(obj))
            return obj.length;
        if (obj !== undefined && obj !== null)
            return 1;
        return 0;
    }
    static _isCursorLike(response) {
        return !!response && (typeof response[Symbol.asyncIterator] === 'function'
            || typeof response[Symbol.iterator] === 'function'
            || typeof response.toArray === 'function'
            || typeof response.next === 'function');
    }
    static _summaryValue(value) {
        return AstraWrapper._truncate(AstraWrapper._safeStringify(value));
    }
    static _safeStringify(value) {
        if (typeof value === 'string')
            return value;
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }
    static _truncate(value, maxLength = 200) {
        return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
    }
    static _getServerAddressAndPort(instance) {
        const endpoint = AstraWrapper._findEndpoint(instance);
        if (!endpoint)
            return DEFAULT_SERVER;
        return AstraWrapper._parseEndpoint(endpoint);
    }
    static _findEndpoint(instance) {
        const candidates = [
            instance,
            instance?.database,
            instance?.db,
            instance?.client,
            instance?._client,
            instance?.database?.client,
            instance?.db?.client,
        ];
        const keys = ['apiEndpoint', 'api_endpoint', 'endpoint', 'baseUrl', 'base_url'];
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object')
                continue;
            for (const key of keys) {
                const value = candidate[key];
                if (typeof value === 'string' && value.length > 0)
                    return value;
            }
        }
        return undefined;
    }
    static _parseEndpoint(endpoint) {
        const fallbackPort = endpoint.startsWith('http://') ? 80 : DEFAULT_SERVER.serverPort;
        try {
            if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
                const parsed = new URL(endpoint);
                return {
                    serverAddress: parsed.hostname || DEFAULT_SERVER.serverAddress,
                    serverPort: parsed.port ? Number(parsed.port) : fallbackPort,
                };
            }
        }
        catch {
            return DEFAULT_SERVER;
        }
        const [serverAddress, port] = endpoint.split(':');
        return {
            serverAddress: serverAddress || DEFAULT_SERVER.serverAddress,
            serverPort: port ? Number(port) || DEFAULT_SERVER.serverPort : DEFAULT_SERVER.serverPort,
        };
    }
}
AstraWrapper.dbSystem = semantic_convention_1.default.DB_SYSTEM_ASTRA;
AstraWrapper.serverAddress = DEFAULT_SERVER.serverAddress;
AstraWrapper.serverPort = DEFAULT_SERVER.serverPort;
exports.default = AstraWrapper;
//# sourceMappingURL=wrapper.js.map