/**
 * Server-side working copy of a GitHub repository for one Enrich run.
 *
 * The OpenLIT image has no `git`, and Trustabl does not keep its own clone, so
 * Enrich downloads the commit tarball through the GitHub REST API and extracts
 * it with the system `tar` into a fresh temp directory. Only directories this
 * module created are ever removed.
 */

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { promisify } from "node:util";
import {
	SCANNER_ENRICH_CLONE_FAILED,
	SCANNER_ENRICH_PATH_OUTSIDE,
	SCANNER_ENRICH_REPO_TOO_LARGE,
	SCANNER_REF_INVALID,
	SCANNER_REPO_NOT_FOUND,
	SCANNER_TARGET_INVALID,
} from "@/constants/messages/en";
import { scannerCloneTarget } from "./target";

const execFileAsync = promisify(execFile);

const DEFAULT_GITHUB_API = "https://api.github.com";
const WORKSPACE_PREFIX = "openlit-enrich-";
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

export interface EnrichWorkspace {
	root: string;
	repoDir: string;
	commitSha: string;
	ref: string;
	durationMs: number;
}

/** GitHub API base. `OPENLIT_GITHUB_API_URL` exists for hermetic tests. */
export function scannerGithubApiBase(): string {
	const override = String(process.env.OPENLIT_GITHUB_API_URL || "").trim();
	return /^https?:\/\/[^\s]+$/.test(override) ? override.replace(/\/+$/, "") : DEFAULT_GITHUB_API;
}

function githubHeaders(token: string | undefined, accept: string): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: accept,
		"User-Agent": "openlit-scanner",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

function githubError(status: number): Error {
	return new Error(status === 404 ? SCANNER_REPO_NOT_FOUND : SCANNER_ENRICH_CLONE_FAILED(status));
}

async function resolveCommit(
	api: string,
	repo: string,
	ref: string,
	token: string | undefined,
	signal: AbortSignal
): Promise<string> {
	const response = await fetch(`${api}/repos/${repo}/commits/${ref}`, {
		headers: githubHeaders(token, "application/vnd.github.sha"),
		signal,
	});
	if (!response.ok) throw githubError(response.status);
	const sha = (await response.text()).trim();
	if (!COMMIT_SHA.test(sha)) throw new Error(SCANNER_ENRICH_CLONE_FAILED(response.status));
	return sha;
}

async function downloadArchive(
	url: string,
	file: string,
	token: string | undefined,
	signal: AbortSignal
): Promise<void> {
	const response = await fetch(url, {
		headers: githubHeaders(token, "application/vnd.github+json"),
		signal,
	});
	if (!response.ok || !response.body) throw githubError(response.status);
	if (Number(response.headers.get("content-length") || 0) > MAX_ARCHIVE_BYTES) {
		throw new Error(SCANNER_ENRICH_REPO_TOO_LARGE);
	}
	const out = createWriteStream(file);
	let bytes = 0;
	try {
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_ARCHIVE_BYTES) {
				await reader.cancel();
				throw new Error(SCANNER_ENRICH_REPO_TOO_LARGE);
			}
			if (!out.write(value)) await new Promise((resolve) => out.once("drain", resolve));
		}
	} finally {
		await new Promise((resolve) => out.end(resolve));
	}
}

export async function createEnrichWorkspace(input: {
	target: string;
	ref?: string;
	token?: string;
	signal: AbortSignal;
}): Promise<EnrichWorkspace> {
	const started = Date.now();
	const match = scannerCloneTarget(input.target).match(GITHUB_REPO);
	if (!match) throw new Error(SCANNER_TARGET_INVALID);
	const repo = `${match[1]}/${match[2]}`;
	const ref = input.ref || "HEAD";
	// The ref is part of a token-bearing API path; git refs never contain these segments.
	if (ref.includes("..") || ref.split("/").includes(".")) {
		throw new Error(SCANNER_REF_INVALID);
	}
	const api = scannerGithubApiBase();
	const root = await mkdtemp(join(tmpdir(), WORKSPACE_PREFIX));
	try {
		const commitSha = await resolveCommit(api, repo, ref, input.token, input.signal);
		const archive = join(root, "source.tar.gz");
		await downloadArchive(`${api}/repos/${repo}/tarball/${commitSha}`, archive, input.token, input.signal);
		const repoDir = join(root, "repo");
		await mkdir(repoDir);
		await execFileAsync(
			"tar",
			["-xzf", archive, "-C", repoDir, "--strip-components=1", "--no-same-owner"],
			{ shell: false, signal: input.signal, timeout: EXTRACT_TIMEOUT_MS, windowsHide: true }
		);
		await rm(archive, { force: true });
		return { root, repoDir, commitSha, ref, durationMs: Date.now() - started };
	} catch (error) {
		await removeEnrichWorkspace(root);
		throw error;
	}
}

export async function removeEnrichWorkspace(root: string): Promise<void> {
	if (!root || !basename(root).startsWith(WORKSPACE_PREFIX)) return;
	await rm(root, { recursive: true, force: true });
}

/** Real path of a repo-relative file, refusing anything that escapes the copy. */
export async function resolveInsideWorkspace(repoDir: string, relPath: string): Promise<string> {
	try {
		const base = await realpath(repoDir);
		const resolved = await realpath(join(base, relPath));
		if (resolved.startsWith(`${base}${sep}`)) return resolved;
	} catch {
		/* missing files are rejected below */
	}
	throw new Error(SCANNER_ENRICH_PATH_OUTSIDE);
}
