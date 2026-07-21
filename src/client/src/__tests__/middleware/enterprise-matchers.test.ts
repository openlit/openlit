import { ENTERPRISE_MIDDLEWARE_MATCHERS } from "@/middleware/enterprise-matchers";

describe("enterprise middleware matchers CE fallback", () => {
	it("exports an empty matcher list in CE", () => {
		expect(ENTERPRISE_MIDDLEWARE_MATCHERS).toEqual([]);
	});
});
