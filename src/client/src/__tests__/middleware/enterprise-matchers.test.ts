import { ENTERPRISE_MIDDLEWARE_MATCHERS } from "@/middleware/enterprise-matchers";

describe("ENTERPRISE_MIDDLEWARE_MATCHERS", () => {
	it("is an empty CE placeholder array", () => {
		expect(ENTERPRISE_MIDDLEWARE_MATCHERS).toEqual([]);
		expect(Array.isArray(ENTERPRISE_MIDDLEWARE_MATCHERS)).toBe(true);
	});
});
