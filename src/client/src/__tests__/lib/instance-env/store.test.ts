import { loadInstanceEnvOverrides } from "@/lib/instance-env/store";

describe("open source instance environment store", () => {
	it("does not apply saved overrides", async () => {
		await expect(loadInstanceEnvOverrides()).resolves.toEqual({});
	});
});
