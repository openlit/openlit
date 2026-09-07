import { createHash } from "node:crypto";
import {
	__resetTrustablReleaseFetcherForTests,
	installTrustablCli,
	setTrustablReleaseFetcherForTests,
} from "@/lib/platform/connectors/scanner/install";
import { SCANNER_RUNTIME_CHECKSUM_FAILED } from "@/constants/messages/en";
import { trustablAssetName } from "@/lib/platform/connectors/scanner/release";

jest.mock("@/lib/platform/connectors/scanner/runtime", () => ({
	TRUSTABL_FALLBACK_VERSION: "v0.1.8",
	probeTrustablRuntime: jest.fn(async () => ({
		installed: false,
		latestVersion: "v0.1.8",
		upgradeAvailable: true,
	})),
	trustablCacheBinary: jest.fn(() => "/tmp/openlit-trustabl-test/trustabl"),
}));

describe("Trustabl CLI install", () => {
	afterEach(() => {
		__resetTrustablReleaseFetcherForTests();
	});

	it("aborts when the archive checksum does not match", async () => {
		const fileName = trustablAssetName("v0.1.8");
		const archive = Buffer.from("not-the-release");
		setTrustablReleaseFetcherForTests(async (url) => {
			if (url.endsWith("/releases/latest")) {
				return Buffer.from(JSON.stringify({ tag_name: "v0.1.8" }));
			}
			if (url.endsWith("checksums.txt")) {
				return Buffer.from(`${createHash("sha256").update("other").digest("hex")}  ${fileName}\n`);
			}
			return archive;
		});
		await expect(installTrustablCli()).rejects.toThrow(SCANNER_RUNTIME_CHECKSUM_FAILED);
	});
});
