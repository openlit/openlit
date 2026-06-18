import getMessage from "@/constants/messages";

export type SettingsTab = {
	value: string;
	label: string;
	path: string;
};

export function getSettingsTabs(): SettingsTab[] {
	const messages = getMessage();

	return [
		{ value: "profile", label: messages.USER_PROFILE, path: "/settings/profile" },
		{ value: "api-keys", label: messages.API_KEYS, path: "/settings/api-keys" },
	];
}
