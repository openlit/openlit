/**
 * @jest-environment node
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	createEnrichWorkspace,
	removeEnrichWorkspace,
	resolveInsideWorkspace,
	scannerGithubApiBase,
} from "@/lib/platform/connectors/scanner/enrich-workspace";
import {
	SCANNER_ENRICH_CLONE_FAILED,
	SCANNER_ENRICH_PATH_OUTSIDE,
	SCANNER_ENRICH_REPO_TOO_LARGE,
	SCANNER_REF_INVALID,
	SCANNER_REPO_NOT_FOUND,
} from "@/constants/messages/en";

const SHA = "826b268f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
const TARGET = "https://github.com/Acme/agents";

let fixtureDir: string;
let tarball: Buffer;

beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), "enrich-ws-fixture-"));
	const top = join(fixtureDir, "Acme-agents-826b268");
	mkdirSync(join(top, "agent"), { recursive: true });
	writeFileSync(join(top, "agent", "agent.py"), 'tools=["Bash"]\n');
	execFileSync("tar", ["-czf", join(fixtureDir, "repo.tar.gz"), "-C", fixtureDir, "Acme-agents-826b268"]);
	tarball = readFileSync(join(fixtureDir, "repo.tar.gz"));
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

const fetchMock = jest.fn();

// jest.setup installs a minimal Response polyfill, so build fetch responses by hand.
function fakeResponse(
	body: string | Buffer,
	init: { status?: number; headers?: Record<string, string> } = {}
) {
	const status = init.status ?? 200;
	const bytes = typeof body === "string" ? Buffer.from(body) : body;
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
		text: async () => bytes.toString("utf8"),
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(bytes));
				controller.close();
			},
		}),
	};
}
const Response = function (
	body: string | Buffer,
	init?: { status?: number; headers?: Record<string, string> }
) {
	return fakeResponse(body, init);
} as unknown as new (
	body: string | Buffer,
	init?: { status?: number; headers?: Record<string, string> }
) => ReturnType<typeof fakeResponse>;

beforeEach(() => {
	fetchMock.mockReset();
	global.fetch = fetchMock as unknown as typeof fetch;
	delete process.env.OPENLIT_GITHUB_API_URL;
});

function githubResponses(tar: Buffer = tarball) {
	fetchMock.mockImplementation(async (url: string) => {
		if (url.includes("/commits/")) return new Response(SHA, { status: 200 });
		if (url.includes("/tarball/")) return new Response(tar, { status: 200 });
		return new Response("", { status: 500 });
	});
}

describe("createEnrichWorkspace", () => {
	it("downloads the commit tarball and extracts the repository", async () => {
		githubResponses();
		const workspace = await createEnrichWorkspace({
			target: TARGET,
			ref: "main",
			signal: new AbortController().signal,
		});
		try {
			expect(workspace.commitSha).toBe(SHA);
			expect(workspace.ref).toBe("main");
			expect(basename(workspace.root).startsWith("openlit-enrich-")).toBe(true);
			expect(readFileSync(join(workspace.repoDir, "agent", "agent.py"), "utf8")).toContain("Bash");
			expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/Acme/agents/commits/main");
			expect(fetchMock.mock.calls[1][0]).toBe(`https://api.github.com/repos/Acme/agents/tarball/${SHA}`);
			expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
		} finally {
			await removeEnrichWorkspace(workspace.root);
		}
		expect(existsSync(workspace.root)).toBe(false);
	});

	it("uses the default branch and sends the token when present", async () => {
		githubResponses();
		const workspace = await createEnrichWorkspace({
			target: TARGET,
			token: "ghp_secret",
			signal: new AbortController().signal,
		});
		await removeEnrichWorkspace(workspace.root);
		expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repos/Acme/agents/commits/HEAD");
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer ghp_secret");
		expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer ghp_secret");
	});

	it("reports a missing repository", async () => {
		fetchMock.mockResolvedValue(new Response("", { status: 404 }));
		await expect(
			createEnrichWorkspace({ target: TARGET, signal: new AbortController().signal })
		).rejects.toThrow(SCANNER_REPO_NOT_FOUND);
	});

	it("reports other GitHub errors with the status", async () => {
		fetchMock.mockImplementation(async (url: string) =>
			url.includes("/commits/") ? new Response(SHA) : new Response("", { status: 502 })
		);
		await expect(
			createEnrichWorkspace({ target: TARGET, signal: new AbortController().signal })
		).rejects.toThrow(SCANNER_ENRICH_CLONE_FAILED(502));
	});

	it("refuses an archive over the size limit and cleans up", async () => {
		fetchMock.mockImplementation(async (url: string) =>
			url.includes("/commits/")
				? new Response(SHA)
				: new Response(tarball, { headers: { "content-length": String(300 * 1024 * 1024) } })
		);
		const before = new Set(listWorkspaces());
		await expect(
			createEnrichWorkspace({ target: TARGET, signal: new AbortController().signal })
		).rejects.toThrow(SCANNER_ENRICH_REPO_TOO_LARGE);
		expect(listWorkspaces().filter((name) => !before.has(name))).toEqual([]);
	});

	it("refuses a ref that walks out of the commits path before calling GitHub", async () => {
		for (const ref of ["../../user", "feature/../../../user", "./main"]) {
			await expect(
				createEnrichWorkspace({ target: TARGET, ref, token: "ghp_secret", signal: new AbortController().signal })
			).rejects.toThrow(SCANNER_REF_INVALID);
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("honours OPENLIT_GITHUB_API_URL", async () => {
		process.env.OPENLIT_GITHUB_API_URL = "http://127.0.0.1:3012/";
		expect(scannerGithubApiBase()).toBe("http://127.0.0.1:3012");
		process.env.OPENLIT_GITHUB_API_URL = "file:///etc";
		expect(scannerGithubApiBase()).toBe("https://api.github.com");
	});
});

function listWorkspaces(): string[] {
	return require("node:fs")
		.readdirSync(tmpdir())
		.filter((name: string) => name.startsWith("openlit-enrich-"));
}

describe("resolveInsideWorkspace", () => {
	it("allows files in the copy and rejects symlinks out of it", async () => {
		const repo = mkdtempSync(join(tmpdir(), "enrich-ws-paths-"));
		try {
			writeFileSync(join(repo, "ok.py"), "x");
			symlinkSync("/etc/hosts", join(repo, "escape.py"));
			await expect(resolveInsideWorkspace(repo, "ok.py")).resolves.toMatch(/ok\.py$/);
			await expect(resolveInsideWorkspace(repo, "escape.py")).rejects.toThrow(SCANNER_ENRICH_PATH_OUTSIDE);
			await expect(resolveInsideWorkspace(repo, "../x.py")).rejects.toThrow(SCANNER_ENRICH_PATH_OUTSIDE);
		} finally {
			rmSync(repo, { recursive: true, force: true });
		}
	});
});

describe("removeEnrichWorkspace", () => {
	it("only removes OpenLIT enrich directories", async () => {
		const other = mkdtempSync(join(tmpdir(), "not-enrich-"));
		await removeEnrichWorkspace(other);
		expect(existsSync(other)).toBe(true);
		rmSync(other, { recursive: true, force: true });
	});
});
