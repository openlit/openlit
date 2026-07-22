import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByIdInternal } from "@/lib/db-config";
import { OPENLIT_PROVIDER_MODELS_TABLE_NAME } from "@/lib/platform/providers/table-details";
import asaw from "@/utils/asaw";

export type PricingExportResult =
	| { data: Record<string, any> }
	| { error: string; status: number };

// Shared by the public (no-auth) CE route and the auth-gated enterprise
// route so both stay in lockstep with the SDK `pricing_json` format instead
// of drifting apart as two hand-duplicated copies.
export async function getPricingExport(
	dbConfigId: string
): Promise<PricingExportResult> {
	if (!dbConfigId) {
		return { error: "Database config ID is required", status: 400 };
	}

	const [err, dbConfig] = await asaw(getDBConfigByIdInternal({ id: dbConfigId }));

	if (err || !dbConfig?.id) {
		return { error: "Database config not found", status: 404 };
	}

	const query = `
		SELECT
			model_id,
			model_type,
			input_price_per_m_token as inputPrice,
			output_price_per_m_token as outputPrice,
			cache_read_price_per_m_token as cacheReadPrice,
			cache_creation_price_per_m_token as cacheCreationPrice
		FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
		ORDER BY model_type, model_id
	`;

	const { data, err: queryErr } = await dataCollector(
		{ query },
		"query",
		dbConfig.id
	);

	if (queryErr) {
		return { error: "Failed to fetch model pricing", status: 500 };
	}

	const models = (data as any[]) || [];

	// Build SDK-compatible pricing.json format
	const pricing: Record<string, any> = {};

	for (const model of models) {
		const type = model.model_type || "chat";
		if (!pricing[type]) {
			pricing[type] = {};
		}

		if (type === "chat") {
			const entry: Record<string, number> = {
				promptPrice: model.inputPrice / 1000,
				completionPrice: model.outputPrice / 1000,
			};
			if (model.cacheReadPrice > 0) {
				entry.cacheReadPrice = model.cacheReadPrice / 1000;
			}
			if (model.cacheCreationPrice > 0) {
				entry.cacheCreationPrice = model.cacheCreationPrice / 1000;
			}
			pricing[type][model.model_id] = entry;
		} else if (type === "embeddings") {
			pricing[type][model.model_id] = model.inputPrice / 1000;
		} else if (type === "audio") {
			pricing[type][model.model_id] = model.inputPrice / 1000;
		} else if (type === "images") {
			pricing[type][model.model_id] = {
				standard: {
					"1024x1024": model.inputPrice / 1000,
				},
			};
		}
	}

	return { data: pricing };
}
