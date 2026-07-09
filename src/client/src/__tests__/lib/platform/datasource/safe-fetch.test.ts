import {
	assertPublicUrl,
	isPrivateAddress,
	redact,
	safeFetch,
	SsrfError,
} from "@/lib/platform/datasource/http/safe-fetch";

describe("isPrivateAddress", () => {
	it("flags IPv4 private / loopback / link-local / CGNAT ranges", () => {
		expect(isPrivateAddress("127.0.0.1")).toBe(true);
		expect(isPrivateAddress("10.0.0.5")).toBe(true);
		expect(isPrivateAddress("172.16.3.4")).toBe(true);
		expect(isPrivateAddress("172.32.0.1")).toBe(false);
		expect(isPrivateAddress("192.168.1.1")).toBe(true);
		expect(isPrivateAddress("169.254.169.254")).toBe(true);
		expect(isPrivateAddress("100.64.0.1")).toBe(true);
		expect(isPrivateAddress("0.0.0.0")).toBe(true);
		expect(isPrivateAddress("8.8.8.8")).toBe(false);
	});

	it("flags IPv6 loopback / link-local / ULA / mapped", () => {
		expect(isPrivateAddress("::1")).toBe(true);
		expect(isPrivateAddress("fe80::1")).toBe(true);
		expect(isPrivateAddress("fd00::1")).toBe(true);
		expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
		expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
	});
});

describe("assertPublicUrl", () => {
	const lookup = async (host: string) => {
		if (host === "public.example.com") return [{ address: "8.8.8.8" }];
		if (host === "evil.example.com") return [{ address: "10.0.0.1" }];
		if (host === "mixed.example.com")
			return [{ address: "8.8.8.8" }, { address: "127.0.0.1" }];
		return [];
	};

	it("rejects non-https by default", async () => {
		await expect(
			assertPublicUrl("http://public.example.com", { lookup })
		).rejects.toThrow(SsrfError);
	});

	it("allows http when explicitly enabled (self-hosted OSS backends)", async () => {
		const url = await assertPublicUrl("http://public.example.com", {
			allowHttp: true,
			lookup,
		});
		expect(url.hostname).toBe("public.example.com");
	});

	it("rejects javascript: and invalid URLs", async () => {
		await expect(assertPublicUrl("javascript:alert(1)")).rejects.toThrow(
			SsrfError
		);
		await expect(assertPublicUrl("not a url")).rejects.toThrow(SsrfError);
	});

	it("rejects embedded credentials", async () => {
		await expect(
			assertPublicUrl("https://user:pass@public.example.com", { lookup })
		).rejects.toThrow(/Credentials/);
	});

	it("blocks localhost and cloud metadata hostnames", async () => {
		await expect(assertPublicUrl("https://localhost")).rejects.toThrow(SsrfError);
		await expect(
			assertPublicUrl("https://169.254.169.254")
		).rejects.toThrow(SsrfError);
	});

	it("blocks hostnames that resolve to private addresses", async () => {
		await expect(
			assertPublicUrl("https://evil.example.com", { lookup })
		).rejects.toThrow(/private/);
	});

	it("blocks when ANY resolved address is private", async () => {
		await expect(
			assertPublicUrl("https://mixed.example.com", { lookup })
		).rejects.toThrow(/private/);
	});

	it("allows a hostname that resolves only to public addresses", async () => {
		const url = await assertPublicUrl("https://public.example.com/path", {
			lookup,
		});
		expect(url.pathname).toBe("/path");
	});

	it("allows a public literal IP and blocks a private literal IP", async () => {
		await expect(assertPublicUrl("https://8.8.8.8")).resolves.toBeInstanceOf(URL);
		await expect(assertPublicUrl("https://10.1.2.3")).rejects.toThrow(SsrfError);
	});
});

describe("redact", () => {
	it("removes secret substrings", () => {
		expect(redact("token=abcd1234 failed", ["abcd1234"])).toBe(
			"token=[REDACTED] failed"
		);
	});
	it("ignores short secrets", () => {
		expect(redact("x=ab", ["ab"])).toBe("x=ab");
	});
});

describe("safeFetch", () => {
	const lookup = async () => [{ address: "8.8.8.8" }];

	it("returns parsed JSON on success", async () => {
		const fetchImpl = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ hello: "world" }),
		});
		const result = await safeFetch("https://api.example.com", {
			lookup,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toEqual({ hello: "world" });
	});

	it("throws a redacted error on non-2xx", async () => {
		const fetchImpl = jest.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () => "forbidden secret-xyz-123",
		});
		await expect(
			safeFetch("https://api.example.com", {
				lookup,
				fetchImpl: fetchImpl as unknown as typeof fetch,
				redactValues: ["secret-xyz-123"],
			})
		).rejects.toThrow(/\[REDACTED\]/);
	});

	it("does not call fetch for an SSRF-blocked URL", async () => {
		const fetchImpl = jest.fn();
		await expect(
			safeFetch("https://10.0.0.1", {
				fetchImpl: fetchImpl as unknown as typeof fetch,
			})
		).rejects.toThrow(SsrfError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("throws a typed SourceResponseError carrying the status", async () => {
		const fetchImpl = jest.fn().mockResolvedValue({
			ok: false,
			status: 429,
			text: async () => "rate limited",
		});
		await expect(
			safeFetch("https://api.example.com", {
				lookup,
				fetchImpl: fetchImpl as unknown as typeof fetch,
			})
		).rejects.toMatchObject({ name: "SourceResponseError", status: 429 });
	});

	it("blocks a redirect that points at an internal address", async () => {
		const rebindLookup = async (host: string) => {
			if (host === "api.example.com") return [{ address: "8.8.8.8" }];
			if (host === "evil.internal") return [{ address: "169.254.169.254" }];
			return [];
		};
		const fetchImpl = jest.fn().mockResolvedValue({
			status: 302,
			headers: { get: (h: string) => (h === "location" ? "https://evil.internal/steal" : null) },
			text: async () => "",
		});
		await expect(
			safeFetch("https://api.example.com", {
				lookup: rebindLookup,
				fetchImpl: fetchImpl as unknown as typeof fetch,
			})
		).rejects.toThrow(SsrfError);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("follows a redirect to another public URL", async () => {
		const twoHopLookup = async () => [{ address: "8.8.8.8" }];
		const fetchImpl = jest
			.fn()
			.mockResolvedValueOnce({
				status: 302,
				headers: { get: (h: string) => (h === "location" ? "https://cdn.example.com/data" : null) },
				text: async () => "",
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: { get: () => null },
				text: async () => JSON.stringify({ ok: true }),
			});
		const result = await safeFetch("https://api.example.com", {
			lookup: twoHopLookup,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(result).toEqual({ ok: true });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("retries a transient 429 then succeeds when retry is enabled", async () => {
		const fetchImpl = jest
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 429,
				text: async () => "rate limited",
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				text: async () => JSON.stringify({ ok: true }),
			});
		const result = await safeFetch("https://api.example.com", {
			lookup,
			fetchImpl: fetchImpl as unknown as typeof fetch,
			retry: { retries: 2, baseDelayMs: 1, sleep: async () => {} },
		});
		expect(result).toEqual({ ok: true });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
