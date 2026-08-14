import { ProviderRegistry } from "./provider-registry";
import { ProviderMetadata } from "@/types/openground";

/**
 * Service layer for providers + their models.
 *
 * After the independent-provider-models refactor, all models live in the
 * openlit_provider_models ClickHouse table. The ProviderRegistry is responsible
 * for loading and merging them with static provider metadata. This file exists
 * as a thin wrapper to keep the previous API shape used by the API routes.
 */

export async function getAllProvidersWithCustomModels(
	_userId: string,
	databaseConfigId: string
): Promise<{ data?: ProviderMetadata[]; err?: string }> {
	try {
		const providers = await ProviderRegistry.getAvailableProviders(databaseConfigId);
		return { data: providers };
	} catch (error) {
		console.error("Error getting providers with models:", error);
		return { err: "Failed to load providers" };
	}
}

export async function getProviderByIdWithCustomModels(
	providerId: string,
	_userId: string,
	databaseConfigId: string
): Promise<{ data?: ProviderMetadata; err?: string }> {
	try {
		const provider = await ProviderRegistry.getProviderById(providerId, databaseConfigId);
		if (!provider) {
			return { err: "Provider not found" };
		}
		return { data: provider };
	} catch (error) {
		console.error("Error getting provider by ID:", error);
		return { err: "Failed to load provider" };
	}
}

export async function searchProvidersWithCustomModels(
	query: string,
	_userId: string,
	databaseConfigId: string
): Promise<{ data?: ProviderMetadata[]; err?: string }> {
	try {
		const providers = await ProviderRegistry.searchProviders(query, databaseConfigId);
		return { data: providers };
	} catch (error) {
		console.error("Error searching providers:", error);
		return { err: "Failed to search providers" };
	}
}
