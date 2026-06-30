/**
 * Guard Pipeline -- composes multiple guards into an ordered evaluation chain.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_pipeline.py
 */
import { Guard, PipelineResult } from './base';
export interface PipelineOptions {
    guards?: Guard[];
    failOpen?: boolean;
}
export declare class Pipeline {
    private readonly _guards;
    private readonly _failOpen;
    constructor(opts?: PipelineOptions);
    get guards(): Guard[];
    evaluate(text: string, phase?: string): PipelineResult;
    private static _emitOtel;
}
