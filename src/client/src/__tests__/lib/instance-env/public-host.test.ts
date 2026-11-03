jest.mock("dns/promises", () => ({ lookup: jest.fn() }));

import { lookup } from "dns/promises";
import { clearPublicHostCache, resolvesToPublicHost } from "@/lib/instance-env/public-host";

const resolve = (...addresses: string[]) =>
	(lookup as jest.Mock).mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));

describe("resolvesToPublicHost", () => {
	beforeEach(() => {
		(lookup as jest.Mock).mockReset();
		clearPublicHostCache();
	});

	it("accepts hosts whose addresses are all public", async () => {
		resolve("34.1.2.3", "2600:1f18::1");
		await expect(resolvesToPublicHost("acme.okta.com")).resolves.toBe(true);
	});

	it("rejects hosts with any private, loopback, link-local, or mapped address", async () => {
		for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:192.168.1.1"]) {
			clearPublicHostCache();
			resolve("34.1.2.3", address);
			await expect(resolvesToPublicHost("rebind.example.com")).resolves.toBe(false);
		}
	});

	it("rejects hosts that do not resolve", async () => {
		(lookup as jest.Mock).mockRejectedValue(new Error("ENOTFOUND"));
		await expect(resolvesToPublicHost("missing.example.com")).resolves.toBe(false);
		(lookup as jest.Mock).mockResolvedValue([]);
		clearPublicHostCache();
		await expect(resolvesToPublicHost("empty.example.com")).resolves.toBe(false);
	});

	it("strips IPv6 brackets and caches results", async () => {
		resolve("::1");
		await expect(resolvesToPublicHost("[::1]")).resolves.toBe(false);
		expect(lookup).toHaveBeenCalledWith("::1", { all: true });
		await resolvesToPublicHost("[::1]");
		expect(lookup).toHaveBeenCalledTimes(1);
	});
});
