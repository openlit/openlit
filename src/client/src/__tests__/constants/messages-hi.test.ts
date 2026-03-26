import * as hi from "@/constants/messages/hi";
import * as en from "@/constants/messages/en";

describe("Hindi messages (hi.ts)", () => {
	const hiExports = Object.keys(hi);
	const enExports = Object.keys(en);

	it("exports at least one message", () => {
		expect(hiExports.length).toBeGreaterThan(0);
	});

	it("all exported values are strings or arrays", () => {
		for (const key of hiExports) {
			const val = (hi as any)[key];
			expect(typeof val === "string" || Array.isArray(val)).toBe(true);
		}
	});

	it("no empty string values", () => {
		for (const key of hiExports) {
			const val = (hi as any)[key];
			if (typeof val === "string") {
				expect(val.length).toBeGreaterThan(0);
			}
		}
	});

	it("covers core message keys from en.ts", () => {
		const coreKeys = [
			"DATABASE_CONFIG_NOT_FOUND",
			"UNAUTHORIZED_USER",
			"MALFORMED_INPUTS",
			"OPERATION_FAILED",
			"NO_API_KEY",
		];
		for (const key of coreKeys) {
			expect(hiExports).toContain(key);
		}
	});
});
