import { Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class PineconeWrapper extends BaseWrapper {
    static dbSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _resolveNamespace(indexInstance: any, paramsNamespace?: string): string;
    static _setCommonAttributes(span: any, dbOperation: string, namespace: string): void;
    static _patchQuery(tracer: Tracer): any;
    static _patchUpsert(tracer: Tracer): any;
    static _patchDelete(tracer: Tracer, operationName: string): any;
    static _patchUpdate(tracer: Tracer): any;
}
export default PineconeWrapper;
