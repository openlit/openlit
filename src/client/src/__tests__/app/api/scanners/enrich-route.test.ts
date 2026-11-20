jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/scanner/enrich-crud", () => ({
	cancelScannerEnrich: jest.fn(),
	discardScannerEnrich: jest.fn(),
	getScannerEnrichRun: jest.fn(),
	latestScannerEnrichRun: jest.fn(),
	listScannerEnrichProvidersFor: jest.fn(),
	startScannerEnrich: jest.fn(),
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

import { GET, POST } from "@/app/api/scanners/[id]/enrich/route";
import { GET as GETProviders } from "@/app/api/scanners/[id]/enrich/providers/route";
import { DELETE, GET as GETRun } from "@/app/api/scanners/[id]/enrich/[runId]/route";
import { POST as POSTCancel } from "@/app/api/scanners/[id]/enrich/[runId]/cancel/route";
import { getCurrentUser } from "@/lib/session";
import {
	cancelScannerEnrich,
	discardScannerEnrich,
	getScannerEnrichRun,
	latestScannerEnrichRun,
	listScannerEnrichProvidersFor,
	startScannerEnrich,
} from "@/lib/platform/connectors/scanner/enrich-crud";
import {
	SCANNER_ENRICH_FINDING_INVALID,
	SCANNER_ENRICH_PROVIDER_INVALID,
	SCANNER_ENRICH_RUN_ID_INVALID,
	SCANNER_ENRICH_RUNNING,
	SCANNER_INVALID_JSON,
	SCANNER_JOB_ID_INVALID,
} from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

const ID = "scanner:abc";
const JOB_ID = "job:abee6854-450a-445d-98a9-8ed0076c05b7";
const RUN_ID = "enrich:5b0c1e9e-7d1f-4a43-9a51-0d8f0c1b2e3a";
const run = { id: RUN_ID, status: "running", jobId: JOB_ID, alertNumber: 2 };

function makeGetRequest(query = "") {
	return { url: `http://localhost/api/scanners/${ID}/enrich${query}` } as Request;
}

function makePostRequest(body: unknown) {
	return {
		text: async () => (body === "__invalid__" ? "{" : JSON.stringify(body)),
	} as any;
}

beforeEach(() => {
	jest.clearAllMocks();
	(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
});

describe("authentication", () => {
	beforeEach(() => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
	});

	it.each([
		["GET latest", () => GET(makeGetRequest(`?jobId=${JOB_ID}&alertNumber=2`), { params: { id: ID } })],
		["POST start", () => POST(makePostRequest({}), { params: { id: ID } })],
		["GET providers", () => GETProviders(makeGetRequest(), { params: { id: ID } })],
		["GET run", () => GETRun(makeGetRequest(), { params: { id: ID, runId: RUN_ID } })],
		["DELETE run", () => DELETE(makeGetRequest(), { params: { id: ID, runId: RUN_ID } })],
		["POST cancel", () => POSTCancel(makePostRequest({}), { params: { id: ID, runId: RUN_ID } })],
	])("%s requires a session", async (_name, call) => {
		const response = await call();
		expect(response.status).toBe(401);
	});

	afterEach(() => {
		expect(startScannerEnrich).not.toHaveBeenCalled();
		expect(getScannerEnrichRun).not.toHaveBeenCalled();
		expect(latestScannerEnrichRun).not.toHaveBeenCalled();
		expect(listScannerEnrichProvidersFor).not.toHaveBeenCalled();
		expect(cancelScannerEnrich).not.toHaveBeenCalled();
		expect(discardScannerEnrich).not.toHaveBeenCalled();
	});
});

