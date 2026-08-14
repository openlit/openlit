export const EDITIONS = ["oss", "enterprise", "cloud"] as const;

export type OpenLitEdition = (typeof EDITIONS)[number];

export function getOpenLitEdition(): OpenLitEdition {
	const edition = process.env.OPENLIT_EDITION;

	if (edition === "enterprise" || edition === "cloud") {
		return edition;
	}

	return "oss";
}

export function isEnterpriseEdition() {
	return getOpenLitEdition() === "enterprise";
}

export function isCloudEdition() {
	return getOpenLitEdition() === "cloud";
}
