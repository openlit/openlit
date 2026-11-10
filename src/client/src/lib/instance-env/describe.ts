import { INSTANCE_ENV_FIELDS, type InstanceEnvKey } from "./catalog";
import { loadInstanceEnvOverrides } from "@/lib/instance-env/store";

export type InstanceEnvSource = "instance" | "environment" | "unset";

export type InstanceEnvVariable = {
	key: InstanceEnvKey;
	group: (typeof INSTANCE_ENV_FIELDS)[number]["group"];
	secret: boolean;
	source: InstanceEnvSource;
	configured: boolean;
	value: string | null;
};

export async function describeInstanceEnvironment(
	overrides?: Partial<Record<InstanceEnvKey, string>>
): Promise<InstanceEnvVariable[]> {
	const resolved = overrides ?? (await loadInstanceEnvOverrides());
	return INSTANCE_ENV_FIELDS.map((field) => {
		const override = resolved[field.key]?.trim() || "";
		const fromEnv = (process.env[field.key] || "").trim();
		const source: InstanceEnvSource = override ? "instance" : fromEnv ? "environment" : "unset";
		const effective = override || fromEnv;
		return {
			key: field.key,
			group: field.group,
			secret: field.secret,
			source,
			configured: Boolean(effective),
			value: field.secret ? null : effective || null,
		};
	});
}
