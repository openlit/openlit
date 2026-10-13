jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/scanner/crud", () => ({
	listScannerConnectors: jest.fn(),
	runScannerJob: jest.fn(),
	getScannerCliRuntime: jest.fn(),
	installScannerRuntime: jest.fn(),
	listScannerJobFindings: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/scanner/lookup", () => ({
	lookupLatestScannerFindingsForRepo: jest.fn(),
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

import { GET } from "@/app/api/scanners/route";
import { GET as GETFindings } from "@/app/api/scanners/findings/route";
import { GET as GETJobFindings } from "@/app/api/scanners/[id]/jobs/[jobId]/findings/route";
import { POST } from "@/app/api/scanners/[id]/scan/route";
import { GET as GETRuntime, POST as POSTRuntime } from "@/app/api/scanners/runtime/route";
import { POST as POSTInstall } from "@/app/api/scanners/[id]/install/route";
import { getCurrentUser } from "@/lib/session";
import {
	getScannerCliRuntime,
	installScannerRuntime,
	listScannerConnectors,
	listScannerJobFindings,
	runScannerJob,
} from "@/lib/platform/connectors/scanner/crud";
import { lookupLatestScannerFindingsForRepo } from "@/lib/platform/connectors/scanner/lookup";
import { SCANNER_INVALID_JSON, SCANNER_JOB_ID_INVALID, SCANNER_TARGET_REQUIRED } from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makeGetRequest() {
	return { url: "http://localhost/api/scanners" } as any;
}

function makePostRequest(body: unknown) {
	return {
		text: async () => {
			if (body === "__invalid__") return "{";
			return JSON.stringify(body);
		},
	} as any;
}

describe("GET /api/scanners", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GET(makeGetRequest());
		expect(response.status).toBe(401);
		expect(listScannerConnectors).not.toHaveBeenCalled();
	});

	it("returns connectors without secretRef", async () => {
		(listScannerConnectors as jest.Mock).mockResolvedValue([
			{ id: "scanner:abc", name: "Prod scan", hasSecret: true },
		]);
		const response = await GET(makeGetRequest());
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.connectors[0].id).toBe("scanner:abc");
		expect(JSON.stringify(body)).not.toContain("secretRef");
	});
});

describe("POST /api/scanners/[id]/scan", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await POST(makePostRequest({}), { params: { id: "scanner:abc" } });
		expect(response.status).toBe(401);
		expect(runScannerJob).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const response = await POST(makePostRequest("__invalid__"), {
			params: { id: "scanner:abc" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_INVALID_JSON });
		expect(runScannerJob).not.toHaveBeenCalled();
	});

	it("forwards Trustabl scan flags to the job runner", async () => {
		(runScannerJob as jest.Mock).mockResolvedValue({ job: { id: "job:1" } });
		const response = await POST(
			makePostRequest({
				target: "https://github.com/acme/checkout-agent",
				ref: "main",
				detectors: "mcp",
				strict: true,
				secretScan: true,
				rulesSource: "staging",
			}),
			{ params: { id: "scanner:abc" } }
		);
		expect(response.status).toBe(200);
		expect(runScannerJob).toHaveBeenCalledWith("scanner:abc", {
			target: "https://github.com/acme/checkout-agent",
			ref: "main",
			detectors: "mcp",
			strict: true,
			secretScan: true,
			vulnScan: undefined,
			licenseScan: undefined,
			requireSigned: undefined,
			rulesRepo: undefined,
			rulesRef: undefined,
			rulesSource: "staging",
			noRulesUpdate: undefined,
			verbose: undefined,
		});
	});
});

describe("GET /api/scanners/runtime", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GETRuntime();
		expect(response.status).toBe(401);
		expect(getScannerCliRuntime).not.toHaveBeenCalled();
	});

	it("returns the server CLI runtime", async () => {
		(getScannerCliRuntime as jest.Mock).mockResolvedValue({
			installed: true,
			version: "trustabl 0.1.8",
			latestVersion: "v0.1.8",
		});
		const response = await GETRuntime();
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.runtime.version).toBe("trustabl 0.1.8");
	});
});

