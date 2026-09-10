import {
	canonicalizeFetchUrl,
	isEnabledSetting,
	isRunningInDocker,
	joinDatasourceRequestUrl,
	normalizeDatasourceEndpointUrl,
	rewriteLoopbackEndpointForDocker,
} from "@/lib/platform/connectors/datasource/http/endpoint-url";
import { selfHostedNetworkOptions } from "@/lib/platform/connectors/datasource/http/safe-fetch";

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

	it("returns an empty string unchanged", () => {
		expect(normalizeDatasourceEndpointUrl("")).toBe("");
	});

	it("strips trailing slashes from non-http(s) protocols without throwing", () => {
		expect(normalizeDatasourceEndpointUrl("ftp://files.example.com/dir/")).toBe(
			"ftp://files.example.com/dir"
		);
	});

	it("falls back to trailing-slash stripping when the URL cannot be parsed", () => {
		expect(normalizeDatasourceEndpointUrl("not a url///")).toBe("not a url");
	});
});

describe("canonicalizeFetchUrl", () => {
	it("trims whitespace and leaves well-formed URLs unchanged", () => {
		expect(canonicalizeFetchUrl("  https://example.com/path  ")).toBe(
			"https://example.com/path"
		);
	});

	it("returns an empty string for nullish input", () => {
		expect(canonicalizeFetchUrl(undefined as unknown as string)).toBe("");
	});
});

describe("joinDatasourceRequestUrl", () => {
	it("joins a base and a path with exactly one slash", () => {
		expect(joinDatasourceRequestUrl("http://localhost:3100", "loki/api/v1/push")).toBe(
			"http://localhost:3100/loki/api/v1/push"
		);
	});

	it("normalizes duplicated slashes at the join point", () => {
		expect(joinDatasourceRequestUrl("http://localhost:3100/", "/loki/push")).toBe(
			"http://localhost:3100/loki/push"
		);
	});

	it("returns just the suffix when the base is empty", () => {
		expect(joinDatasourceRequestUrl("", "v1/memories/123/")).toBe(
			"v1/memories/123/"
		);
	});

	it("returns just the base when the path is empty", () => {
		expect(joinDatasourceRequestUrl("http://localhost:3100", "")).toBe(
			"http://localhost:3100"
		);
	});

	it("preserves a trailing slash on the joined path", () => {
		expect(
			joinDatasourceRequestUrl("http://localhost:3100", "v1/memories/123/")
		).toBe("http://localhost:3100/v1/memories/123/");
	});
});

describe("isRunningInDocker", () => {
	it("returns the injected exists() result", () => {
		expect(isRunningInDocker(() => true)).toBe(true);
		expect(isRunningInDocker(() => false)).toBe(false);
	});

	it("returns false when the exists() check throws", () => {
		expect(
			isRunningInDocker(() => {
				throw new Error("fs unavailable");
			})
		).toBe(false);
	});

	it("uses the default fs.existsSync-backed check and survives it throwing", () => {
		// Use the same require("fs") reference the source module resolves at
		// call time (a namespace `import * as fs` would spy on a separate
		// interop-copied object and silently miss the real module).
		const fs = require("fs");
		const spy = jest
			.spyOn(fs, "existsSync")
			.mockImplementation(() => {
				throw new Error("boom");
			});
		try {
			expect(isRunningInDocker()).toBe(false);
		} finally {
			spy.mockRestore();
		}
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

	it("returns the raw URL unchanged when it cannot be parsed even when enabled", () => {
		expect(
			rewriteLoopbackEndpointForDocker("not a url", { enabled: true })
		).toBe("not a url");
	});

	it("returns the raw URL unchanged when canonicalization yields an empty string", () => {
		expect(rewriteLoopbackEndpointForDocker("", { enabled: true })).toBe("");
	});

	it("preserves a trailing slash on the rewritten loopback URL", () => {
		expect(
			rewriteLoopbackEndpointForDocker("http://localhost:3100/loki/", {
				enabled: true,
			})
		).toBe("http://host.docker.internal:3100/loki/");
	});

	it("defaults enabled to isRunningInDocker() when not explicitly set", () => {
		expect(rewriteLoopbackEndpointForDocker("http://localhost:3100")).toBe(
			"http://localhost:3100"
		);
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
