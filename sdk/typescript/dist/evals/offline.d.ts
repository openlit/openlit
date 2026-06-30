import { OfflineEvalResult, EvalType, BatchEvalResult, EvalOptions, EvalBatchOptions, EvalTypesOptions } from './types';
export declare function formatSummary(result: OfflineEvalResult): string;
export declare function formatBatchSummary(batch: BatchEvalResult): string;
export declare function runEval(options: EvalOptions): Promise<OfflineEvalResult>;
export declare function runEvalBatch(options: EvalBatchOptions): Promise<BatchEvalResult>;
export declare function fetchEvalTypes(options?: EvalTypesOptions): Promise<EvalType[]>;
