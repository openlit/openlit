jest.mock("@/lib/organisation", () => ({
	createOrganisationProject: jest.fn(),
}));

import { createOrganisationProject } from "@/lib/organisation-projects";

describe("organisation-projects re-export", () => {
	it("re-exports createOrganisationProject from organisation", () => {
		expect(typeof createOrganisationProject).toBe("function");
	});
});
