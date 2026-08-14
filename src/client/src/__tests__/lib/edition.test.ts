import {
	getOpenLitEdition,
	isCloudEdition,
	isEnterpriseEdition,
} from "@/lib/edition";

describe("OpenLIT edition helpers", () => {
	const originalEdition = process.env.OPENLIT_EDITION;

	afterEach(() => {
		if (originalEdition === undefined) {
			delete process.env.OPENLIT_EDITION;
		} else {
			process.env.OPENLIT_EDITION = originalEdition;
		}
	});

	it.each([
		[undefined, "oss"],
		["oss", "oss"],
		["invalid", "oss"],
		["enterprise", "enterprise"],
		["cloud", "cloud"],
	])("normalizes %s to %s", (input, expected) => {
		if (input === undefined) {
			delete process.env.OPENLIT_EDITION;
		} else {
			process.env.OPENLIT_EDITION = input;
		}

		expect(getOpenLitEdition()).toBe(expected);
		expect(isEnterpriseEdition()).toBe(expected === "enterprise");
		expect(isCloudEdition()).toBe(expected === "cloud");
	});
});
