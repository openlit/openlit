/**
 * Validate scanner targets. v1 Trustabl scans GitHub repository URLs only.
 * Local filesystem paths are rejected so the OpenLIT server cannot be used
 * as an arbitrary host file reader.
 */

import {
	SCANNER_TARGET_INVALID,
	SCANNER_TARGET_REQUIRED,
	SCANNER_REF_INVALID,
	SCANNER_DETECTORS_INVALID,
	SCANNER_RULES_SOURCE_INVALID,
	SCANNER_RULES_REPO_INVALID,
} from "@/constants/messages/en";

const GITHUB_TARGET =
	/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?(?:\/tree\/[A-Za-z0-9._/~+-]+)?\/?$/;

const REF = /^[A-Za-z0-9._/~+-]{1,200}$/;
const DETECTOR = /^[a-z][a-z0-9_]{0,62}$/;

export function normalizeScannerTarget(value: unknown): string {
	const target = String(value || "").trim();
	if (!target) throw new Error(SCANNER_TARGET_REQUIRED);
	if (target.includes("@") || target.includes("\\") || /\s/.test(target)) {
		throw new Error(SCANNER_TARGET_INVALID);
	}
	if (!GITHUB_TARGET.test(target)) {
		throw new Error(SCANNER_TARGET_INVALID);
	}
	return target.replace(/\/$/, "");
}

export function normalizeScannerRef(value: unknown): string | undefined {
	if (value == null || String(value).trim() === "") return undefined;
	const ref = String(value).trim();
	if (!REF.test(ref)) throw new Error(SCANNER_REF_INVALID);
	return ref;
}

export function normalizeScannerDetectors(value: unknown): string | undefined {
	if (value == null || String(value).trim() === "") return undefined;
	const parts = String(value)
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);
	if (!parts.length) return undefined;
	if (parts.some((item) => !DETECTOR.test(item))) {
		throw new Error(SCANNER_DETECTORS_INVALID);
	}
	return parts.join(",");
}

export const SCANNER_RULES_SOURCES = ["production", "staging", "git"] as const;

export function normalizeScannerRulesSource(value: unknown): string | undefined {
	if (value == null || String(value).trim() === "") return undefined;
	const source = String(value).trim().toLowerCase();
	if (source === "environment") return undefined;
	if (!SCANNER_RULES_SOURCES.includes(source as (typeof SCANNER_RULES_SOURCES)[number])) {
		throw new Error(SCANNER_RULES_SOURCE_INVALID);
	}
	return source;
}

export function normalizeScannerRulesRepo(value: unknown): string | undefined {
	if (value == null || String(value).trim() === "") return undefined;
	const repo = String(value).trim();
	if (
		repo.includes("@") ||
		repo.includes("\\") ||
		/\s/.test(repo) ||
		!/^https:\/\/[A-Za-z0-9.-]+\/\S+$/.test(repo)
	) {
		throw new Error(SCANNER_RULES_REPO_INVALID);
	}
	return repo.replace(/\/$/, "");
}

/** Repo URL Trustabl can clone. `/tree/<ref>` is not a git remote and 404s. */
export function scannerCloneTarget(target: string): string {
	return target
		.replace(/\/$/, "")
		.replace(/\.git$/i, "")
		.replace(/\/tree\/[A-Za-z0-9._/~+-]+$/, "");
}

/**
 * Canonical GitHub repo identity used to join scanner jobs to coding-agent
 * spans (`vcs.repository.url.full`). Accepts https, ssh, and `/tree/<ref>`
 * forms; returns `github.com/owner/repo` or null.
 */
export function scannerRepoKey(value: unknown): string | null {
	const raw = String(value || "")
		.trim()
		.replace(/\.git$/i, "");
	if (!raw) return null;
	const match = raw.match(
		/(?:^|@|\/\/)github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i
	);
	if (!match) return null;
	const owner = match[1].toLowerCase();
	const repo = match[2].toLowerCase().replace(/\.git$/i, "");
	if (!owner || !repo) return null;
	return `github.com/${owner}/${repo}`;
}

export function scannerRefFromTarget(target: string): string | undefined {
	const match = target.match(/\/tree\/([A-Za-z0-9._/~+-]+)\/?$/);
	return match?.[1];
}
