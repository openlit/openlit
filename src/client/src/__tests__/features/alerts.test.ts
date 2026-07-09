import { emitAlertSignal, isAlertingEnabled } from "@/features/alerts";

describe("CE alerting feature fallback", () => {
	it("reports alerting as disabled in this edition", () => {
		expect(isAlertingEnabled()).toBe(false);
	});

	it("emitAlertSignal is a safe no-op that resolves to an empty array", async () => {
		await expect(
			emitAlertSignal({
				triggerType: "access_update",
				fields: { event: "test" },
			})
		).resolves.toEqual([]);
	});
});
