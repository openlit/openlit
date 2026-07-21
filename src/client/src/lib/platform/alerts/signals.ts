import type { ManagementAlertInput } from "@/types/alerts";

export async function emitManagementAlertSignal(_input: ManagementAlertInput) {
	return [];
}

export function emitManagementAlertSignalSafe(_input: ManagementAlertInput) {}
