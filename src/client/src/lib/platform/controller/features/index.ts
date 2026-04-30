export {
	registerFeature,
	getFeatureHandler,
	getAllFeatureHandlers,
} from "./registry";
export type {
	FeatureHandler,
	ReportedService,
	ReconcileAction,
} from "./registry";

import "./instrumentation";
import "./agent";
import "./prompts";
import "./envs";
