"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitGradientInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-gradient`, '1.0.0', config);
    }
    safeWrap(target, method, patcher) {
        if (!target?.[method])
            return;
        if ((0, instrumentation_1.isWrapped)(target[method])) {
            this._unwrap(target, method);
        }
        this._wrap(target, method, patcher(this.tracer));
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@digitalocean/gradient', 
        // @digitalocean/gradient currently ships only as a prerelease (0.1.0-alpha.*).
        // A plain '>=0.1.0' range does NOT match prereleases under semver, so the hook
        // would load the module but silently skip patching. Anchor at the prerelease
        // tag (mirrors azure-ai-inference's '>=1.0.0-beta.1'); this still matches the
        // eventual stable 0.1.0 and later. See semver.satisfies prerelease semantics.
        ['>=0.1.0-alpha.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(gradient) {
        this._patch(gradient);
    }
    _patch(moduleExports) {
        try {
            const Gradient = moduleExports?.Gradient;
            if (!Gradient)
                return;
            // Chat completions (inference)
            this.safeWrap(Gradient.Chat?.Completions?.prototype, 'create', wrapper_1.default._patchChatCompletionCreate);
            // Agent chat completions
            this.safeWrap(Gradient.Agents?.Chat?.Completions?.prototype, 'create', wrapper_1.default._patchAgentChatCompletionCreate);
            // Image generation
            this.safeWrap(Gradient.Images?.prototype, 'generate', wrapper_1.default._patchImageGenerate);
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        const Gradient = moduleExports?.Gradient;
        if (!Gradient)
            return;
        const targets = [
            [Gradient.Chat?.Completions?.prototype, 'create'],
            [Gradient.Agents?.Chat?.Completions?.prototype, 'create'],
            [Gradient.Images?.prototype, 'generate'],
        ];
        for (const [target, method] of targets) {
            if (target?.[method]) {
                this._unwrap(target, method);
            }
        }
    }
}
exports.default = OpenlitGradientInstrumentation;
//# sourceMappingURL=index.js.map