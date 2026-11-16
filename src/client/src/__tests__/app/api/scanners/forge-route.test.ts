jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/scanner/forge-crud", () => ({
	runScannerForge: jest.fn(),
	getScannerForgeRun: jest.fn(),
	checkScannerForgeRun: jest.fn(),
}));
jest.mock("@/utils/asaw", () =>
	jest.fn(async (promise: Promise<unknown>) => {
		try {
			return [null, await promise];
		} catch (error) {
			return [error, null];
		}
	})
);

import { POST } from "@/app/api/scanners/[id]/forge/route";
import { GET as GETRun } from "@/app/api/scanners/[id]/forge/[runId]/route";
import { GET as GETCheck } from "@/app/api/scanners/[id]/forge/[runId]/check/route";
import { getCurrentUser } from "@/lib/session";
import {
	checkScannerForgeRun,
	getScannerForgeRun,
	runScannerForge,
} from "@/lib/platform/connectors/scanner/forge-crud";
import {
	SCANNER_FORGE_POLICIES_REQUIRED,
	SCANNER_FORGE_POLICY_INVALID,
	SCANNER_FORGE_RUN_ID_INVALID,
	SCANNER_INVALID_JSON,
} from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makePostRequest(body: unknown) {
	return {
		text: async () => (body === "__invalid__" ? "{" : JSON.stringify(body)),
	} as any;
}

const runParams = { params: { id: "scanner:abc", runId: "forge:1" } };

beforeEach(() => {
	jest.clearAllMocks();
	(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
});

describe("POST /api/scanners/[id]/forge", () => {
	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await POST(makePostRequest({}), { params: { id: "scanner:abc" } });
		expect(response.status).toBe(401);
		expect(runScannerForge).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const response = await POST(makePostRequest("__invalid__"), { params: { id: "scanner:abc" } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_INVALID_JSON });
		expect(runScannerForge).not.toHaveBeenCalled();
	});

	it("rejects invalid policies before running", async () => {
		const response = await POST(makePostRequest({ policies: ["--output"] }), {
			params: { id: "scanner:abc" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_FORGE_POLICY_INVALID });
		expect(runScannerForge).not.toHaveBeenCalled();
	});

	it("forwards parsed forge input", async () => {
		(runScannerForge as jest.Mock).mockResolvedValue({ run: { id: "forge:1" } });
		const response = await POST(
			makePostRequest({
				target: "https://github.com/acme/agent",
				policies: "claude_sdk,mcp",
				rulesRef: "v1",
				fileName: "SKILL.md",
				sourceJobId: "job:1",
				unknown: "dropped",
			}),
			{ params: { id: "scanner:abc" } }
		);
		expect(response.status).toBe(200);
		expect(runScannerForge).toHaveBeenCalledWith("scanner:abc", {
			target: "https://github.com/acme/agent",
			policies: ["claude_sdk", "mcp"],
			rulesRef: "v1",
			fileName: "SKILL.md",
			sourceJobId: "job:1",
		});
		await expect(response.json()).resolves.toEqual({ run: { id: "forge:1" } });
	});

	it("returns 400 with the crud error", async () => {
		(runScannerForge as jest.Mock).mockRejectedValue(new Error(SCANNER_FORGE_POLICIES_REQUIRED));
		const response = await POST(makePostRequest({}), { params: { id: "scanner:abc" } });
		expect(response.status).toBe(400);
	});
});

describe("GET /api/scanners/[id]/forge/[runId]", () => {
	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GETRun({} as any, runParams);
		expect(response.status).toBe(401);
	});

	it("rejects invalid run ids", async () => {
		const response = await GETRun({} as any, { params: { id: "scanner:abc", runId: "../x" } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_FORGE_RUN_ID_INVALID });
		expect(getScannerForgeRun).not.toHaveBeenCalled();
	});

	it("returns the run with content", async () => {
		(getScannerForgeRun as jest.Mock).mockResolvedValue({ id: "forge:1", content: "# skill" });
		const response = await GETRun({} as any, runParams);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ run: { id: "forge:1", content: "# skill" } });
		expect(getScannerForgeRun).toHaveBeenCalledWith("scanner:abc", "forge:1");
	});
});

describe("GET /api/scanners/[id]/forge/[runId]/check", () => {
	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GETCheck({} as any, runParams);
		expect(response.status).toBe(401);
	});

	it("rejects invalid run ids", async () => {
		const response = await GETCheck({} as any, { params: { id: "scanner:abc", runId: "job:1" } });
		expect(response.status).toBe(400);
		expect(checkScannerForgeRun).not.toHaveBeenCalled();
	});

	it("returns the check result", async () => {
		(checkScannerForgeRun as jest.Mock).mockResolvedValue({ status: "stale", message: "outdated" });
		const response = await GETCheck({} as any, runParams);
		await expect(response.json()).resolves.toEqual({ check: { status: "stale", message: "outdated" } });
	});
});
