import type { AuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import OktaProvider from "next-auth/providers/okta";
import { type InstanceEnvKey } from "@/lib/instance-env/catalog";
import { loadInstanceEnvOverrides } from "@/lib/instance-env/store";
import {
	normalizeAzureTenant,
	normalizeClientId,
	normalizeOktaIssuer,
	normalizeSecret,
} from "@/lib/instance-env/values";

export const OAUTH_LINK_PROVIDERS = new Set(["google", "github", "azure-ad", "okta"]);

const MULTI_TENANT_AZURE = new Set(["common", "organizations", "consumers"]);

/**
 * Whether the provider vouches for the email on this sign-in. Only a vouched
 * email may be linked to an existing account; otherwise anyone able to set an
 * email claim (for example an admin of any Microsoft Entra tenant when the app
 * accepts all tenants) could sign in as that account.
 */
export function isEmailVouched(provider: string, profile: unknown, user?: unknown): boolean {
	const record = profile && typeof profile === "object" ? (profile as Record<string, unknown>) : {};
	switch (provider) {
		case "google":
		case "okta":
			return record.email_verified === true || record.email_verified === "true";
		case "github":
			// GitHub only returns the account's own primary email.
			return true;
		case "azure-ad":
			return Boolean(user && typeof user === "object" && (user as { emailTrusted?: unknown }).emailTrusted === true);
		default:
			return false;
	}
}

/** True when the provider explicitly reports the email as unverified. */
export function isEmailExplicitlyUnverified(profile: unknown): boolean {
	const record = profile && typeof profile === "object" ? (profile as Record<string, unknown>) : {};
	return record.email_verified === false || record.email_verified === "false";
}

export function emailFromProfile(profile: unknown): string | null {
	if (!profile || typeof profile !== "object") return null;
	const record = profile as Record<string, unknown>;
	for (const key of ["email", "preferred_username", "upn"]) {
		const value = record[key];
		if (typeof value !== "string") continue;
		const email = value.trim().toLowerCase();
		if (!email.includes("@") || email.includes(" ") || email.length > 320) continue;
		if (/[\u0000-\u001F\u007F]/.test(email)) continue;
		return email;
	}
	return null;
}

export function oauthProfilePatch(provider: string, profile: unknown): { name?: string; image?: string } {
	if (!profile || typeof profile !== "object") return {};
	const record = profile as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
	const name =
		text(record.name) ||
		(provider === "github" ? text(record.login) : "") ||
		text(record.preferred_username);
	const image = provider === "github" ? text(record.avatar_url) : text(record.picture);
	const patch: { name?: string; image?: string } = {};
	if (name) patch.name = name;
	if (image) patch.image = image;
	return patch;
}

function configuredValue(
	overrides: Partial<Record<InstanceEnvKey, string>>,
	key: InstanceEnvKey,
	normalize: (value: string) => string | null
) {
	const override = overrides[key];
	if (typeof override === "string" && override.trim()) return normalize(override);
	const fromEnv = (process.env[key] || "").trim();
	if (!fromEnv) return null;
	return normalize(fromEnv);
}

function azureProfile(profile: Record<string, unknown>, emailTrusted: boolean) {
	const email = emailFromProfile(profile);
	const name = typeof profile.name === "string" ? profile.name : null;
	const id = typeof profile.sub === "string" ? profile.sub : email || "azure-ad";
	return {
		id,
		name,
		email: email || "",
		image: null,
		// Only a single configured directory controls who can hold an email.
		emailTrusted,
	};
}

export async function buildOAuthProviders(
	overrides?: Partial<Record<InstanceEnvKey, string>>
): Promise<AuthOptions["providers"]> {
	let resolved: Partial<Record<InstanceEnvKey, string>> = {};
	if (overrides) {
		resolved = overrides;
	} else {
		try {
			resolved = await loadInstanceEnvOverrides();
		} catch {
			console.error("Instance environment overrides are unavailable");
		}
	}
	const providers: AuthOptions["providers"] = [];
	const googleId = configuredValue(resolved, "GOOGLE_CLIENT_ID", normalizeClientId);
	const googleSecret = configuredValue(resolved, "GOOGLE_CLIENT_SECRET", normalizeSecret);
	if (googleId && googleSecret) {
		providers.push(GoogleProvider({ clientId: googleId, clientSecret: googleSecret }));
	}

	const githubId = configuredValue(resolved, "GITHUB_CLIENT_ID", normalizeClientId);
	const githubSecret = configuredValue(resolved, "GITHUB_CLIENT_SECRET", normalizeSecret);
	if (githubId && githubSecret) {
		providers.push(GithubProvider({ clientId: githubId, clientSecret: githubSecret }));
	}

	const azureId = configuredValue(resolved, "AZURE_AD_CLIENT_ID", normalizeClientId);
	const azureSecret = configuredValue(resolved, "AZURE_AD_CLIENT_SECRET", normalizeSecret);
	const savedTenant = resolved.AZURE_AD_TENANT_ID?.trim();
	const tenantRaw = savedTenant || (process.env.AZURE_AD_TENANT_ID || "").trim();
	const tenant = tenantRaw ? normalizeAzureTenant(tenantRaw) : "common";
	if (azureId && azureSecret && tenant) {
		providers.push(
			AzureADProvider({
				clientId: azureId,
				clientSecret: azureSecret,
				tenantId: tenant,
				profile(profile) {
					return azureProfile(profile as Record<string, unknown>, !MULTI_TENANT_AZURE.has(tenant));
				},
			})
		);
	}

	const oktaId = configuredValue(resolved, "OKTA_CLIENT_ID", normalizeClientId);
	const oktaSecret = configuredValue(resolved, "OKTA_CLIENT_SECRET", normalizeSecret);
	const issuer = configuredValue(resolved, "OKTA_ISSUER", normalizeOktaIssuer);
	if (oktaId && oktaSecret && issuer) {
		providers.push(
			OktaProvider({
				clientId: oktaId,
				clientSecret: oktaSecret,
				issuer,
			})
		);
	}

	return providers;
}
