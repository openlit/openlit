import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/auth";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";
import {
	getCustomModels,
	getCustomModelsGroupedByProvider,
	createCustomModel,
	updateCustomModel,
	deleteCustomModel,
} from "@/lib/platform/openground/custom-models-service";

// Extend the session type to include id
interface SessionWithId {
	user?: {
		id?: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	};
}

/**
 * GET: List all custom models for a provider (or all providers if no provider specified)
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

	const searchParams = request.nextUrl.searchParams;
	const provider = searchParams.get("provider");

	// If no provider specified, return all custom models grouped by provider
	if (!provider) {
		const { data, err } = await getCustomModelsGroupedByProvider(
			session.user.id,
			dbConfig.id
		);

		if (err) {
			return NextResponse.json({ error: err }, { status: 500 });
		}

		return NextResponse.json(data);
	}

	// Get models for specific provider
	const { data, err } = await getCustomModels(
		session.user.id,
		dbConfig.id,
		provider
	);

	if (err) {
		return NextResponse.json({ error: err }, { status: 500 });
	}

	return NextResponse.json(data);
}

/**
 * POST: Create or update a custom model
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
	const { provider, model, id } = body;

	if (!provider || !model?.model_id || !model?.displayName) {
		return NextResponse.json(
			{ error: "Provider, model ID, and display name are required" },
			{ status: 400 }
		);
	}

	// Check if updating existing model
	if (id) {
		const { data, err } = await updateCustomModel(
			session.user.id,
			dbConfig.id,
			id,
			{
				displayName: model.displayName,
				contextWindow: model.contextWindow,
				inputPricePerMToken: model.inputPricePerMToken,
				outputPricePerMToken: model.outputPricePerMToken,
				capabilities: model.capabilities,
			}
		);

		if (err) {
			return NextResponse.json({ error: err }, { status: 500 });
		}

		return NextResponse.json({ success: true, updated: true });
	}

	// Create new model
	const { data, err } = await createCustomModel(
		session.user.id,
		dbConfig.id,
		{
			provider,
			model_id: model.model_id,
			displayName: model.displayName,
			contextWindow: model.contextWindow,
			inputPricePerMToken: model.inputPricePerMToken,
			outputPricePerMToken: model.outputPricePerMToken,
			capabilities: model.capabilities,
		}
	);

	if (err) {
		return NextResponse.json({ error: err }, { status: 500 });
	}

	return NextResponse.json({
		success: true,
		created: true,
		model: data,
	});
}

/**
 * DELETE: Remove a custom model
 */
export async function DELETE(request: NextRequest) {
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

	if (!id) {
		return NextResponse.json(
			{ error: "Model ID parameter is required" },
			{ status: 400 }
		);
	}

	const { data, err } = await deleteCustomModel(
		session.user.id,
		dbConfig.id,
		id
	);

	if (err) {
		return NextResponse.json({ error: err }, { status: 500 });
	}

	return NextResponse.json({ success: true, deleted: true });
}
