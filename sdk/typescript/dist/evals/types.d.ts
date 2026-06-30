export interface OfflineEvaluation {
    type: string;
    score: number;
    verdict: string;
    classification: string;
    explanation: string;
}
export interface ContextInfo {
    ruleMatched: boolean;
    matchingRuleIds: string[];
    contextEntityIds: string[];
    userContextsCount: number;
}
export interface OfflineEvalResult {
    success: boolean;
    evaluations: OfflineEvaluation[];
    contextApplied?: ContextInfo;
    metadata?: Record<string, any>;
    error?: string;
}
export interface EvalType {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    isCustom: boolean;
}
export interface BatchEvalResult {
    results: OfflineEvalResult[];
    runId?: string;
}
export interface EvalOptions {
    prompt: string;
    response: string;
    contexts?: string[];
    evalTypes?: string[];
    attributes?: Record<string, string | number | boolean>;
    thresholdScore?: number;
    storeResults?: boolean;
    runId?: string;
    metadata?: Record<string, string>;
    openlitApiKey?: string;
    openlitUrl?: string;
    printResults?: boolean;
}
export interface EvalBatchOptions {
    dataset: Array<{
        prompt: string;
        response: string;
        contexts?: string[];
        evalTypes?: string[];
        attributes?: Record<string, string | number | boolean>;
        thresholdScore?: number;
        metadata?: Record<string, string>;
    }>;
    evalTypes?: string[];
    attributes?: Record<string, string | number | boolean>;
    thresholdScore?: number;
    storeResults?: boolean;
    runId?: string;
    maxConcurrent?: number;
    openlitApiKey?: string;
    openlitUrl?: string;
    printResults?: boolean;
}
export interface EvalTypesOptions {
    openlitApiKey?: string;
    openlitUrl?: string;
}
export declare function isPassed(result: OfflineEvalResult): boolean;
export declare function getFailedEvals(result: OfflineEvalResult): OfflineEvaluation[];
export declare function isAllPassed(batch: BatchEvalResult): boolean;
export declare function getPassRate(batch: BatchEvalResult): number;
