import { Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class AstraWrapper extends BaseWrapper {
    static dbSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _setCommonAttributes(span: any, dbOperation: string, collectionName: string, instance?: any): void;
    /**
     * Async wrapper for methods that return Promises (all Collection CRUD methods except `find`).
     */
    static _patchCollectionMethod(tracer: Tracer, dbOperation: string): any;
    /**
     * Synchronous wrapper for `find()` which returns a cursor synchronously.
     * Wrapping it as async would break the cursor API (e.g. `collection.find({}).toArray()`).
     */
    static _patchSyncFindMethod(tracer: Tracer): any;
    private static _setOperationAttributes;
    private static _setInsertAttributes;
    private static _setUpdateAttributes;
    private static _setReplaceAttributes;
    private static _setSelectAttributes;
    private static _setDeleteAttributes;
    private static _getActualDbOperation;
    private static _hasUpsertOption;
    private static _setFilterAttribute;
    private static _getInsertReturnedRows;
    private static _getUpdateReturnedRows;
    private static _getSelectReturnedRows;
    private static _getDeleteReturnedRows;
    private static _objectCount;
    private static _isCursorLike;
    private static _summaryValue;
    private static _safeStringify;
    private static _truncate;
    private static _getServerAddressAndPort;
    private static _findEndpoint;
    private static _parseEndpoint;
}
export default AstraWrapper;
