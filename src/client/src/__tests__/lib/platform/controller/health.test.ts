import {
	isControllerStale,
	resolveControllerHealth,
} from "@/lib/platform/controller/health";

describe("resolveControllerHealth", () => {
	it("prefers computed_status over stored status", () => {
		expect(
			resolveControllerHealth({
				computed_status: "active",
				status: "healthy",
			})
		).toBe("active");
	});

	it("falls back to stored status", () => {
		expect(
			resolveControllerHealth({
				status: "healthy",
			})
		).toBe("healthy");
	});
});

describe("isControllerStale", () => {
	it("returns true only for inactive", () => {
		expect(
			isControllerStale({ computed_status: "inactive", status: "healthy" })
		).toBe(true);
		expect(
			isControllerStale({ computed_status: "degraded", status: "healthy" })
		).toBe(false);
	});
});
