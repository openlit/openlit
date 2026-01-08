import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { ProviderRegistry } from "@/lib/platform/openground/provider-registry";
import getMessage from "@/constants/messages";

/**
 * GET /api/openground/providers
 * Get all available LLM providers
 */
export async function GET(request: NextRequest) {
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

		// Get specific provider
		if (providerId) {
			const provider = await ProviderRegistry.getProviderById(providerId);
			if (!provider) {
				return NextResponse.json(
					{ error: "Provider not found" },
					{ status: 404 }
				);
			}
			return NextResponse.json(provider);
		}

		// Search providers
		if (search) {
			const providers = await ProviderRegistry.searchProviders(search);
			return NextResponse.json(providers);
		}

		// Get all providers
		const providers = await ProviderRegistry.getAvailableProviders();
		return NextResponse.json(providers);
	} catch (error: any) {
		console.error("Providers GET error:", error);
		return NextResponse.json(
			{ error: getMessage().OPERATION_FAILED },
			{ status: 500 }
		);
	}
}
