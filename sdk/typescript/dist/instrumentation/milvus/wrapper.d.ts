import { Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class MilvusWrapper extends BaseWrapper {
    static dbSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _setCommonAttributes(span: any, dbOperation: string, collectionName: string): void;
    static _getCollectionName(params: any): string;
    static _patchSearch(tracer: Tracer): any;
    static _patchInsert(tracer: Tracer): any;
    static _patchUpsert(tracer: Tracer): any;
    static _patchDelete(tracer: Tracer): any;
    static _patchQuery(tracer: Tracer): any;
}
export default MilvusWrapper;
