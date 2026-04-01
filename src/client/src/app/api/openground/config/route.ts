import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { getDBConfigByUser } from "@/lib/db-config";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import {
	getOpenGroundConfigs,
	upsertOpenGroundConfig,
	deleteOpenGroundConfig,
	toggleOpenGroundConfigStatus,
} from "@/lib/platform/openground/config";
import * as messages from "@/constants/messages/en";

/**
 * GET /api/openground/config
 * Get all provider configurations for the current user
 */
export async function GET(request: NextRequest) {
	const startTimestamp = Date.now();
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: messages.UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig) {
			return NextResponse.json(
				{ error: messages.DATABASE_CONFIG_NOT_FOUND },
				{ status: 404 }
			);
		}

		const { data, err } = await getOpenGroundConfigs(user.id, dbConfig.id);

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_CONFIG_GET_FAILURE,
				startTimestamp,
			});
			return NextResponse.json({ error: err }, { status: 500 });
		}

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_GET_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json(data);
	} catch (error: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_GET_FAILURE,
			startTimestamp,
		});
		console.error("Config GET error:", error);
		return NextResponse.json(
			{ error: messages.OPERATION_FAILED },
			{ status: 500 }
		);
	}
}

/**
 * POST /api/openground/config
 * Create or update a provider configuration
 */
export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: messages.UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig) {
			return NextResponse.json(
				{ error: messages.DATABASE_CONFIG_NOT_FOUND },
				{ status: 404 }
			);
		}

		const body = await request.json();
		const { provider, vaultId, modelId, isActive } = body;

		if (!provider || !vaultId) {
			return NextResponse.json(
				{ error: "Provider and vaultId are required" },
				{ status: 400 }
			);
		}

		const { data, err } = await upsertOpenGroundConfig({
			provider,
			vaultId,
			modelId,
			userId: user.id,
			databaseConfigId: dbConfig.id,
			isActive,
		});

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_CONFIG_CREATE_FAILURE,
				startTimestamp,
			});
			return NextResponse.json({ error: err }, { status: 500 });
		}

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_CREATE_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json(data);
	} catch (error: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_CREATE_FAILURE,
			startTimestamp,
		});
		console.error("Config POST error:", error);
		return NextResponse.json(
			{ error: messages.OPERATION_FAILED },
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/openground/config
 * Delete a provider configuration
 */
export async function DELETE(request: NextRequest) {
	const startTimestamp = Date.now();
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: messages.UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig) {
			return NextResponse.json(
				{ error: messages.DATABASE_CONFIG_NOT_FOUND },
				{ status: 404 }
			);
		}

		const { searchParams } = new URL(request.url);
		const configId = searchParams.get("id");

		if (!configId) {
			return NextResponse.json(
				{ error: "Config ID is required" },
				{ status: 400 }
			);
		}

		const { data, err } = await deleteOpenGroundConfig(configId, user.id, dbConfig.id);

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_CONFIG_DELETE_FAILURE,
				startTimestamp,
			});
			return NextResponse.json({ error: err }, { status: 500 });
		}

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_DELETE_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json({ message: data });
	} catch (error: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_DELETE_FAILURE,
			startTimestamp,
		});
		console.error("Config DELETE error:", error);
		return NextResponse.json(
			{ error: messages.OPERATION_FAILED },
			{ status: 500 }
		);
	}
}

/**
 * PATCH /api/openground/config
 * Toggle active status of a configuration
 */
export async function PATCH(request: NextRequest) {
	const startTimestamp = Date.now();
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json(
				{ error: messages.UNAUTHORIZED_USER },
				{ status: 401 }
			);
		}

		const [, dbConfig] = await asaw(getDBConfigByUser(true));
		if (!dbConfig) {
			return NextResponse.json(
				{ error: messages.DATABASE_CONFIG_NOT_FOUND },
				{ status: 404 }
			);
		}

		const body = await request.json();
		const { configId, isActive } = body;

		if (!configId || typeof isActive !== "boolean") {
			return NextResponse.json(
				{ error: "Config ID and isActive status are required" },
				{ status: 400 }
			);
		}

		const { data, err } = await toggleOpenGroundConfigStatus(
			configId,
			user.id,
			dbConfig.id,
			isActive
		);

		if (err) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.OPENGROUND_CONFIG_UPDATE_FAILURE,
				startTimestamp,
			});
			return NextResponse.json({ error: err }, { status: 500 });
		}

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_UPDATE_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json(data);
	} catch (error: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_CONFIG_UPDATE_FAILURE,
			startTimestamp,
		});
		console.error("Config PATCH error:", error);
		return NextResponse.json(
			{ error: messages.OPERATION_FAILED },
			{ status: 500 }
		);
	}
}
