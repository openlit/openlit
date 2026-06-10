import type { ControllerHealth, ControllerInstance } from "@/types/controller";

/** Heartbeat recency thresholds — keep in sync with getControllerInstances. */
export const CONTROLLER_HEARTBEAT_ACTIVE_MINUTES = 2;
export const CONTROLLER_HEARTBEAT_DEGRADED_MINUTES = 10;

/**
 * Resolve the health label shown in the UI. Prefer heartbeat-derived
 * `computed_status` (active / degraded / inactive) over the stored
 * self-reported `status` (healthy / degraded / error from poll).
 */
export function resolveControllerHealth(
	instance: Pick<ControllerInstance, "computed_status" | "status">
): ControllerHealth {
	return instance.computed_status || instance.status;
}

export function isControllerStale(
	instance: Pick<ControllerInstance, "computed_status" | "status">
): boolean {
	return resolveControllerHealth(instance) === "inactive";
}
