import { buildOAuthProviders, emailFromProfile, oauthProfilePatch } from "@/lib/auth/oauth-providers";

function providerById(providers: Awaited<ReturnType<typeof buildOAuthProviders>>, id: string) {
	return providers.find((provider) => provider.id === id);
}

describe("oauth providers", () => {
	const keys = [
		"GOOGLE_CLIENT_ID",
		"GOOGLE_CLIENT_SECRET",
		"GITHUB_CLIENT_ID",
		"GITHUB_CLIENT_SECRET",
		"AZURE_AD_CLIENT_ID",
		"AZURE_AD_CLIENT_SECRET",
		"AZURE_AD_TENANT_ID",
		"OKTA_CLIENT_ID",
		"OKTA_CLIENT_SECRET",
		"OKTA_ISSUER",
	];
	const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

	beforeEach(() => {
		for (const key of keys) delete process.env[key];
	});

	afterAll(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("stays empty until a provider has the required values", async () => {
		await expect(buildOAuthProviders({})).resolves.toEqual([]);
		process.env.AZURE_AD_CLIENT_ID = "azure-client";
		await expect(buildOAuthProviders({})).resolves.toEqual([]);
		process.env.OKTA_CLIENT_ID = "okta-client";
		process.env.OKTA_CLIENT_SECRET = "okta-secret";
		await expect(buildOAuthProviders({})).resolves.toEqual([]);
	});

	it("enables microsoft and okta from environment variables", async () => {
		process.env.AZURE_AD_CLIENT_ID = "azure-client";
		process.env.AZURE_AD_CLIENT_SECRET = "azure-secret";
		process.env.OKTA_CLIENT_ID = "okta-client";
		process.env.OKTA_CLIENT_SECRET = "okta-secret";
		process.env.OKTA_ISSUER = "https://acme.okta.com/oauth2/default/";

		const providers = await buildOAuthProviders({});
		expect(providers.map((provider) => provider.id)).toEqual(["azure-ad", "okta"]);
		expect(providerById(providers, "azure-ad")?.options).toMatchObject({
			clientId: "azure-client",
			tenantId: "common",
		});
		expect(providerById(providers, "okta")).toMatchObject({
			wellKnown: "https://acme.okta.com/oauth2/default/.well-known/openid-configuration",
		});
	});

	it("prefers a saved instance value over the deployment environment", async () => {
		process.env.GOOGLE_CLIENT_ID = "env-client";
		process.env.GOOGLE_CLIENT_SECRET = "env-secret";

		const providers = await buildOAuthProviders({
			GOOGLE_CLIENT_ID: "saved-client",
			GOOGLE_CLIENT_SECRET: "saved-secret",
		});
		expect(providerById(providers, "google")?.options).toMatchObject({
			clientId: "saved-client",
			clientSecret: "saved-secret",
		});
	});

	it("does not enable a provider when the saved value is invalid", async () => {
		process.env.OKTA_CLIENT_ID = "okta-client";
		process.env.OKTA_CLIENT_SECRET = "okta-secret";
		process.env.OKTA_ISSUER = "https://acme.okta.com";

		await expect(buildOAuthProviders({ OKTA_ISSUER: "http://localhost" })).resolves.toEqual([]);
	});

	it("reads microsoft and github profile fields", () => {
		expect(emailFromProfile({ preferred_username: "Ada@Example.com" })).toBe("ada@example.com");
		expect(emailFromProfile({ email: "not-an-email" })).toBeNull();
		expect(oauthProfilePatch("github", { login: "ada", avatar_url: "https://example.com/a.png" })).toEqual({
			name: "ada",
			image: "https://example.com/a.png",
		});
		expect(oauthProfilePatch("azure-ad", { name: "Ada Lovelace", picture: "https://example.com/ada.png" })).toEqual({
			name: "Ada Lovelace",
			image: "https://example.com/ada.png",
		});
	});
});
