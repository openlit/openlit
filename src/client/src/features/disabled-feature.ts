import { FeatureId, getFeatureDefinition } from "@/features";

export type UpgradeRequiredBody = {
	code: "upgrade_required";
	featureId: FeatureId;
	featureName: string;
	message: string;
};

export function upgradeRequiredBody(featureId: FeatureId): UpgradeRequiredBody {
	const feature = getFeatureDefinition(featureId);
	const planName = feature.tier === "cloud" ? "Cloud" : "Enterprise";

	return {
		code: "upgrade_required",
		featureId,
		featureName: feature.name,
		message: `${feature.name} requires an active ${planName} plan.`,
	};
}

export function upgradeRequiredResponse(featureId: FeatureId) {
	return Response.json(upgradeRequiredBody(featureId), {
		status: 403,
	});
}

export function disabledFeature(featureId: FeatureId) {
	return {
		featureId,
		isEnabled: false,
		upgradeRequired: () => upgradeRequiredResponse(featureId),
	};
}
