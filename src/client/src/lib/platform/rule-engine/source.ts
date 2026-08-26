import {
	getRequestEnvironment,
	OPENLIT_CONTEXT_HEADERS,
} from "@/constants/openlit-context";
import { getDBConfigByUser } from "@/lib/db-config";
import { resolveSignalSource } from "@/lib/telemetry-source";

/** Resolve the ClickHouse that owns rule-engine state for this request. */
export async function resolveRuleEngineDatabaseConfigId(
	request: Request
): Promise<string> {
	const requestedId = request.headers.get(
		OPENLIT_CONTEXT_HEADERS.databaseConfigId
	);
	if (requestedId) {
		// Never trust the header by itself. getDBConfigByUser is already scoped to
		// the authenticated user's current project, which prevents cross-project
		// connector IDs from becoming a Rule Engine IDOR.
		const available = await getDBConfigByUser();
		const selected = Array.isArray(available)
			? available.find((database) => database.id === requestedId)
			: undefined;
		if (!selected?.id) {
			throw new Error(
				"The selected ClickHouse datasource is not available in the current project."
			);
		}
		return selected.id;
	}

	const resolution = await resolveSignalSource("intelligence", {
		environment: getRequestEnvironment(request),
	});
	const { descriptor } = resolution;

	if (
		!resolution.hasSource ||
		descriptor.type !== "clickhouse" ||
		!descriptor.dbConfigId
	) {
		throw new Error(
			"Rule Engine requires a ClickHouse datasource for the selected environment."
		);
	}

	return descriptor.dbConfigId;
}
