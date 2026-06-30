"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENLIT_URL = exports.INSTRUMENTATION_PREFIX = exports.DEFAULT_APPLICATION_NAME = exports.DEFAULT_ENVIRONMENT = exports.SDK_VERSION = exports.SDK_NAME = void 0;
const package_json_1 = __importDefault(require("../package.json"));
exports.SDK_NAME = 'openlit';
exports.SDK_VERSION = package_json_1.default.version;
exports.DEFAULT_ENVIRONMENT = 'default';
exports.DEFAULT_APPLICATION_NAME = 'default';
exports.INSTRUMENTATION_PREFIX = '@openlit';
exports.OPENLIT_URL = 'http://127.0.0.1:3000';
//# sourceMappingURL=constant.js.map