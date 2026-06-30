import PromptHub from './prompt-hub';
import RuleEngine from './rule-engine';
import Vault from './vault';
export default class BaseOpenlit {
    static getPrompts: typeof PromptHub.getPrompts;
    static getSecrets: typeof Vault.getSecrets;
    static evaluateRule: typeof RuleEngine.evaluateRule;
}
