import getMessage from "@/constants/messages";

export type SettingsTab = {
	value: string;
	label: string;
	path: string;
};

export function getSettingsTabs(): SettingsTab[] {
	const messages = getMessage();

	return [
		{
			value: "organisation",
			label: messages.ORGANISATION,
			path: "/settings/organisation",
		},
		{ value: "profile", label: messages.USER_PROFILE, path: "/settings/profile" },
		{
			value: "database",
			label: messages.DATABASE_CONFIG,
			path: "/settings/database-config",
		},
		{ value: "api-keys", label: messages.API_KEYS, path: "/settings/api-keys" },
	];
}
