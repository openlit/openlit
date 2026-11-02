import { disabledFeature } from "@/features/disabled-feature";

const FEATURE_ID = "enterprise.instance-admin";

export function GET() {
	return disabledFeature(FEATURE_ID).upgradeRequired();
}

export function PATCH() {
	return disabledFeature(FEATURE_ID).upgradeRequired();
}

export function VERIFY() {
	return disabledFeature(FEATURE_ID).upgradeRequired();
}
