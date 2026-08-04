jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: jest.fn(),
	selfHostedNetworkOptions: () => ({ allowHttp: true, allowPrivateNetwork: true }),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(),
	redactableSecretValues: () => [],
}));

import { applyHttpAuthCredentials } from "@/lib/platform/connectors/datasource/http/auth-headers";
import { tempoAdapterFactory } from "@/lib/platform/connectors/datasource/grafana/tempo";

describe("applyHttpAuthCredentials", () => {
	it("prefers Basic auth when username is set (Grafana Cloud path)", () => {
		const headers = applyHttpAuthCredentials({
			username: "1676120",
			password: "glc_token",
			token: "should-not-win",
		});
		expect(headers.Authorization).toBe(
			`Basic ${Buffer.from("1676120:glc_token").toString("base64")}`
		);
	});

	it("uses Bearer when only token is set", () => {
		const headers = applyHttpAuthCredentials({ token: "abc" });
		expect(headers.Authorization).toBe("Bearer abc");
	});

	it("follows the explicitly selected authentication type", () => {
		expect(
			applyHttpAuthCredentials(
				{ username: "instance", password: "token" },
				{ authType: "none" }
			)
		).not.toHaveProperty("Authorization");
		expect(
			applyHttpAuthCredentials(
				{ token: "abc" },
				{ authType: "bearer" }
			).Authorization
		).toBe("Bearer abc");
	});

	it("adds X-Scope-OrgID tenant header when requested", () => {
		const headers = applyHttpAuthCredentials(
			{ username: "u", password: "p", tenant: "team-a" },
			{ tenantHeader: "X-Scope-OrgID" }
		);
		expect(headers["X-Scope-OrgID"]).toBe("team-a");
	});

	it("adds AccountID tenant header for VictoriaLogs", () => {
		const headers = applyHttpAuthCredentials(
			{ token: "t", tenant: "1" },
			{ tenantHeader: "AccountID" }
		);
		expect(headers.AccountID).toBe("1");
		expect(headers.Authorization).toBe("Bearer t");
	});
});

describe("descriptor configFields (descriptor-driven forms)", () => {
	it("exposes basic + bearer for Tempo", () => {
		for (const factory of [tempoAdapterFactory]) {
			const d = factory.describe();
			const keys = d.configFields.map((f) => f.key);
			expect(keys).toEqual(
				expect.arrayContaining([
					"url",
					"allowHttp",
					"username",
					"password",
					"token",
				])
			);
			expect(d.configFields.find((f) => f.key === "authType")).toMatchObject({
				kind: "select",
				defaultValue: "basic",
			});
			expect(d.authStyle).toBe("http");
		}
		expect(
			tempoAdapterFactory.describe().configFields.map((f) => f.key)
		).not.toContain("tenant");
	});

	it("uses type-specific endpoint placeholders", () => {
		const urlField = (type: { describe: () => { configFields: { key: string; placeholder?: string }[] } }) =>
			type.describe().configFields.find((f) => f.key === "url")?.placeholder ?? "";
		expect(urlField(tempoAdapterFactory)).toContain("tempo");
	});

});
