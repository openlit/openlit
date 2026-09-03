import getMessage from "@/constants/messages";
import {
	getRequestEnvironment,
	OPENLIT_CONTEXT_HEADERS,
} from "@/constants/openlit-context";
import { getDBConfigByIdInternal } from "@/lib/db-config";
import { getAPIKeyInfo, type APIKeyInfo } from "@/lib/platform/api-keys";
import { resolveSignalSource } from "@/lib/telemetry-source";

/** Middleware injects this after a successful Bearer API key verification. */
const MIDDLEWARE_DATABASE_CONFIG_HEADER = "x-database-config-id";

export type SdkIntelligenceResolveVia =
	| "signalRouting"
	| "databaseConfigHeader"
	| "apiKey";

export type SdkIntelligenceResolve = {
	databaseConfigId: string;
	via: SdkIntelligenceResolveVia;
	apiKeyInfo: APIKeyInfo;
};

function firstHeader(request: Request, ...names: string[]) {
	for (const name of names) {
		const value = request.headers?.get?.(name)?.trim();
		if (value) return value;
	}
	return undefined;
}

/**
 * Resolve the ClickHouse that owns Prompt Hub / Vault / Rule Engine state for
 * SDK-facing Bearer requests.
 *
 * Preference order (latest first):
 * 1. Signal routing — `x-openlit-project-id` + `x-openlit-environment` (project
 *    may be inferred from the API key's bound database config)
 * 2. Explicit `x-openlit-database-config-id` (validated against the API key's project)
 * 3. Legacy API key database-config binding (existing SDKs keep working)
 *
 * Middleware-injected `x-database-config-id` alone is treated as the API-key
 * binding, not as an explicit client database-config override.
 */
export async function resolveSdkIntelligenceDatabaseConfig(
	request: Request,
	apiKey: string
): Promise<[string | null, SdkIntelligenceResolve | null]> {
	const messages = getMessage();
	const trimmedKey = apiKey.trim();
	if (!trimmedKey) {
		return [messages.NO_API_KEY, null];
	}

	const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey: trimmedKey });
	if (keyErr || !apiInfo?.databaseConfigId) {
		return [messages.NO_API_KEY, null];
	}

	const keyBoundDatabaseConfigId = apiInfo.databaseConfigId;
	const projectIdHeader = firstHeader(
		request,
		OPENLIT_CONTEXT_HEADERS.projectId
	);
	const environment = getRequestEnvironment(request);
	const clientDatabaseConfigId = firstHeader(
		request,
		OPENLIT_CONTEXT_HEADERS.databaseConfigId
	);

	if (environment) {
		let projectId = projectIdHeader;
		if (!projectId) {
			const keyDatabase = await getDBConfigByIdInternal({
				id: keyBoundDatabaseConfigId,
			});
			projectId = keyDatabase?.projectId || undefined;
		}

		if (projectId) {
			const resolution = await resolveSignalSource("intelligence", {
				projectId,
				environment,
				dbConfigId: keyBoundDatabaseConfigId,
			});
			const { descriptor } = resolution;
			if (
				resolution.hasSource &&
				descriptor.type === "clickhouse" &&
				descriptor.dbConfigId
			) {
				return [
					null,
					{
						databaseConfigId: descriptor.dbConfigId,
						via: "signalRouting",
						apiKeyInfo: apiInfo,
					},
				];
			}

			return [
				"Intelligence ClickHouse is not configured for the selected project environment.",
				null,
			];
		}
	}

	if (clientDatabaseConfigId) {
		if (clientDatabaseConfigId === keyBoundDatabaseConfigId) {
			return [
				null,
				{
					databaseConfigId: clientDatabaseConfigId,
					via: "databaseConfigHeader",
					apiKeyInfo: apiInfo,
				},
			];
		}

		const [keyDatabase, requestedDatabase] = await Promise.all([
			getDBConfigByIdInternal({ id: keyBoundDatabaseConfigId }),
			getDBConfigByIdInternal({ id: clientDatabaseConfigId }),
		]);
		if (
			keyDatabase?.projectId &&
			requestedDatabase?.projectId &&
			keyDatabase.projectId === requestedDatabase.projectId
		) {
			return [
				null,
				{
					databaseConfigId: clientDatabaseConfigId,
					via: "databaseConfigHeader",
					apiKeyInfo: apiInfo,
				},
			];
		}

		return [
			"The selected database configuration is not available for this API key.",
			null,
		];
	}

	// Prefer middleware-injected binding when present; otherwise the key record.
	const middlewareDatabaseConfigId = firstHeader(
		request,
		MIDDLEWARE_DATABASE_CONFIG_HEADER
	);
	return [
		null,
		{
			databaseConfigId:
				middlewareDatabaseConfigId || keyBoundDatabaseConfigId,
			via: "apiKey",
			apiKeyInfo: apiInfo,
		},
	];
}
