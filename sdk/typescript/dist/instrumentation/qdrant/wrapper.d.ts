import { Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class QdrantWrapper extends BaseWrapper {
    static dbSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _setCommonAttributes(span: any, dbOperation: string, collectionName: string): void;
    static _patchSearch(tracer: Tracer): any;
    static _patchUpsert(tracer: Tracer): any;
    static _patchDelete(tracer: Tracer): any;
    static _patchRetrieve(tracer: Tracer): any;
    static _patchScroll(tracer: Tracer): any;
}
export default QdrantWrapper;
