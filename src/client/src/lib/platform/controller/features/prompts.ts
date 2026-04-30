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

const FEATURE = "prompts";

const promptsHandler: FeatureHandler = {
	feature: FEATURE,

	validatePayload(operation: string, _payload: Record<string, unknown>) {
		if (operation !== "push" && operation !== "remove") {
			return `Unknown operation "${operation}" for feature "${FEATURE}". Expected "push" or "remove".`;
		}
		return null;
	},

	async applyOperation(
		serviceId: string,
		operation: string,
		payload: Record<string, unknown>,
		dbConfigId?: string
	): Promise<Response> {
		try {
			const serviceRes = await getServiceById(serviceId, dbConfigId);
			if (!serviceRes.data || serviceRes.data.length === 0) {
				return Response.json(
					{ error: "Service not found" },
					{ status: 404 }
				);
			}
			const service = serviceRes.data[0];
			if (!service.workload_key) {
				return Response.json(
					{ error: "Service is missing workload_key" },
					{ status: 500 }
				);
			}

			const pushing = operation === "push";
			const config = pushing ? JSON.stringify(payload) : "{}";

			await updateFeatureDesiredState(
				service.workload_key,
				service.cluster_id || "default",
				FEATURE,
				pushing ? "active" : "none",
				config,
				dbConfigId
			);

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

			const actionType = pushing
				? KNOWN_ACTIONS.PUSH_PROMPTS
				: KNOWN_ACTIONS.REMOVE_PROMPTS;

			await Promise.all(
				targets.map((cid) =>
					queueAction(
						cid,
						actionType,
						service.workload_key,
						config,
						dbConfigId
					)
				)
			);

			return Response.json({
				status: "queued",
				action: actionType,
				controllers: targets.length,
			});
		} catch (error: any) {
			return Response.json(
				{ error: error.message || "Prompts operation failed" },
				{ status: 500 }
			);
		}
	},

	reconcile(
		_reportedServices: ReportedService[],
		_desiredStates: Map<string, FeatureDesiredState>,
		_envConfig?: EnvironmentFeatureConfig
	): ReconcileAction[] {
		// Stub: reconciliation logic will be implemented when the
		// controller-side prompt delivery mechanism is built.
		return [];
	},
};

registerFeature(promptsHandler);

export default promptsHandler;
