import {
	getServiceById,
	getControllerIdsForWorkload,
	queueAction,
	updateFeatureDesiredState,
} from "@/lib/platform/controller";
import { KNOWN_ACTIONS } from "@/types/controller";
import type { FeatureDesiredState, EnvironmentFeatureConfig } from "@/types/controller";
import type {
	FeatureHandler,
	ReportedService,
	ReconcileAction,
} from "./registry";
import { registerFeature } from "./registry";

const FEATURE = "instrumentation";

async function resolveServiceAndControllers(
	serviceId: string,
	dbConfigId?: string
): Promise<
	| { error: Response }
	| { service: any; targets: string[] }
> {
	const serviceRes = await getServiceById(serviceId, dbConfigId);
	if (!serviceRes.data || serviceRes.data.length === 0) {
		return { error: Response.json({ error: "Service not found" }, { status: 404 }) };
	}
	const service = serviceRes.data[0];
	if (!service.workload_key) {
		return { error: Response.json({ error: "Service is missing workload_key" }, { status: 500 }) };
	}

	const controllerIds = await getControllerIdsForWorkload(
		service.service_name,
		service.namespace || "",
		service.cluster_id || "default",
		dbConfigId
	);
	const targets =
		controllerIds.data?.map((r) => r.controller_instance_id) || [];
	if (targets.length === 0) {
		targets.push(service.controller_instance_id);
	}

	return { service, targets };
}

const instrumentationHandler: FeatureHandler = {
	feature: FEATURE,

	validatePayload(operation: string, _payload: Record<string, unknown>) {
		if (operation !== "enable" && operation !== "disable") {
			return `Unknown operation "${operation}" for feature "${FEATURE}". Expected "enable" or "disable".`;
		}
		return null;
	},

	async applyOperation(
		serviceId: string,
		operation: string,
		_payload: Record<string, unknown>,
		dbConfigId?: string
	): Promise<Response> {
		try {
			const resolved = await resolveServiceAndControllers(serviceId, dbConfigId);
			if ("error" in resolved) return resolved.error;
			const { service, targets } = resolved;

			const enabling = operation === "enable";
			const desiredStatus = enabling ? "instrumented" : "none";
			const actionType = enabling
				? KNOWN_ACTIONS.INSTRUMENT
				: KNOWN_ACTIONS.UNINSTRUMENT;

			await updateFeatureDesiredState(
				service.workload_key,
				service.cluster_id || "default",
				FEATURE,
				desiredStatus,
				"{}",
				dbConfigId
			);

			await Promise.all(
				targets.map((cid) =>
					queueAction(cid, actionType, service.workload_key, "{}", dbConfigId)
				)
			);

			return Response.json({
				status: "queued",
				action: actionType,
				controllers: targets.length,
			});
		} catch (error: any) {
			return Response.json(
				{ error: error.message || "Instrumentation operation failed" },
				{ status: 500 }
			);
		}
	},

	reconcile(
		reportedServices: ReportedService[],
		desiredStates: Map<string, FeatureDesiredState>,
		_envConfig?: EnvironmentFeatureConfig
	): ReconcileAction[] {
		const actions: ReconcileAction[] = [];

		for (const svc of reportedServices) {
			const desired = desiredStates.get(svc.workload_key);
			if (!desired) continue;

			if (
				desired.desired_status === "instrumented" &&
				svc.instrumentation_status !== "instrumented"
			) {
				actions.push({
					actionType: KNOWN_ACTIONS.INSTRUMENT,
					serviceKey: svc.workload_key,
					payload: desired.config || "{}",
				});
			}
			if (
				desired.desired_status === "none" &&
				svc.instrumentation_status === "instrumented"
			) {
				actions.push({
					actionType: KNOWN_ACTIONS.UNINSTRUMENT,
					serviceKey: svc.workload_key,
					payload: "{}",
				});
			}
		}

		return actions;
	},
};

registerFeature(instrumentationHandler);

export default instrumentationHandler;
