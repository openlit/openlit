import {
	assertPublicUrl,
	embeddedIPv4,
	isCloudMetadataAddress,
	isPrivateAddress,
} from "@/lib/platform/connectors/datasource/http/safe-fetch";

describe("IPv4-mapped IPv6 SSRF checks", () => {
	it.each([
		["::ffff:169.254.169.254", "169.254.169.254"],
		["::ffff:a9fe:a9fe", "169.254.169.254"],
		["[::ffff:7f00:1]", "127.0.0.1"],
		["::ffff:0:a00:1", "10.0.0.1"],
		["::ffff:0:1", "0.0.0.1"],
		["64:ff9b::a9fe:a9fe", "169.254.169.254"],
	])("decodes %s", (input, expected) => {
		expect(embeddedIPv4(input)).toBe(expected);
	});

	it("ignores ordinary IPv6 addresses", () => {
		expect(embeddedIPv4("2001:db8::1")).toBeNull();
	});

	it("classifies the hex-mapped forms the URL parser produces", () => {
		const host = new URL("http://[::ffff:169.254.169.254]/").hostname;
		expect(isCloudMetadataAddress(host.replace(/^\[|\]$/g, ""))).toBe(true);
		expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
		expect(isPrivateAddress("::ffff:a00:1")).toBe(true);
		expect(isPrivateAddress("::ffff:808:808")).toBe(false);
	});

	it("rejects a metadata URL written as a mapped IPv6 literal", async () => {
		await expect(
			assertPublicUrl("http://[::ffff:169.254.169.254]/latest/meta-data", { allowHttp: true })
		).rejects.toThrow();
		await expect(
			assertPublicUrl("http://[::ffff:127.0.0.1]:8123/", { allowHttp: true })
		).rejects.toThrow();
	});
});
