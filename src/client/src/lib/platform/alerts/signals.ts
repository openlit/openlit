import { emitAlertSignal } from "@/features/alerts";
import { getDBConfigByUser } from "@/lib/db-config";
import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "@/lib/organisation";
import type { AlertSignalInput, AlertTriggerType } from "@/types/alerts";

type ManagementAlertInput = {
	triggerType: AlertTriggerType;
	event: string;
	message: string;
	sourceId?: string | null;
	fields?: Record<string, string | number | boolean | undefined | null>;
	payloadSummary?: Record<string, unknown>;
	databaseConfigId?: string | null;
};

function cleanFields(fields: ManagementAlertInput["fields"]) {
	return Object.fromEntries(
		Object.entries(fields || {}).filter((entry): entry is [string, string | number | boolean] => {
			const value = entry[1];
			return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
		})
	);
}

export async function emitManagementAlertSignal(input: ManagementAlertInput) {
	const organisation = await getCurrentOrganisation().catch(() => null);
	if (!organisation?.id) return [];

	const project = await getCurrentProjectForOrganisation(organisation.id).catch(() => null);
	const rawDbConfig = await getDBConfigByUser(true).catch(() => null);
	const databaseConfig = rawDbConfig && !Array.isArray(rawDbConfig) ? rawDbConfig : null;
	const fields = {
		event: input.event,
		...cleanFields(input.fields),
	};
	const payloadSummary = {
		message: input.message,
		...input.payloadSummary,
	};

	return emitAlertSignal({
		triggerType: input.triggerType,
		organisationId: organisation.id,
		projectId: project?.id ?? null,
		databaseConfigId: input.databaseConfigId ?? databaseConfig?.id ?? null,
		sourceId: input.sourceId ?? null,
		fields,
		payloadSummary,
	} satisfies AlertSignalInput);
}

export function emitManagementAlertSignalSafe(input: ManagementAlertInput) {
	emitManagementAlertSignal(input).catch(() => undefined);
}
