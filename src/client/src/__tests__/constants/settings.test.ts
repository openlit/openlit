jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		USER_PROFILE: "User Profile",
		API_KEYS: "API Keys",
	})),
}));

import { getSettingsTabs } from "@/constants/settings";

describe("getSettingsTabs", () => {
	it("returns CE settings tabs with expected paths", () => {
		const tabs = getSettingsTabs();

		expect(tabs).toEqual([
			{ value: "profile", label: "User Profile", path: "/settings/profile" },
			{ value: "api-keys", label: "API Keys", path: "/settings/api-keys" },
		]);
	});
});
