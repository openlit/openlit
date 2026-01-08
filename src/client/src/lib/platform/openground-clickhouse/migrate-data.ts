import prisma from "@/lib/prisma";
import { dataCollector } from "@/lib/platform/common";
import getMessage from "@/constants/messages";
import {
	OPENLIT_OPENGROUND_TABLE_NAME,
	OPENLIT_OPENGROUND_PROVIDERS_TABLE_NAME,
} from "@/lib/platform/openground/table-details";

interface PrismaOpenGroundRecord {
	id: string;
	requestMeta: string; // JSON
	responseMeta: string; // JSON
	stats: string; // JSON
	createdAt: Date;
	createdByUserId: string;
	databaseConfigId: string;
}

interface RequestMeta {
	prompt: string;
	selectedProviders: {
		provider: string;
		config: any;
	}[];
}

interface ResponseMeta {
	evaluationData?: {
		cost: number;
		responseTime: number;
		completionTokens: number;
		promptTokens: number;
		totalTokens?: number;
		model: string;
		prompt: string;
		response: string;
		finishReason?: string;
	};
	[key: string]: any;
}

interface Stats {
	prompt: string;
	errors: string[];
	totalProviders: number;
	minCostProvider?: string;
	minCost?: number;
	minResponseTimeProvider?: string;
	minResponseTime?: number;
	minCompletionTokensProvider?: string;
	minCompletionTokens?: number;
}

/**
 * Migrate all existing Prisma OpenGround data to ClickHouse
 * This should be run once after the ClickHouse tables are created
 */
export async function migrateOpengroundDataToClickhouse(
	databaseConfigId: string
) {
	console.log("Starting OpenGround data migration to ClickHouse...");

	try {
		// Fetch all OpenGround records from Prisma
		const prismaRecords: PrismaOpenGroundRecord[] =
			await prisma.openGround.findMany({
				where: {
					databaseConfigId,
				},
				orderBy: {
					createdAt: "asc",
				},
			});

		if (prismaRecords.length === 0) {
			console.log("No OpenGround records to migrate.");
			return { data: "No records to migrate" };
		}

		console.log(`Found ${prismaRecords.length} records to migrate.`);

		let successCount = 0;
		let errorCount = 0;
		const errors: string[] = [];

		// Process each record
		for (const record of prismaRecords) {
			try {
				// Parse JSON strings
				const requestMeta: RequestMeta = JSON.parse(record.requestMeta);
				const responseMeta: [string | null, ResponseMeta | null][] = JSON.parse(
					record.responseMeta
				);
				const stats: Stats = JSON.parse(record.stats);

				// Prepare main record data
				const mainRecord = {
					id: record.id,
					prompt: requestMeta.prompt,
					prompt_source: "custom", // Old records are always custom
					prompt_hub_id: null,
					prompt_hub_version: null,
					prompt_variables: "{}",
					created_by_user_id: record.createdByUserId,
					database_config_id: record.databaseConfigId,
					created_at: record.createdAt.toISOString().replace("T", " ").slice(0, 19),
					total_providers: stats.totalProviders || responseMeta.length,
					min_cost: stats.minCost || 0,
					min_cost_provider: stats.minCostProvider || "",
					min_response_time: stats.minResponseTime || 0,
					min_response_time_provider: stats.minResponseTimeProvider || "",
					min_completion_tokens: stats.minCompletionTokens || 0,
					min_completion_tokens_provider: stats.minCompletionTokensProvider || "",
					errors: stats.errors || [],
				};

				// Insert main record
				const { err: mainErr } = await dataCollector(
					{
						table: OPENLIT_OPENGROUND_TABLE_NAME,
						values: [mainRecord],
					},
					"insert",
					databaseConfigId
				);

				if (mainErr) {
					console.error(`Error migrating record ${record.id}:`, mainErr);
					errorCount++;
					errors.push(`Record ${record.id}: ${mainErr}`);
					continue;
				}

				// Prepare provider results
				const providerValues = requestMeta.selectedProviders
					.map((provider, index) => {
						const [error, response] = responseMeta[index] || [null, null];

						const evaluationData = response?.evaluationData;

						return {
							openground_id: record.id,
							provider: provider.provider,
							model: evaluationData?.model || provider.config?.model || "unknown",
							config: JSON.stringify(provider.config || {}),
							response: evaluationData?.response || "",
							error: error || "",
							cost: evaluationData?.cost || 0,
							prompt_tokens: evaluationData?.promptTokens || 0,
							completion_tokens: evaluationData?.completionTokens || 0,
							total_tokens:
								evaluationData?.totalTokens ||
								(evaluationData?.promptTokens || 0) +
									(evaluationData?.completionTokens || 0),
							response_time: evaluationData?.responseTime || 0,
							finish_reason: evaluationData?.finishReason || "",
							provider_response: JSON.stringify(response || {}),
							created_at: record.createdAt
								.toISOString()
								.replace("T", " ")
								.slice(0, 19),
						};
					})
					.filter((p) => p !== null);

				// Insert provider results
				if (providerValues.length > 0) {
					const { err: providerErr } = await dataCollector(
						{
							table: OPENLIT_OPENGROUND_PROVIDERS_TABLE_NAME,
							values: providerValues,
						},
						"insert",
						databaseConfigId
					);

					if (providerErr) {
						console.error(
							`Error migrating provider results for ${record.id}:`,
							providerErr
						);
						errorCount++;
						errors.push(`Provider results for ${record.id}: ${providerErr}`);
						continue;
					}
				}

				successCount++;
				console.log(
					`✓ Migrated record ${record.id} (${successCount}/${prismaRecords.length})`
				);
			} catch (recordError: any) {
				console.error(`Error processing record ${record.id}:`, recordError);
				errorCount++;
				errors.push(
					`Record ${record.id}: ${recordError.message || String(recordError)}`
				);
			}
		}

		console.log("\nMigration complete!");
		console.log(`Success: ${successCount}/${prismaRecords.length}`);
		console.log(`Errors: ${errorCount}/${prismaRecords.length}`);

		if (errors.length > 0) {
			console.error("\nErrors encountered:");
			errors.forEach((err) => console.error(`  - ${err}`));
		}

		return {
			data: {
				total: prismaRecords.length,
				success: successCount,
				errors: errorCount,
				errorDetails: errors,
			},
		};
	} catch (error: any) {
		console.error("Migration failed:", error);
		return {
			err: getMessage().OPENGROUND_DATA_MIGRATION_FAILED,
			details: error.message || String(error),
		};
	}
}

/**
 * Check if migration is needed (if there are Prisma records but no ClickHouse records)
 */
export async function checkMigrationNeeded(
	databaseConfigId: string,
	userId: string
): Promise<boolean> {
	try {
		// Check Prisma count
		const prismaCount = await prisma.openGround.count({
			where: {
				databaseConfigId,
			},
		});

		if (prismaCount === 0) {
			return false; // No data to migrate
		}

		// Check ClickHouse count
		const { data: clickhouseData } = await dataCollector(
			{
				query: `SELECT COUNT(*) as count FROM ${OPENLIT_OPENGROUND_TABLE_NAME} WHERE database_config_id = '${databaseConfigId}'`,
			},
			"query",
			databaseConfigId
		);

		const clickhouseCount = (clickhouseData as any[])?.[0]?.count || 0;

		// Migration needed if Prisma has records but ClickHouse is empty or has fewer records
		return prismaCount > clickhouseCount;
	} catch (error) {
		console.error("Error checking migration status:", error);
		return false;
	}
}