describe("POST /api/scanners/[id]/enrich", () => {
	it("rejects malformed JSON", async () => {
		const response = await POST(makePostRequest("__invalid__"), { params: { id: ID } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_INVALID_JSON });
		expect(startScannerEnrich).not.toHaveBeenCalled();
	});

	it.each([
		[{ jobId: "../etc", alertNumber: 2, provider: "anthropic" }, SCANNER_JOB_ID_INVALID],
		[{ jobId: JOB_ID, alertNumber: "2", provider: "anthropic" }, SCANNER_ENRICH_FINDING_INVALID],
		[{ jobId: JOB_ID, alertNumber: 2, provider: "cohere" }, SCANNER_ENRICH_PROVIDER_INVALID],
	])("rejects invalid input %p", async (body, message) => {
		const response = await POST(makePostRequest(body), { params: { id: ID } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(message);
		expect(startScannerEnrich).not.toHaveBeenCalled();
	});

	it("starts a run with the parsed input", async () => {
		(startScannerEnrich as jest.Mock).mockResolvedValue(run);
		const response = await POST(
			makePostRequest({ jobId: JOB_ID, alertNumber: 2, provider: "anthropic", attempts: 2, recheck: false }),
			{ params: { id: ID } }
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ run });
		expect(startScannerEnrich).toHaveBeenCalledWith(ID, {
			jobId: JOB_ID,
			alertNumber: 2,
			provider: "anthropic",
			model: undefined,
			attempts: 2,
			recheck: false,
			baseRef: undefined,
		});
	});

	it("returns crud errors as 400", async () => {
		(startScannerEnrich as jest.Mock).mockRejectedValue(new Error(SCANNER_ENRICH_RUNNING));
		const response = await POST(
			makePostRequest({ jobId: JOB_ID, alertNumber: 2, provider: "anthropic" }),
			{ params: { id: ID } }
		);
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(SCANNER_ENRICH_RUNNING);
	});
});

describe("GET /api/scanners/[id]/enrich", () => {
	it.each([
		["?alertNumber=2", SCANNER_JOB_ID_INVALID],
		[`?jobId=${JOB_ID}&alertNumber=0`, SCANNER_ENRICH_FINDING_INVALID],
		[`?jobId=${JOB_ID}&alertNumber=abc`, SCANNER_ENRICH_FINDING_INVALID],
	])("rejects %s", async (query, message) => {
		const response = await GET(makeGetRequest(query), { params: { id: ID } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: message });
		expect(latestScannerEnrichRun).not.toHaveBeenCalled();
	});

	it("returns the latest run for a finding", async () => {
		(latestScannerEnrichRun as jest.Mock).mockResolvedValue(run);
		const response = await GET(makeGetRequest(`?jobId=${JOB_ID}&alertNumber=2`), { params: { id: ID } });
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ run });
		expect(latestScannerEnrichRun).toHaveBeenCalledWith(ID, JOB_ID, 2);
	});

	it("returns null when the finding has no run", async () => {
		(latestScannerEnrichRun as jest.Mock).mockResolvedValue(null);
		const response = await GET(makeGetRequest(`?jobId=${JOB_ID}&alertNumber=2`), { params: { id: ID } });
		await expect(response.json()).resolves.toEqual({ run: null });
	});
});

describe("GET /api/scanners/[id]/enrich/providers", () => {
	it("returns providers", async () => {
		const providers = [{ id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", hasKey: true, models: [] }];
		(listScannerEnrichProvidersFor as jest.Mock).mockResolvedValue(providers);
		const response = await GETProviders(makeGetRequest(), { params: { id: ID } });
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ providers });
		expect(listScannerEnrichProvidersFor).toHaveBeenCalledWith(ID);
	});
});

describe("/api/scanners/[id]/enrich/[runId]", () => {
	it.each([
		["GET", () => GETRun(makeGetRequest(), { params: { id: ID, runId: "../x" } })],
		["DELETE", () => DELETE(makeGetRequest(), { params: { id: ID, runId: "job:1" } })],
		["cancel", () => POSTCancel(makePostRequest({}), { params: { id: ID, runId: "enrich:" } })],
	])("%s rejects an invalid run id", async (_name, call) => {
		const response = await call();
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ err: SCANNER_ENRICH_RUN_ID_INVALID });
		expect(getScannerEnrichRun).not.toHaveBeenCalled();
		expect(discardScannerEnrich).not.toHaveBeenCalled();
		expect(cancelScannerEnrich).not.toHaveBeenCalled();
	});

	it("returns a run", async () => {
		(getScannerEnrichRun as jest.Mock).mockResolvedValue(run);
		const response = await GETRun(makeGetRequest(), { params: { id: ID, runId: RUN_ID } });
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ run });
		expect(getScannerEnrichRun).toHaveBeenCalledWith(ID, RUN_ID);
	});

	it("discards a run", async () => {
		(discardScannerEnrich as jest.Mock).mockResolvedValue({ ok: true });
		const response = await DELETE(makeGetRequest(), { params: { id: ID, runId: RUN_ID } });
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(discardScannerEnrich).toHaveBeenCalledWith(ID, RUN_ID);
	});

	it("cancels a run", async () => {
		(cancelScannerEnrich as jest.Mock).mockResolvedValue({ ...run, status: "cancelled" });
		const response = await POSTCancel(makePostRequest({}), { params: { id: ID, runId: RUN_ID } });
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ run: { ...run, status: "cancelled" } });
		expect(cancelScannerEnrich).toHaveBeenCalledWith(ID, RUN_ID);
	});
});
