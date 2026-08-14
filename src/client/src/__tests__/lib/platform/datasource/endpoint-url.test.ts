import {
	canonicalizeFetchUrl,
	isEnabledSetting,
	normalizeDatasourceEndpointUrl,
	rewriteLoopbackEndpointForDocker,
} from "@/lib/platform/connectors/datasource/http/endpoint-url";
import { selfHostedNetworkOptions } from "@/lib/platform/connectors/datasource/http/safe-fetch";

describe("canonicalizeFetchUrl", () => {
	it("repairs collapsed authority slashes without stripping the path", () => {
		expect(canonicalizeFetchUrl("https:/api.example.com/v1/memories/abc/")).toBe(
			"https://api.example.com/v1/memories/abc/"
		);
	});
});

describe("normalizeDatasourceEndpointUrl", () => {
	it("repairs collapsed http:/ authority slashes", () => {
		expect(normalizeDatasourceEndpointUrl("http:/localhost:9090")).toBe(
			"http://localhost:9090"
		);
		expect(normalizeDatasourceEndpointUrl("https:/prom.example.com/path/")).toBe(
			"https://prom.example.com/path"
		);
	});

	it("preserves valid URLs and strips trailing slashes", () => {
		expect(normalizeDatasourceEndpointUrl("http://localhost:9090/")).toBe(
			"http://localhost:9090"
		);
	});
});

describe("rewriteLoopbackEndpointForDocker", () => {
	it("rewrites localhost and 127.0.0.1 when enabled", () => {
		expect(
			rewriteLoopbackEndpointForDocker("http://localhost:3100", { enabled: true })
		).toBe("http://host.docker.internal:3100");
		expect(
			rewriteLoopbackEndpointForDocker("http://127.0.0.1:3100/loki", {
				enabled: true,
			})
		).toBe("http://host.docker.internal:3100/loki");
		expect(
			rewriteLoopbackEndpointForDocker(
				"http://localhost:8000/v1/memories/abc/",
				{ enabled: true }
			)
		).toBe("http://host.docker.internal:8000/v1/memories/abc/");
	});

	it("leaves non-loopback hosts unchanged", () => {
		expect(
			rewriteLoopbackEndpointForDocker("http://loki:3100", { enabled: true })
		).toBe("http://loki:3100");
	});

	it("is a no-op when disabled", () => {
		expect(
			rewriteLoopbackEndpointForDocker("http://localhost:3100", { enabled: false })
		).toBe("http://localhost:3100");
	});
});

describe("isEnabledSetting / selfHostedNetworkOptions", () => {
	it("treats common truthy switch encodings as enabled", () => {
		expect(isEnabledSetting(true)).toBe(true);
		expect(isEnabledSetting("true")).toBe(true);
		expect(isEnabledSetting(1)).toBe(true);
		expect(isEnabledSetting("1")).toBe(true);
		expect(isEnabledSetting(false)).toBe(false);
		expect(isEnabledSetting("false")).toBe(false);
	});

	it("reads allowPrivateNetwork from string switch values", () => {
		expect(
			selfHostedNetworkOptions({ allowPrivateNetwork: "true", allowHttp: "true" })
		).toEqual({ allowHttp: true, allowPrivateNetwork: true });
		expect(
			selfHostedNetworkOptions({ allowPrivateNetwork: false, allowHttp: false })
		).toEqual({ allowHttp: false, allowPrivateNetwork: false });
	});
});
