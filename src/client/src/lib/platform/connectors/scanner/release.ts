export function normalizeScannerVersion(raw?: string): string {
	const match = String(raw || "").match(/v?(\d+\.\d+\.\d+)/i);
	return match ? match[1] : "";
}

export function compareScannerVersions(left?: string, right?: string): number {
	const a = normalizeScannerVersion(left).split(".").map((part) => Number(part) || 0);
	const b = normalizeScannerVersion(right).split(".").map((part) => Number(part) || 0);
	for (let i = 0; i < 3; i += 1) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return 0;
}

export function trustablAssetName(
	version: string,
	platform = process.platform,
	arch = process.arch
): string {
	const semver = normalizeScannerVersion(version);
	const os =
		platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : "";
	const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : "";
	if (!semver || !os || !cpu) return "";
	const ext = os === "windows" ? "zip" : "tar.gz";
	return `trustabl_${semver}_${os}_${cpu}.${ext}`;
}

export function parseChecksumFile(text: string): Map<string, string> {
	const checksums = new Map<string, string>();
	for (const line of String(text || "").split(/\r?\n/)) {
		const match = line.trim().match(/^([a-fA-F0-9]{64})\s+(\S+)$/);
		if (match) checksums.set(match[2], match[1].toLowerCase());
	}
	return checksums;
}

export function trustablReleaseDownloadUrl(tag: string, fileName: string): string {
	const version = normalizeScannerVersion(tag);
	const safeTag = version ? `v${version}` : "";
	const safeFile = String(fileName || "").replace(/[^A-Za-z0-9._-]/g, "");
	return `https://github.com/trustabl/trustabl/releases/download/${safeTag}/${safeFile}`;
}

export const TRUSTABL_LATEST_RELEASE_URL =
	"https://api.github.com/repos/trustabl/trustabl/releases/latest";
