import {
	compareScannerVersions,
	normalizeScannerVersion,
	parseChecksumFile,
	trustablAssetName,
	trustablReleaseDownloadUrl,
} from "@/lib/platform/connectors/scanner/release";

describe("Trustabl release helpers", () => {
	it("normalizes CLI version strings", () => {
		expect(normalizeScannerVersion("trustabl 0.1.8")).toBe("0.1.8");
		expect(normalizeScannerVersion("v0.1.8")).toBe("0.1.8");
	});

	it("detects upgrades", () => {
		expect(compareScannerVersions("0.1.7", "0.1.8")).toBeLessThan(0);
		expect(compareScannerVersions("v0.1.8", "0.1.8")).toBe(0);
	});

	it("builds the current-platform asset name", () => {
		expect(trustablAssetName("v0.1.8", "darwin", "arm64")).toBe("trustabl_0.1.8_darwin_arm64.tar.gz");
		expect(trustablAssetName("0.1.8", "linux", "x64")).toBe("trustabl_0.1.8_linux_amd64.tar.gz");
		expect(trustablAssetName("v0.1.8", "win32", "x64")).toBe("trustabl_0.1.8_windows_amd64.zip");
		expect(trustablAssetName("v0.1.8", "aix", "ppc")).toBe("");
	});

	it("parses goreleaser checksums", () => {
		const checksums = parseChecksumFile(
			"9e1251bea09ae660362f842dfe97212e34efd7efd7e530a5809010ae490ff867  trustabl_0.1.8_darwin_amd64.tar.gz\n"
		);
		expect(checksums.get("trustabl_0.1.8_darwin_amd64.tar.gz")).toBe(
			"9e1251bea09ae660362f842dfe97212e34efd7efd7e530a5809010ae490ff867"
		);
	});

	it("builds release download URLs from a sanitized version tag", () => {
		expect(trustablReleaseDownloadUrl("v0.1.8", "checksums.txt")).toBe(
			"https://github.com/trustabl/trustabl/releases/download/v0.1.8/checksums.txt"
		);
		expect(trustablReleaseDownloadUrl("v0.1.8/../../etc", "checksums.txt")).toBe(
			"https://github.com/trustabl/trustabl/releases/download/v0.1.8/checksums.txt"
		);
	});
});
