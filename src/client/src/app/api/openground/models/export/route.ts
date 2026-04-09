import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/auth";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import Sanitizer from "@/utils/sanitizer";
import { OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME } from "@/lib/platform/openground/table-details";
import asaw from "@/utils/asaw";

interface SessionWithId {
	user?: { id?: string };
}

/**
 * GET /api/openground/models/export
 * Export custom models in pricing.json format compatible with OpenLIT SDK pricing
 */
export async function GET(request: NextRequest) {
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

	const query = `
		SELECT
			model_id,
			model_type,
			input_price_per_m_token as inputPrice,
			output_price_per_m_token as outputPrice
		FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
		WHERE created_by_user_id = '${Sanitizer.sanitizeValue(session.user.id)}'
		  AND database_config_id = '${Sanitizer.sanitizeValue(dbConfig.id)}'
		ORDER BY model_type, model_id
	`;

	const { data, err } = await dataCollector(
		{ query },
		"query",
		dbConfig.id
	);

	if (err) {
		return NextResponse.json({ error: getMessage().OPERATION_FAILED }, { status: 500 });
	}

	const models = (data as any[]) || [];

	// Build pricing.json format grouped by model_type
	const pricing: Record<string, any> = {};

	for (const model of models) {
		const type = model.model_type || "chat";
		if (!pricing[type]) {
			pricing[type] = {};
		}

		if (type === "chat") {
			pricing[type][model.model_id] = {
				promptPrice: model.inputPrice / 1000, // per-M to per-K
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

	// Return as downloadable JSON
	return new NextResponse(JSON.stringify(pricing, null, 4), {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": "attachment; filename=custom-pricing.json",
		},
	});
}
