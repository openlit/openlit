import { createHash, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	SCANNER_RUNTIME_CHECKSUM_FAILED,
	SCANNER_RUNTIME_DOWNLOAD_FAILED,
	SCANNER_RUNTIME_EXTRACT_FAILED,
	SCANNER_RUNTIME_UNSUPPORTED_PLATFORM,
} from "@/constants/messages/en";
import {
	TRUSTABL_LATEST_RELEASE_URL,
	normalizeScannerVersion,
	parseChecksumFile,
	trustablAssetName,
	trustablReleaseDownloadUrl,
} from "./release";
import {
	TRUSTABL_FALLBACK_VERSION,
	probeTrustablRuntime,
	trustablCacheBinary,
} from "./runtime";
import type { ScannerRuntimeInfo } from "./types";

const execFileAsync = promisify(execFile);
const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;

export type TrustablReleaseFetcher = (url: string) => Promise<Buffer>;

let releaseFetcher: TrustablReleaseFetcher = defaultReleaseFetcher;

export function setTrustablReleaseFetcherForTests(fetcher: TrustablReleaseFetcher): void {
	releaseFetcher = fetcher;
}

export function __resetTrustablReleaseFetcherForTests(): void {
	releaseFetcher = defaultReleaseFetcher;
}

function githubHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"User-Agent": "openlit",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

async function defaultReleaseFetcher(url: string): Promise<Buffer> {
	const response = await fetch(url, {
		headers: githubHeaders(),
		redirect: "follow",
	});
	if (!response.ok) {
		throw new Error(SCANNER_RUNTIME_DOWNLOAD_FAILED);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length > MAX_DOWNLOAD_BYTES) {
		throw new Error(SCANNER_RUNTIME_DOWNLOAD_FAILED);
	}
	return bytes;
}

function assertChecksum(archive: Buffer, expectedHex: string): void {
	const digest = createHash("sha256").update(archive).digest();
	const expected = Buffer.from(expectedHex, "hex");
	if (expected.length !== digest.length || !timingSafeEqual(digest, expected)) {
		throw new Error(SCANNER_RUNTIME_CHECKSUM_FAILED);
	}
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
	try {
		await execFileAsync("tar", ["-xf", archivePath, "-C", destDir], { timeout: 60_000 });
	} catch {
		throw new Error(SCANNER_RUNTIME_EXTRACT_FAILED);
	}
}

async function findExtractedBinary(dir: string): Promise<string> {
	const wanted = process.platform === "win32" ? "trustabl.exe" : "trustabl";
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = await findExtractedBinary(path).catch(() => "");
			if (nested) return nested;
		} else if (entry.name === wanted || entry.name === "trustabl") {
			return path;
		}
	}
	throw new Error(SCANNER_RUNTIME_EXTRACT_FAILED);
}

export async function fetchLatestTrustablTag(): Promise<string> {
	const raw = JSON.parse((await releaseFetcher(TRUSTABL_LATEST_RELEASE_URL)).toString("utf8")) as {
		tag_name?: string;
	};
	const tag = String(raw.tag_name || "").trim();
	if (!normalizeScannerVersion(tag)) {
		throw new Error(SCANNER_RUNTIME_DOWNLOAD_FAILED);
	}
	return tag.startsWith("v") ? tag : `v${tag}`;
}

export async function describeTrustablRuntime(): Promise<ScannerRuntimeInfo> {
	let latest = TRUSTABL_FALLBACK_VERSION;
	try {
		latest = await fetchLatestTrustablTag();
	} catch {
		latest = TRUSTABL_FALLBACK_VERSION;
	}
	return probeTrustablRuntime(latest);
}

export async function installTrustablCli(input: { upgrade?: boolean } = {}): Promise<ScannerRuntimeInfo> {
	const current = await describeTrustablRuntime();
	if (current.installed && !input.upgrade) {
		return current;
	}

	const tag = current.latestVersion || (await fetchLatestTrustablTag().catch(() => TRUSTABL_FALLBACK_VERSION));
	const fileName = trustablAssetName(tag);
	if (!fileName) throw new Error(SCANNER_RUNTIME_UNSUPPORTED_PLATFORM);

	const checksums = parseChecksumFile(
		(await releaseFetcher(trustablReleaseDownloadUrl(tag, "checksums.txt"))).toString("utf8")
	);
	const expected = checksums.get(fileName);
	if (!expected) throw new Error(SCANNER_RUNTIME_CHECKSUM_FAILED);

	const archive = await releaseFetcher(trustablReleaseDownloadUrl(tag, fileName));
	assertChecksum(archive, expected);

	const staging = await mkdtemp(join(tmpdir(), "openlit-trustabl-"));
	try {
		const archivePath = join(staging, fileName);
		await writeFile(archivePath, archive);
		await extractArchive(archivePath, staging);
		const extracted = await findExtractedBinary(staging);
		const dest = trustablCacheBinary(tag);
		await mkdir(join(dest, ".."), { recursive: true });
		const binary = await readFile(extracted);
		await writeFile(dest, binary);
		if (process.platform !== "win32") await chmod(dest, 0o755);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}

	return probeTrustablRuntime(tag);
}
