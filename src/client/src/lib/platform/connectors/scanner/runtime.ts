import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SCANNER_RUNTIME_VERSION_FAILED } from "@/constants/messages/en";
import { getScannerProcessRunner } from "./process";
import { compareScannerVersions, normalizeScannerVersion } from "./release";
import type { ScannerRuntimeInfo } from "./types";

export const TRUSTABL_FALLBACK_VERSION = "v0.1.8";
/** @deprecated Use TRUSTABL_FALLBACK_VERSION. Kept for adapter tests and descriptors. */
export const TRUSTABL_PINNED_VERSION = TRUSTABL_FALLBACK_VERSION;
const VERSION_TIMEOUT_MS = 20_000;

function cacheRoot(): string {
	return (
		process.env.OPENLIT_RUNTIME_CACHE ||
		process.env.XDG_CACHE_HOME ||
		join(homedir(), ".cache")
	);
}

export function trustablCacheDir(): string {
	return join(cacheRoot(), "openlit", "runtimes", "trustabl");
}

export function trustablCacheBinary(version = TRUSTABL_FALLBACK_VERSION): string {
	const file = process.platform === "win32" ? "trustabl.exe" : "trustabl";
	const tag = String(version).startsWith("v") ? version : `v${normalizeScannerVersion(version)}`;
	return join(trustablCacheDir(), tag, file);
}

async function isExecutable(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function cachedBinaries(): Promise<{ version: string; bin: string }[]> {
	try {
		const versions = await readdir(trustablCacheDir());
		const found: { version: string; bin: string }[] = [];
		for (const version of versions) {
			const bin = trustablCacheBinary(version);
			if (await isExecutable(bin)) found.push({ version, bin });
		}
		return found.sort((left, right) => compareScannerVersions(right.version, left.version));
	} catch {
		return [];
	}
}

export async function resolveTrustablBinary(
	version?: string
): Promise<{ bin: string; source: NonNullable<ScannerRuntimeInfo["source"]>; binaryVersion?: string } | null> {
	if (version) {
		const pinned = trustablCacheBinary(version);
		if (await isExecutable(pinned)) {
			return { bin: pinned, source: "cache", binaryVersion: version };
		}
	}
	const cached = await cachedBinaries();
	if (cached[0]) {
		return { bin: cached[0].bin, source: "cache", binaryVersion: cached[0].version };
	}
	const fromEnv = String(process.env.TRUSTABL_BIN || "").trim();
	if (fromEnv && (await isExecutable(fromEnv))) {
		return { bin: fromEnv, source: "env" };
	}
	const fromPath = process.platform === "win32" ? "trustabl.exe" : "trustabl";
	return { bin: fromPath, source: "path" };
}

async function reportedVersion(bin: string): Promise<string | null> {
	try {
		const result = await getScannerProcessRunner().run({
			bin,
			argv: ["version"],
			env: process.env,
			timeoutMs: VERSION_TIMEOUT_MS,
		});
		if (result.exitCode !== 0) return null;
		return result.stdout.trim().split("\n")[0]?.trim() || null;
	} catch {
		return null;
	}
}

export async function probeTrustablRuntime(latestTag?: string): Promise<ScannerRuntimeInfo> {
	const latestVersion = latestTag ? `v${normalizeScannerVersion(latestTag)}` : undefined;
	const resolved = await resolveTrustablBinary(latestVersion);
	if (!resolved) {
		return { installed: false, latestVersion, upgradeAvailable: Boolean(latestVersion) };
	}
	const reported = await reportedVersion(resolved.bin);
	if (!reported) {
		if (resolved.source === "path") {
			return { installed: false, latestVersion, upgradeAvailable: Boolean(latestVersion) };
		}
		return {
			installed: false,
			source: resolved.source,
			binaryVersion: resolved.binaryVersion,
			latestVersion,
			upgradeAvailable: Boolean(latestVersion),
		};
	}
	const installedVersion = normalizeScannerVersion(reported);
	const latest = normalizeScannerVersion(latestVersion);
	return {
		installed: true,
		version: reported,
		source: resolved.source,
		binaryVersion: resolved.binaryVersion || (installedVersion ? `v${installedVersion}` : undefined),
		latestVersion,
		upgradeAvailable: Boolean(latest) && compareScannerVersions(installedVersion, latest) < 0,
	};
}

export async function runTrustablVersion(version?: string): Promise<ScannerRuntimeInfo> {
	const runtime = await probeTrustablRuntime(version);
	if (!runtime.installed) {
		throw new Error(SCANNER_RUNTIME_VERSION_FAILED);
	}
	return runtime;
}

export async function ensureTrustablRuntime(version?: string): Promise<ScannerRuntimeInfo> {
	return probeTrustablRuntime(version);
}
