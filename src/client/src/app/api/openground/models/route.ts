import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { SERVER_EVENTS } from "@/constants/events";
import { authOptions } from "@/app/auth";
import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import Sanitizer from "@/utils/sanitizer";
import { OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME } from "@/lib/platform/openground/table-details";
import asaw from "@/utils/asaw";

// Extend the session type to include id
interface SessionWithId {
	user?: {
		id?: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	};
}

// GET: List all custom models for a provider (or all providers if no provider specified)
export async function GET(request: NextRequest) {
	const startTimestamp = Date.now();
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

	const searchParams = request.nextUrl.searchParams;
	const provider = searchParams.get("provider");

	// If no provider specified, return all custom models grouped by provider
	if (!provider) {
		const query = `
			SELECT
				toString(id) as customId,
				model_id,
				model_id as id,
				provider,
				display_name as displayName,
				model_type as modelType,
				context_window as contextWindow,
				input_price_per_m_token as inputPricePerMToken,
				output_price_per_m_token as outputPricePerMToken,
				capabilities
			FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
			WHERE created_by_user_id = '${Sanitizer.sanitizeValue(session.user.id)}'
			  AND database_config_id = '${Sanitizer.sanitizeValue(dbConfig.id)}'
			ORDER BY provider, created_at DESC
		`;

		const { data, err } = await dataCollector(
			{ query },
			"query",
			dbConfig.id
		);

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_MODELS_LIST_FAILURE,
				startTimestamp,
			});
			return NextResponse.json(
				{ error: getMessage().OPERATION_FAILED },
				{ status: 500 }
			);
		}

		// Group models by provider
		const grouped: Record<string, any[]> = {};

		(data as any[] || []).forEach((model: any) => {
			if (!grouped[model.provider]) {
				grouped[model.provider] = [];
			}
			grouped[model.provider].push(model);
		});

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_MODELS_LIST_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json(grouped);
	}

	// Get models for specific provider
	const query = `
		SELECT
			toString(id) as customId,
			provider,
			model_id as id,
			display_name as displayName,
			context_window as contextWindow,
			input_price_per_m_token as inputPricePerMToken,
			output_price_per_m_token as outputPricePerMToken,
			capabilities
		FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
		WHERE created_by_user_id = '${Sanitizer.sanitizeValue(session.user.id)}'
		  AND database_config_id = '${Sanitizer.sanitizeValue(dbConfig.id)}'
		  AND provider = '${Sanitizer.sanitizeValue(provider)}'
		ORDER BY created_at DESC
	`;

	const { data, err } = await dataCollector(
		{ query },
		"query",
		dbConfig.id
	);

	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_MODELS_LIST_FAILURE,
			startTimestamp,
		});
		return NextResponse.json(
			{ error: getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.OPENGROUND_MODELS_LIST_SUCCESS,
		startTimestamp,
	});
	return NextResponse.json(data || []);
}

