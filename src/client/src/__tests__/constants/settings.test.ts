import { getSettingsTabs } from "@/constants/settings";

describe("settings constants", () => {
	it("returns profile and api-keys tabs", () => {
		const tabs = getSettingsTabs();
		expect(tabs.map((tab) => tab.value)).toEqual(["profile", "api-keys"]);
		expect(tabs.every((tab) => tab.path.startsWith("/settings/"))).toBe(true);
		expect(tabs.every((tab) => tab.label.length > 0)).toBe(true);
	});
});