describe("POST /api/scanners/runtime", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("rejects malformed JSON", async () => {
		const response = await POSTRuntime(makePostRequest("__invalid__"));
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_INVALID_JSON });
		expect(installScannerRuntime).not.toHaveBeenCalled();
	});
});

describe("POST /api/scanners/[id]/install", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("rejects malformed JSON", async () => {
		const response = await POSTInstall(makePostRequest("__invalid__"), {
			params: { id: "scanner:abc" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_INVALID_JSON });
		expect(installScannerRuntime).not.toHaveBeenCalled();
	});
});

describe("GET /api/scanners/findings", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GETFindings({
			url: "http://localhost/api/scanners/findings?repoUrl=https://github.com/acme/checkout-agent",
		} as Request);
		expect(response.status).toBe(401);
		expect(lookupLatestScannerFindingsForRepo).not.toHaveBeenCalled();
	});

	it("requires a repo URL", async () => {
		const response = await GETFindings({
			url: "http://localhost/api/scanners/findings",
		} as Request);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_TARGET_REQUIRED });
		expect(lookupLatestScannerFindingsForRepo).not.toHaveBeenCalled();
	});

	it("returns the latest findings match for a repo", async () => {
		(lookupLatestScannerFindingsForRepo as jest.Mock).mockResolvedValue({
			matched: true,
			repoKey: "github.com/acme/checkout-agent",
			connectorId: "scanner:abc",
			jobId: "job:1",
			mediumPlusCount: 2,
		});
		const response = await GETFindings({
			url: "http://localhost/api/scanners/findings?repoUrl=https://github.com/acme/checkout-agent",
		} as Request);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.matched).toBe(true);
		expect(body.mediumPlusCount).toBe(2);
		expect(lookupLatestScannerFindingsForRepo).toHaveBeenCalledWith({
			repoUrl: "https://github.com/acme/checkout-agent",
		});
	});
});

describe("GET /api/scanners/[id]/jobs/[jobId]/findings", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GETJobFindings(
			{ url: "http://localhost/api/scanners/scanner:abc/jobs/job:abee6854-450a-445d-98a9-8ed0076c05b7/findings" } as Request,
			{ params: { id: "scanner:abc", jobId: "job:abee6854-450a-445d-98a9-8ed0076c05b7" } }
		);
		expect(response.status).toBe(401);
		expect(listScannerJobFindings).not.toHaveBeenCalled();
	});

	it("rejects an invalid job id", async () => {
		const response = await GETJobFindings(
			{ url: "http://localhost/api/scanners/scanner:abc/jobs/../etc/passwd/findings" } as Request,
			{ params: { id: "scanner:abc", jobId: "../etc/passwd" } }
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_JOB_ID_INVALID });
		expect(listScannerJobFindings).not.toHaveBeenCalled();
	});

	it("forwards search, severity, and pagination to the job findings reader", async () => {
		(listScannerJobFindings as jest.Mock).mockResolvedValue({
			findings: [],
			total: 0,
			page: 1,
			pageSize: 25,
			counts: { all: 0, critical: 0, high: 0, medium: 0, low: 0 },
		});
		const jobId = "job:abee6854-450a-445d-98a9-8ed0076c05b7";
		const response = await GETJobFindings(
			{
				url: `http://localhost/api/scanners/scanner:abc/jobs/${jobId}/findings?q=mcp&severity=high&page=2&limit=10`,
			} as Request,
			{ params: { id: "scanner:abc", jobId } }
		);
		expect(response.status).toBe(200);
		expect(listScannerJobFindings).toHaveBeenCalledWith("scanner:abc", jobId, {
			q: "mcp",
			severity: "high",
			page: "2",
			limit: "10",
		});
	});
});
