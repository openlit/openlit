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
import { OPENLIT_PROVIDER_METADATA_TABLE_NAME } from "@/lib/platform/providers/table-details";

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
 * Update an existing provider's metadata
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

		const updateFields: string[] = [];
		if (displayName !== undefined) {
			updateFields.push(`display_name = '${Sanitizer.sanitizeValue(displayName)}'`);
		}
		if (description !== undefined) {
			updateFields.push(`description = '${Sanitizer.sanitizeValue(description)}'`);
		}
		if (requiresVault !== undefined) {
			updateFields.push(`requires_vault = ${!!requiresVault}`);
		}
		if (configSchema !== undefined) {
			updateFields.push(`config_schema = '${Sanitizer.sanitizeValue(JSON.stringify(configSchema))}'`);
		}
		updateFields.push(`updated_at = now()`);

		const query = `
			ALTER TABLE ${OPENLIT_PROVIDER_METADATA_TABLE_NAME}
			UPDATE ${updateFields.join(", ")}
			WHERE provider_id = '${Sanitizer.sanitizeValue(providerId)}'
		`;

		const { err } = await dataCollector({ query }, "exec", dbConfig.id);

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
					query: `DELETE FROM openlit_provider_models WHERE provider = '${sanitizedId}'`,
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
