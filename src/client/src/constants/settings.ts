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
		{ value: "organisation", label: messages.ORGANISATION_SETTINGS, path: "/organisation" },
		{ value: "pricing", label: messages.PRICING_TITLE, path: "/pricing" },
	];
}
