import type { AlertSignalInput } from "@/types/alerts";

export async function emitAlertSignal(_input: AlertSignalInput) {
	return [];
}

export function isAlertingEnabled() {
	return false;
}
