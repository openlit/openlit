import { resolveSignalSource } from "@/lib/telemetry-source";

/** Resolve the ClickHouse that owns intelligence-layer tables (rules, evals, chat). */
export async function resolveIntelligenceClickHouseDbConfigId(options?: {
	environment?: string | null;
	projectId?: string | null;
	dbConfigId?: string;
}): Promise<string | null> {
	const resolution = await resolveSignalSource("intelligence", {
		environment: options?.environment ?? undefined,
		...(options?.projectId !== undefined
			? { projectId: options.projectId }
			: {}),
		...(options?.dbConfigId ? { dbConfigId: options.dbConfigId } : {}),
	});
	if (
		resolution.hasSource &&
		resolution.descriptor.type === "clickhouse" &&
		resolution.descriptor.dbConfigId
	) {
		return resolution.descriptor.dbConfigId;
	}
	return null;
}
