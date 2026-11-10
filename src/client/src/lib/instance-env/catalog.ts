export const INSTANCE_ENV_GROUPS = ["google", "github", "microsoft", "okta"] as const;

export type InstanceEnvGroup = (typeof INSTANCE_ENV_GROUPS)[number];

export type InstanceEnvField = {
	key: string;
	group: InstanceEnvGroup;
	secret: boolean;
};

export const INSTANCE_ENV_FIELDS = [
	{ key: "GOOGLE_CLIENT_ID", group: "google", secret: false },
	{ key: "GOOGLE_CLIENT_SECRET", group: "google", secret: true },
	{ key: "GITHUB_CLIENT_ID", group: "github", secret: false },
	{ key: "GITHUB_CLIENT_SECRET", group: "github", secret: true },
	{ key: "AZURE_AD_CLIENT_ID", group: "microsoft", secret: false },
	{ key: "AZURE_AD_CLIENT_SECRET", group: "microsoft", secret: true },
	{ key: "AZURE_AD_TENANT_ID", group: "microsoft", secret: false },
	{ key: "OKTA_CLIENT_ID", group: "okta", secret: false },
	{ key: "OKTA_CLIENT_SECRET", group: "okta", secret: true },
	{ key: "OKTA_ISSUER", group: "okta", secret: false },
] as const satisfies readonly InstanceEnvField[];

export type InstanceEnvKey = (typeof INSTANCE_ENV_FIELDS)[number]["key"];

const FIELD_BY_KEY = new Map<string, (typeof INSTANCE_ENV_FIELDS)[number]>(
	INSTANCE_ENV_FIELDS.map((field) => [field.key, field])
);

export function getInstanceEnvField(key: string) {
	return FIELD_BY_KEY.get(key);
}

export function isInstanceEnvKey(key: string): key is InstanceEnvKey {
	return FIELD_BY_KEY.has(key);
}
