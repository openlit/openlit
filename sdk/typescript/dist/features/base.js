"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prompt_hub_1 = __importDefault(require("./prompt-hub"));
const rule_engine_1 = __importDefault(require("./rule-engine"));
const vault_1 = __importDefault(require("./vault"));
class BaseOpenlit {
}
BaseOpenlit.getPrompts = prompt_hub_1.default.getPrompts;
BaseOpenlit.getSecrets = vault_1.default.getSecrets;
BaseOpenlit.evaluateRule = rule_engine_1.default.evaluateRule;
exports.default = BaseOpenlit;
//# sourceMappingURL=base.js.map