import { parseInstanceEnvUpdates } from "@/lib/instance-env/validate";
import { normalizeOktaIssuer } from "@/lib/instance-env/values";

describe("instance environment updates", () => {
	it("rejects malformed payloads and unknown keys", () => {
		expect(parseInstanceEnvUpdates(null)).toEqual({ ok: false, error: "malformed" });
		expect(parseInstanceEnvUpdates([])).toEqual({ ok: false, error: "malformed" });
		expect(parseInstanceEnvUpdates({})).toEqual({ ok: false, error: "malformed" });
		expect(parseInstanceEnvUpdates({ updates: { key: "OKTA_ISSUER" } })).toEqual({
			ok: false,
			error: "malformed",
		});
		expect(parseInstanceEnvUpdates({ updates: [{ key: "DATABASE_URL", value: "x" }] })).toEqual({
			ok: false,
			error: "unknown_key",
		});
		expect(parseInstanceEnvUpdates({ updates: [{ value: "x" }] })).toEqual({
			ok: false,
			error: "malformed",
		});
	});

	it("normalizes public issuers and rejects internal ones", () => {
		expect(normalizeOktaIssuer("https://acme.okta.com/oauth2/default/")).toBe(
			"https://acme.okta.com/oauth2/default"
		);
		expect(
			normalizeOktaIssuer("https://acme.okta.com/oauth2/default/.well-known/openid-configuration")
		).toBe("https://acme.okta.com/oauth2/default");
		expect(normalizeOktaIssuer("http://acme.okta.com")).toBeNull();
		expect(normalizeOktaIssuer("https://localhost/oauth2/default")).toBeNull();
		expect(normalizeOktaIssuer("https://169.254.169.254/latest")).toBeNull();
		expect(normalizeOktaIssuer("https://user:pass@acme.okta.com")).toBeNull();
	});

	it("accepts microsoft and okta values and clears blanks without keeping secrets", () => {
		const parsed = parseInstanceEnvUpdates({
			updates: [
				{ key: "AZURE_AD_CLIENT_ID", value: "11111111-1111-1111-1111-111111111111" },
				{ key: "AZURE_AD_CLIENT_SECRET", value: " " },
				{ key: "AZURE_AD_TENANT_ID", value: "COMMON" },
				{ key: "OKTA_CLIENT_ID", value: "okta-client" },
				{ key: "OKTA_CLIENT_SECRET", value: "okta-secret" },
				{ key: "OKTA_ISSUER", value: "https://acme.okta.com/oauth2/default/" },
				{ key: "GOOGLE_CLIENT_SECRET", clear: true },
				{ key: "GITHUB_CLIENT_ID", value: "" },
			],
		});

		expect(parsed).toEqual({
			ok: true,
			changes: [
				{ key: "AZURE_AD_CLIENT_ID", action: "set", value: "11111111-1111-1111-1111-111111111111" },
				{ key: "AZURE_AD_TENANT_ID", action: "set", value: "common" },
				{ key: "OKTA_CLIENT_ID", action: "set", value: "okta-client" },
				{ key: "OKTA_CLIENT_SECRET", action: "set", value: "okta-secret" },
				{ key: "OKTA_ISSUER", action: "set", value: "https://acme.okta.com/oauth2/default" },
				{ key: "GOOGLE_CLIENT_SECRET", action: "clear" },
				{ key: "GITHUB_CLIENT_ID", action: "clear" },
			],
		});
		expect(JSON.stringify(parseInstanceEnvUpdates({ updates: [{ key: "NOT_A_KEY", value: "secret-value" }] }))).not.toContain(
			"secret-value"
		);
	});

	it("rejects unsafe tenant, issuer, and secret values", () => {
		expect(parseInstanceEnvUpdates({ updates: [{ key: "AZURE_AD_TENANT_ID", value: "../etc" }] })).toEqual({
			ok: false,
			error: "invalid_tenant",
		});
		expect(
			parseInstanceEnvUpdates({
				updates: [{ key: "OKTA_ISSUER", value: "https://metadata.google.internal" }],
			})
		).toEqual({ ok: false, error: "invalid_issuer" });
		expect(
			parseInstanceEnvUpdates({
				updates: [{ key: "OKTA_CLIENT_SECRET", value: "line\nbreak" }],
			})
		).toEqual({ ok: false, error: "invalid_value" });
	});
});
