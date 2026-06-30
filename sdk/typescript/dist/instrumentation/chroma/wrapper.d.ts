import { Tracer } from '@opentelemetry/api';
import BaseWrapper from '../base-wrapper';
declare class ChromaWrapper extends BaseWrapper {
    static dbSystem: string;
    static serverAddress: string;
    static serverPort: number;
    static _setCommonAttributes(span: any, dbOperation: string, collectionName: string): void;
    static _patchCollectionMethod(tracer: Tracer, dbOperation: string): any;
}
export default ChromaWrapper;
