import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/auth";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import {
	OPENLIT_PROVIDER_MODELS_TABLE_NAME,
	OPENLIT_PROVIDER_METADATA_TABLE_NAME,
} from "@/lib/platform/providers/table-details";
import asaw from "@/utils/asaw";

interface SessionWithId {
	user?: { id?: string };
}

/**
 * POST /api/openground/models/import
 *
 * Bulk-import models from a pricing JSON (same format as the export endpoint
 * or the SDK pricing_json). Skips models that already exist (same provider +
 * model_id combination).
 *
 * Body: {
 *   models: Array<{
 *     provider: string;
 *     model_id: string;
 *     displayName: string;
 *     modelType?: string;
 *     contextWindow?: number;
 *     inputPricePerMToken?: number;
 *     outputPricePerMToken?: number;
 *     capabilities?: string[];
 *   }>
 * }
 *
 * OR the SDK pricing_json format:
 * {
 *   chat: { "model-id": { promptPrice, completionPrice } },
 *   embeddings: { "model-id": price },
 *   ...
 * }
 */
export async function POST(request: NextRequest) {
	const session = (await getServerSession(authOptions)) as SessionWithId;

	if (!session?.user?.id) {
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

	// Normalize input — accept both structured models array and SDK pricing_json format
	let modelsToImport: Array<{
		provider: string;
		model_id: string;
		display_name: string;
		model_type: string;
		context_window: number;
		input_price_per_m_token: number;
		output_price_per_m_token: number;
		capabilities: string[];
		is_default: boolean;
		created_by_user_id: string;
	}> = [];

	if (Array.isArray(body.models)) {
		// Structured format
		modelsToImport = body.models.map((m: any) => ({
			provider: m.provider || "unknown",
			model_id: m.model_id || m.id,
			display_name: m.displayName || m.display_name || m.model_id || m.id,
			model_type: m.modelType || m.model_type || "chat",
			context_window: m.contextWindow || m.context_window || 4096,
			input_price_per_m_token: m.inputPricePerMToken || m.input_price_per_m_token || 0,
			output_price_per_m_token: m.outputPricePerMToken || m.output_price_per_m_token || 0,
			capabilities: m.capabilities || [],
			is_default: false,
			created_by_user_id: session.user!.id!,
		}));
	} else {
		// SDK pricing_json format: { chat: { "model-id": { promptPrice, completionPrice } }, ... }
		for (const [modelType, models] of Object.entries(body)) {
			if (modelType === "models") continue; // skip if mixed format
			if (typeof models !== "object" || models === null) continue;

			for (const [modelId, pricing] of Object.entries(models as Record<string, any>)) {
				let inputPrice = 0;
				let outputPrice = 0;

				if (typeof pricing === "number") {
					// embeddings / audio format
					inputPrice = pricing * 1000; // per-K to per-M
				} else if (typeof pricing === "object" && pricing !== null) {
					if ("promptPrice" in pricing) {
						inputPrice = (pricing.promptPrice || 0) * 1000;
						outputPrice = (pricing.completionPrice || 0) * 1000;
					} else if ("standard" in pricing) {
						// images format
						const firstRes = Object.values(pricing.standard || {})[0];
						inputPrice = ((firstRes as number) || 0) * 1000;
					}
				}

				modelsToImport.push({
					provider: body.provider || "unknown",
					model_id: modelId,
					display_name: modelId,
					model_type: modelType,
					context_window: 4096,
					input_price_per_m_token: inputPrice,
					output_price_per_m_token: outputPrice,
					capabilities: [],
					is_default: false,
					created_by_user_id: session.user!.id!,
				});
			}
		}
	}

	// --- Import providers if present ---
	let providersImported = 0;
	let providersSkipped = 0;

	if (Array.isArray(body.providers) && body.providers.length > 0) {
		const { data: existingProviders } = await dataCollector(
			{
				query: `SELECT provider_id FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} FINAL`,
			},
			"query",
			dbConfig.id
		);

		const existingProviderIds = new Set(
			((existingProviders as any[]) || []).map((r: any) => r.provider_id)
		);

		const providersToInsert = body.providers
			.filter((p: any) => p.providerId && !existingProviderIds.has(p.providerId))
			.map((p: any) => ({
				provider_id: p.providerId,
				display_name: p.displayName || p.providerId,
				description: p.description || "",
				requires_vault: p.requiresVault ?? true,
				config_schema: JSON.stringify(p.configSchema || {}),
				is_default: false,
			}));

		providersSkipped = body.providers.length - providersToInsert.length;

		if (providersToInsert.length > 0) {
			await dataCollector(
				{
					table: OPENLIT_PROVIDER_METADATA_TABLE_NAME,
					values: providersToInsert,
				},
				"insert",
				dbConfig.id
			);
			providersImported = providersToInsert.length;
		}
	}

	// --- Import models ---
	if (modelsToImport.length === 0 && providersImported === 0 && providersSkipped === 0) {
		return NextResponse.json(
			{ error: "No models or providers to import." },
			{ status: 400 }
		);
	}

	let modelsImported = 0;
	let modelsSkipped = 0;

	if (modelsToImport.length > 0) {
		const { data: existingRows } = await dataCollector(
			{
				query: `SELECT provider, model_id FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}`,
			},
			"query",
			dbConfig.id
		);

		const existingKeys = new Set(
			((existingRows as any[]) || []).map(
				(r: any) => `${r.provider}::${r.model_id}`
			)
		);

		const toInsert = modelsToImport.filter(
			(m) => !existingKeys.has(`${m.provider}::${m.model_id}`)
		);

		modelsSkipped = modelsToImport.length - toInsert.length;

		if (toInsert.length > 0) {
			const { err } = await dataCollector(
				{
					table: OPENLIT_PROVIDER_MODELS_TABLE_NAME,
					values: toInsert,
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
			modelsImported = toInsert.length;
		}
	}

	return NextResponse.json({
		success: true,
		imported: modelsImported,
		skipped: modelsSkipped,
		providersImported,
		providersSkipped,
	});
}
