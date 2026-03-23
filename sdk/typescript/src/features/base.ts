import PromptHub from './prompt-hub';
import RuleEngine from './rule-engine';
import Vault from './vault';

export default class BaseOpenlit {
  static getPrompts = PromptHub.getPrompts;
  static getSecrets = Vault.getSecrets;
  static evaluateRule = RuleEngine.evaluate;
}
