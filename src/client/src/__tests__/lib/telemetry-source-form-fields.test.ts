jest.mock("@/lib/platform/datasource/http/safe-fetch", () => ({
	safeFetch: jest.fn(),
	selfHostedNetworkOptions: () => ({ allowHttp: true, allowPrivateNetwork: true }),
}));
jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(),
	redactableSecretValues: () => [],
}));

import { applyHttpAuthCredentials } from "@/lib/platform/datasource/http/auth-headers";
import { tempoAdapterFactory } from "@/lib/platform/datasource/grafana/tempo";
import { lokiAdapterFactory } from "@/lib/platform/datasource/grafana/loki";
import { mimirAdapterFactory } from "@/lib/platform/datasource/grafana/prometheus";
import { datadogAdapterFactory } from "@/lib/platform/datasource/datadog/adapter";
import { newrelicAdapterFactory } from "@/lib/platform/datasource/newrelic/adapter";
import { victoriaLogsAdapterFactory } from "@/lib/platform/datasource/victoria/logs";
import { victoriaMetricsAdapterFactory } from "@/lib/platform/datasource/victoria/metrics";

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
	it("exposes basic + bearer for Grafana stack member types", () => {
		for (const factory of [
			tempoAdapterFactory,
			lokiAdapterFactory,
			mimirAdapterFactory,
		]) {
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
			expect(d.authStyle).toBe("http");
		}
		expect(lokiAdapterFactory.describe().configFields.map((f) => f.key)).toContain(
			"tenant"
		);
		expect(mimirAdapterFactory.describe().configFields.map((f) => f.key)).toContain(
			"tenant"
		);
		expect(
			tempoAdapterFactory.describe().configFields.map((f) => f.key)
		).not.toContain("tenant");
	});

	it("exposes tenant for Victoria stack member types", () => {
		for (const factory of [
			victoriaLogsAdapterFactory,
			victoriaMetricsAdapterFactory,
		]) {
			const keys = factory.describe().configFields.map((f) => f.key);
			expect(keys).toEqual(
				expect.arrayContaining([
					"url",
					"username",
					"password",
					"token",
					"tenant",
				])
			);
		}
	});

	it("uses type-specific endpoint placeholders", () => {
		const urlField = (type: { describe: () => { configFields: { key: string; placeholder?: string }[] } }) =>
			type.describe().configFields.find((f) => f.key === "url")?.placeholder ?? "";
		expect(urlField(tempoAdapterFactory)).toContain("tempo");
		expect(urlField(lokiAdapterFactory)).toContain("logs");
		expect(urlField(mimirAdapterFactory)).toContain("prometheus");
	});

	it("keeps Datadog / New Relic on vendor-specific keys", () => {
		expect(datadogAdapterFactory.describe().configFields.map((f) => f.key)).toEqual(
			expect.arrayContaining(["site", "apiKey", "appKey"])
		);
		expect(newrelicAdapterFactory.describe().configFields.map((f) => f.key)).toEqual(
			expect.arrayContaining(["region", "accountId", "apiKey"])
		);
		expect(datadogAdapterFactory.describe().authStyle).toBe("api-key");
	});
});
