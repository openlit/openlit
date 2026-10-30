import type { InstanceEnvKey } from "./catalog";

// Open source reads deployment environment variables only. Enterprise replaces
// this module and applies saved instance overrides before the environment.
export async function loadInstanceEnvOverrides(): Promise<Partial<Record<InstanceEnvKey, string>>> {
	return {};
}
