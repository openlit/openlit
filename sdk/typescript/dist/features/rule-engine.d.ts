import { RuleEngineOptions, RuleEngineResult } from '../types';
export default class RuleEngine {
    static evaluateRule(options: RuleEngineOptions): Promise<RuleEngineResult | {
        err: string;
    }>;
}