// POST: Create or update a custom model
export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
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
	const { provider, model, customId } = body;

	console.log("POST /api/openground/models - Body:", JSON.stringify(body, null, 2));
	console.log("CustomId type:", typeof customId, "value:", customId);

	// Support both model.id and model.model_id for compatibility
	const modelId = model?.id || model?.model_id;
	if (!provider || !modelId || !model?.displayName) {
		console.error("Validation failed - provider:", provider, "model.id:", modelId, "model.displayName:", model?.displayName);
		return NextResponse.json(
			{ error: "Provider, model ID, and display name are required" },
			{ status: 400 }
		);
	}

	// Check if updating existing model
	if (customId) {
		// Use ALTER TABLE UPDATE for ClickHouse
		const capabilitiesArray = (model.capabilities || [])
			.map((c: string) => `'${Sanitizer.sanitizeValue(c)}'`)
			.join(", ");

		const updateQuery = `
			ALTER TABLE ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
			UPDATE
				display_name = '${Sanitizer.sanitizeValue(model.displayName)}',
				model_type = '${Sanitizer.sanitizeValue(model.modelType || "chat")}',
				context_window = ${model.contextWindow || 4096},
				input_price_per_m_token = ${model.inputPricePerMToken || 0},
				output_price_per_m_token = ${model.outputPricePerMToken || 0},
				capabilities = [${capabilitiesArray}],
				updated_at = now()
			WHERE model_id = '${Sanitizer.sanitizeValue(modelId)}'
			  AND provider = '${Sanitizer.sanitizeValue(provider)}'
			  AND created_by_user_id = '${Sanitizer.sanitizeValue(session.user.id)}'
			  AND database_config_id = '${Sanitizer.sanitizeValue(dbConfig.id)}'
		`;

		console.log("Update query:", updateQuery);

		const { err } = await dataCollector(
			{ query: updateQuery },
			"exec",
			dbConfig.id
		);

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_MODELS_CREATE_FAILURE,
				startTimestamp,
			});
			console.error("Error updating model:", err);
			return NextResponse.json(
				{ error: err || getMessage().OPERATION_FAILED },
				{ status: 500 }
			);
		}

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_MODELS_CREATE_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json({ success: true, updated: true });
	}

	// Insert new model - Use dataCollector's insert type to let ClickHouse handle UUID generation
	const { err } = await dataCollector(
		{
			table: OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME,
			values: [
				{
					provider: provider,
					model_id: modelId,
					display_name: model.displayName,
					model_type: model.modelType || "chat",
					context_window: model.contextWindow || 4096,
					input_price_per_m_token: model.inputPricePerMToken || 0,
					output_price_per_m_token: model.outputPricePerMToken || 0,
					capabilities: model.capabilities || [],
					created_by_user_id: session.user.id,
					database_config_id: dbConfig.id,
				},
			],
		},
		"insert",
		dbConfig.id
	);

	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_MODELS_CREATE_FAILURE,
			startTimestamp,
		});
		console.error("Error inserting custom model:", err);
		return NextResponse.json(
			{ error: err || getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}

	// Fetch the newly created model to return it
	const selectQuery = `
		SELECT
			toString(id) as customId,
			provider,
			model_id as id,
			display_name as displayName,
			context_window as contextWindow,
			input_price_per_m_token as inputPricePerMToken,
			output_price_per_m_token as outputPricePerMToken,
			capabilities
		FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
		WHERE created_by_user_id = '${Sanitizer.sanitizeValue(session.user.id)}'
		  AND database_config_id = '${Sanitizer.sanitizeValue(dbConfig.id)}'
		  AND provider = '${Sanitizer.sanitizeValue(provider)}'
		  AND model_id = '${Sanitizer.sanitizeValue(modelId)}'
		ORDER BY created_at DESC
		LIMIT 1
	`;

	const { data: newModel } = await dataCollector(
		{ query: selectQuery },
		"query",
		dbConfig.id
	);

	console.log("Newly created model:", JSON.stringify(newModel, null, 2));

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.OPENGROUND_MODELS_CREATE_SUCCESS,
		startTimestamp,
	});
	return NextResponse.json({
		success: true,
		created: true,
		model: (newModel as any[])?.[0]
	});
}

// DELETE: Remove a custom model
export async function DELETE(request: NextRequest) {
	const startTimestamp = Date.now();
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

	const searchParams = request.nextUrl.searchParams;
	const id = searchParams.get("id");
	const modelId = searchParams.get("model_id");
	const provider = searchParams.get("provider");

	if (!id && !modelId) {
		return NextResponse.json(
			{ error: "Model ID or model_id parameter is required" },
			{ status: 400 }
		);
	}

	// Build WHERE clause — prefer model_id+provider match, fall back to UUID id
	const whereConditions = [
		`created_by_user_id = '${Sanitizer.sanitizeValue(session.user.id)}'`,
		`database_config_id = '${Sanitizer.sanitizeValue(dbConfig.id)}'`,
	];

	if (modelId && provider) {
		whereConditions.push(`model_id = '${Sanitizer.sanitizeValue(modelId)}'`);
		whereConditions.push(`provider = '${Sanitizer.sanitizeValue(provider)}'`);
	} else if (id) {
		whereConditions.push(`(toString(id) = '${Sanitizer.sanitizeValue(id)}' OR model_id = '${Sanitizer.sanitizeValue(id)}')`);
	}

	const deleteQuery = `
		DELETE FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
		WHERE ${whereConditions.join(" AND ")}
	`;

	console.log("Delete query:", deleteQuery);

	const { err } = await dataCollector(
		{ query: deleteQuery },
		"exec",
		dbConfig.id
	);

	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_MODELS_DELETE_FAILURE,
			startTimestamp,
		});
		console.error("Delete error:", err);
		return NextResponse.json(
			{ error: err || getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.OPENGROUND_MODELS_DELETE_SUCCESS,
		startTimestamp,
	});
	return NextResponse.json({ success: true, deleted: true });
}
