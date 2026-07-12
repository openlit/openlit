import {
	createAlertDestinationTool,
	createAlertTool,
	deleteAlertDestinationTool,
	deleteAlertTool,
	getAlertDestinationTool,
	getAlertTool,
	listAlertDestinationsTool,
	listAlertsTool,
	testAlertDestinationTool,
	testAlertTool,
	updateAlertDestinationTool,
	updateAlertTool,
} from "@/features/alert-tools";

const UNAVAILABLE_ERROR = "Alerting is not available in this edition.";

describe("CE alert Otter tool fallbacks", () => {
	it("createAlertTool returns an unavailable error and does not throw", async () => {
		await expect(createAlertTool({ name: "Alert" })).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("updateAlertTool returns an unavailable error", async () => {
		await expect(updateAlertTool("alert-1", { name: "Alert" })).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("deleteAlertTool returns an unavailable error", async () => {
		await expect(deleteAlertTool("alert-1")).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("listAlertsTool returns an empty list instead of failing", async () => {
		await expect(listAlertsTool()).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("getAlertTool returns an unavailable error", async () => {
		await expect(getAlertTool("alert-1")).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("testAlertTool returns an unavailable error", async () => {
		await expect(testAlertTool("alert-1")).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("createAlertDestinationTool returns an unavailable error", async () => {
		await expect(
			createAlertDestinationTool({ name: "Dest", providerType: "slack", config: {} })
		).resolves.toEqual({ success: false, error: UNAVAILABLE_ERROR });
	});

	it("updateAlertDestinationTool returns an unavailable error", async () => {
		await expect(updateAlertDestinationTool("dest-1", { name: "Dest" })).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("deleteAlertDestinationTool returns an unavailable error", async () => {
		await expect(deleteAlertDestinationTool("dest-1")).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("listAlertDestinationsTool returns an empty list instead of failing", async () => {
		await expect(listAlertDestinationsTool()).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("getAlertDestinationTool returns an unavailable error", async () => {
		await expect(getAlertDestinationTool("dest-1")).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});

	it("testAlertDestinationTool returns an unavailable error", async () => {
		await expect(testAlertDestinationTool("dest-1")).resolves.toEqual({
			success: false,
			error: UNAVAILABLE_ERROR,
		});
	});
});
