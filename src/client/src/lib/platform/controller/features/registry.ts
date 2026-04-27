import type {
	FeatureDesiredState,
	EnvironmentFeatureConfig,
} from "@/types/controller";

export interface ReportedService {
	workload_key: string;
	instrumentation_status: string;
	resource_attributes?: Record<string, string>;
}

export interface ReconcileAction {
	actionType: string;
	serviceKey: string;
	payload: string;
}

export interface FeatureHandler {
	feature: string;

	applyOperation(
		serviceId: string,
		operation: string,
		payload: Record<string, unknown>,
		dbConfigId?: string
	): Promise<Response>;

	reconcile(
		reportedServices: ReportedService[],
		desiredStates: Map<string, FeatureDesiredState>,
		envConfig?: EnvironmentFeatureConfig
	): ReconcileAction[];

	validatePayload(
		operation: string,
		payload: Record<string, unknown>
	): string | null;
}

const featureRegistry = new Map<string, FeatureHandler>();

export function registerFeature(handler: FeatureHandler) {
	featureRegistry.set(handler.feature, handler);
}

export function getFeatureHandler(
	feature: string
): FeatureHandler | undefined {
	return featureRegistry.get(feature);
}

export function getAllFeatureHandlers(): FeatureHandler[] {
	return Array.from(featureRegistry.values());
}
