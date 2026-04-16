import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/auth";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import { OPENLIT_PROVIDER_MODELS_TABLE_NAME } from "@/lib/platform/providers/table-details";
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

	if (modelsToImport.length === 0) {
		return NextResponse.json(
			{ error: "No models to import. Provide a 'models' array or SDK pricing_json format." },
			{ status: 400 }
		);
	}

	// Fetch existing models to skip duplicates
	const existingQuery = `
		SELECT provider, model_id
		FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
	`;
	const { data: existingRows } = await dataCollector(
		{ query: existingQuery },
		"query",
		dbConfig.id
	);

	const existingKeys = new Set(
		((existingRows as any[]) || []).map((r: any) => `${r.provider}::${r.model_id}`)
	);

	const toInsert = modelsToImport.filter(
		(m) => !existingKeys.has(`${m.provider}::${m.model_id}`)
	);

	const skipped = modelsToImport.length - toInsert.length;

	if (toInsert.length === 0) {
		return NextResponse.json({
			success: true,
			imported: 0,
			skipped,
			message: "All models already exist",
		});
	}

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

	return NextResponse.json({
		success: true,
		imported: toInsert.length,
		skipped,
	});
}
