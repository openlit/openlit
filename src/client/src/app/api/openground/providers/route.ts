import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import Sanitizer from "@/utils/sanitizer";
import asaw from "@/utils/asaw";
import {
	getAllProvidersWithCustomModels,
	getProviderByIdWithCustomModels,
	searchProvidersWithCustomModels,
} from "@/lib/platform/providers/provider-service";
import { dataCollector } from "@/lib/platform/common";
import {
	OPENLIT_PROVIDER_METADATA_TABLE_NAME,
	OPENLIT_PROVIDER_MODELS_TABLE_NAME,
} from "@/lib/platform/providers/table-details";

/**
 * GET /api/openground/providers
 * Get all available LLM providers with custom models merged in
 */
export async function GET(request: NextRequest) {
	const startTimestamp = Date.now();
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: getMessage().UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const providerId = searchParams.get("provider");
		const search = searchParams.get("search");

		// Get database config
		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig?.id) {
			return NextResponse.json(
				{ error: getMessage().DATABASE_CONFIG_NOT_FOUND },
				{ status: 500 }
			);
		}

		// Get specific provider
		if (providerId) {
			const { data: provider, err } = await getProviderByIdWithCustomModels(
				providerId,
				user.id,
				dbConfig.id
			);

			if (err) {
				PostHogServer.fireEvent({
					event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_FAILURE,
					startTimestamp,
				});
				return NextResponse.json({ error: err }, { status: 404 });
			}

			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_SUCCESS,
				startTimestamp,
			});
			return NextResponse.json(provider);
		}

		// Search providers
		if (search) {
			const { data: providers, err } = await searchProvidersWithCustomModels(
				search,
				user.id,
				dbConfig.id
			);

			if (err) {
				PostHogServer.fireEvent({
					event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_FAILURE,
					startTimestamp,
				});
				return NextResponse.json({ error: err }, { status: 500 });
			}

			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_SUCCESS,
				startTimestamp,
			});
			return NextResponse.json(providers);
		}

		// Get all providers
		const { data: providers, err } = await getAllProvidersWithCustomModels(
			user.id,
			dbConfig.id
		);

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_FAILURE,
				startTimestamp,
			});
			return NextResponse.json({ error: err }, { status: 500 });
		}

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json(providers);
	} catch (error: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_PROVIDERS_LIST_FAILURE,
			startTimestamp,
		});
		console.error("Providers GET error:", error);
		return NextResponse.json(
			{ error: getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}
}

/**
 * POST /api/openground/providers
 * Create a new provider
 */
export async function POST(request: NextRequest) {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: getMessage().UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig?.id) {
			return NextResponse.json(
				{ error: getMessage().DATABASE_CONFIG_NOT_FOUND },
				{ status: 500 }
			);
		}

		const body = await request.json();
		const { providerId, displayName, description, requiresVault, configSchema } = body;

		if (!providerId || !displayName) {
			return NextResponse.json(
				{ error: "Provider ID and display name are required" },
				{ status: 400 }
			);
		}

		const { err } = await dataCollector(
			{
				table: OPENLIT_PROVIDER_METADATA_TABLE_NAME,
				values: [
					{
						provider_id: providerId,
						display_name: displayName,
						description: description || "",
						requires_vault: requiresVault ?? true,
						config_schema: JSON.stringify(configSchema || {}),
						is_default: false,
					},
				],
			},
			"insert",
			dbConfig.id
		);

		if (err) {
			return NextResponse.json(
				{ error: err || getMessage().OPERATION_FAILED },
				{ status: 500 }
			);
		}

		return NextResponse.json({ success: true, providerId });
	} catch (error: any) {
		console.error("Providers POST error:", error);
		return NextResponse.json(
			{ error: getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}
}

/**
 * PUT /api/openground/providers
 * Update an existing provider's metadata.
 *
 * Since the table uses ReplacingMergeTree, we INSERT a new row with the same
 * provider_id — the engine deduplicates by primary key, keeping the row with
 * the latest updated_at. This avoids string-interpolated ALTER TABLE UPDATE
 * and the SQL injection surface that comes with it.
 */
export async function PUT(request: NextRequest) {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: getMessage().UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig?.id) {
			return NextResponse.json(
				{ error: getMessage().DATABASE_CONFIG_NOT_FOUND },
				{ status: 500 }
			);
		}

		const body = await request.json();
		const { providerId, displayName, description, requiresVault, configSchema } = body;

		if (!providerId) {
			return NextResponse.json(
				{ error: "Provider ID is required" },
				{ status: 400 }
			);
		}

		// Fetch the existing row so we can merge unchanged fields
		const existingQuery = `
			SELECT provider_id, display_name, description, requires_vault, config_schema, is_default
			FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} FINAL
			WHERE provider_id = '${Sanitizer.sanitizeValue(providerId)}'
			LIMIT 1
		`;
		const { data: existingRows } = await dataCollector(
			{ query: existingQuery },
			"query",
			dbConfig.id
		);

		const existing = (existingRows as any[])?.[0];
		if (!existing) {
			return NextResponse.json(
				{ error: "Provider not found" },
				{ status: 404 }
			);
		}

		// INSERT a new row — ReplacingMergeTree deduplicates by provider_id
		const { err } = await dataCollector(
			{
				table: OPENLIT_PROVIDER_METADATA_TABLE_NAME,
				values: [
					{
						provider_id: providerId,
						display_name: displayName ?? existing.display_name,
						description: description ?? existing.description,
						requires_vault: requiresVault ?? existing.requires_vault,
						config_schema:
							configSchema !== undefined
								? JSON.stringify(configSchema)
								: existing.config_schema,
						is_default: existing.is_default,
					},
				],
			},
			"insert",
			dbConfig.id
		);

		if (err) {
			return NextResponse.json(
				{ error: err || getMessage().OPERATION_FAILED },
				{ status: 500 }
			);
		}

		return NextResponse.json({ success: true, providerId });
	} catch (error: any) {
		console.error("Providers PUT error:", error);
		return NextResponse.json(
			{ error: getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/openground/providers
 * Delete a provider and all its models
 */
export async function DELETE(request: NextRequest) {
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: getMessage().UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig?.id) {
			return NextResponse.json(
				{ error: getMessage().DATABASE_CONFIG_NOT_FOUND },
				{ status: 500 }
			);
		}

		const { searchParams } = new URL(request.url);
		const providerId = searchParams.get("provider");

		if (!providerId) {
			return NextResponse.json(
				{ error: "Provider ID is required" },
				{ status: 400 }
			);
		}

		const sanitizedId = Sanitizer.sanitizeValue(providerId);

		// Delete provider metadata + all its models
		const [metaResult, modelsResult] = await Promise.all([
			dataCollector(
				{
					query: `DELETE FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} WHERE provider_id = '${sanitizedId}'`,
				},
				"exec",
				dbConfig.id
			),
			dataCollector(
				{
					query: `DELETE FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME} WHERE provider = '${sanitizedId}'`,
				},
				"exec",
				dbConfig.id
			),
		]);

		if (metaResult.err || modelsResult.err) {
			return NextResponse.json(
				{ error: metaResult.err || modelsResult.err || getMessage().OPERATION_FAILED },
				{ status: 500 }
			);
		}

		return NextResponse.json({ success: true, deleted: providerId });
	} catch (error: any) {
		console.error("Providers DELETE error:", error);
		return NextResponse.json(
			{ error: getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}
}
