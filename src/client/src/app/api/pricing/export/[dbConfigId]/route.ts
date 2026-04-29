import { NextRequest, NextResponse } from "next/server";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigById } from "@/lib/db-config";
import { OPENLIT_PROVIDER_MODELS_TABLE_NAME } from "@/lib/platform/providers/table-details";
import asaw from "@/utils/asaw";

/**
 * GET /api/pricing/export/[dbConfigId]
 *
 * Public (no auth required) endpoint that returns all model pricing in the
 * OpenLIT SDK `pricing_json` format. The URL is unique per database config
 * and can be shared / used in SDK init:
 *
 *   openlit.init(pricing_json="http://localhost:3000/api/pricing/export/<dbConfigId>")
 */
export async function GET(
	_request: NextRequest,
	{ params }: { params: { dbConfigId: string } }
) {
	const { dbConfigId } = params;

	if (!dbConfigId) {
		return NextResponse.json(
			{ error: "Database config ID is required" },
			{ status: 400 }
		);
	}

	// Validate the dbConfigId exists
	const [err, dbConfig] = await asaw(getDBConfigById({ id: dbConfigId }));

	if (err || !dbConfig?.id) {
		return NextResponse.json(
			{ error: "Database config not found" },
			{ status: 404 }
		);
	}

	const query = `
		SELECT
			model_id,
			model_type,
			input_price_per_m_token as inputPrice,
			output_price_per_m_token as outputPrice
		FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
		ORDER BY model_type, model_id
	`;

	const { data, err: queryErr } = await dataCollector(
		{ query },
		"query",
		dbConfig.id
	);

	if (queryErr) {
		return NextResponse.json(
			{ error: "Failed to fetch model pricing" },
			{ status: 500 }
		);
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
			pricing[type][model.model_id] = {
				promptPrice: model.inputPrice / 1000,
				completionPrice: model.outputPrice / 1000,
			};
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

	return NextResponse.json(pricing, {
		headers: {
			"Cache-Control": "public, max-age=300",
		},
	});
}
