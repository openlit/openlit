export type FeatureId = string;
export type FeatureTier = "free" | "enterprise" | "cloud";

export type FeatureDefinition = {
	id: FeatureId;
	name: string;
	tier: FeatureTier;
	description: string;
	routePrefixes?: string[];
};

export const EDITION_FEATURES: FeatureDefinition[] = [];

export const FEATURES = Object.freeze(
	Object.fromEntries(EDITION_FEATURES.map((feature) => [feature.id, feature]))
) as Readonly<Record<FeatureId, FeatureDefinition>>;

export function getFeatureDefinition(featureId: FeatureId) {
	return (
		FEATURES[featureId] ?? {
			id: featureId,
			name: featureId,
			tier: "enterprise",
			description: "Paid feature.",
		}
	);
}

export function getPaidFeatures() {
	return EDITION_FEATURES.filter((feature) => feature.tier !== "free");
}
