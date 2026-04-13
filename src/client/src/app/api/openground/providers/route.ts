import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { getDBConfigByUser } from "@/lib/db-config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import {
	getAllProvidersWithCustomModels,
	getProviderByIdWithCustomModels,
	searchProvidersWithCustomModels,
} from "@/lib/platform/providers/provider-service";

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
