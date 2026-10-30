import { disabledFeature } from "@/features/disabled-feature";

const FEATURE_ID = "enterprise.organisation-overview";

export function POST() {
	return disabledFeature(FEATURE_ID).upgradeRequired();
}
