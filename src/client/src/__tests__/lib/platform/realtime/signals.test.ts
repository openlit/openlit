jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(),
	getCurrentProjectForOrganisation: jest.fn(),
}));

import { getCurrentOrganisation, getCurrentProjectForOrganisation } from "@/lib/organisation";
import { listLiveSignals, parseLiveSignals } from "@/lib/platform/realtime/signals";

const scope = { organisationId: "org1", projectId: "proj1", environment: "production" };

describe("parseLiveSignals", () => {
	it("keeps the current tenant and drops other tenants", () => {
		const signals = parseLiveSignals(
			{
				signals: [
					{
						timestamp: "2026-10-05T12:00:00.000Z",
						organisationId: "org1",
						projectId: "proj1",
						environment: "production",
						service: "chat",
						model: "gpt-4o",
						status: "error",
						durationMs: 120,
						cost: 0.02,
						attributes: { "user.id": "user-1", "gen_ai.prompt": "secret prompt" },
					},
					{
						timestamp: "2026-10-05T12:00:01.000Z",
						organisationId: "org2",
						projectId: "proj1",
						environment: "production",
						service: "other",
						status: "ok",
					},
				],
			},
			scope
		);
		expect(signals).toHaveLength(1);
		expect(signals[0].service).toBe("chat");
		expect(signals[0].cost).toBe(0.02);
		expect(signals[0].attributes).toEqual({ "user.id": "user-1" });
		expect(signals[0]).not.toHaveProperty("organisationId");
	});
});

describe("listLiveSignals", () => {
	const fetchMock = jest.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		global.fetch = fetchMock as unknown as typeof fetch;
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue({ id: "proj1" });
		process.env.OPENLIT_ENGINE_URL = "http://127.0.0.1:4320";
		process.env.CRON_JOB_SECRET = "s3cret";
	});

	it("asks the engine for the current project and filters the body", async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({
				signals: [
					{
						timestamp: "2026-10-05T12:00:00.000Z",
						organisationId: "org1",
						projectId: "proj1",
						environment: "production",
						service: "chat",
						status: "ok",
					},
				],
			}),
		});
		const result = await listLiveSignals({ environment: "Production" });
		expect(result.available).toBe(true);
		expect(result.signals[0].service).toBe("chat");
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toContain("organisation_id=org1");
		expect(String(url)).toContain("project_id=proj1");
		expect(String(url)).toContain("environment=production");
		expect(init.headers["X-CRON-JOB"]).toBe("s3cret");
	});

	it("reports the engine as unavailable instead of failing the page", async () => {
		fetchMock.mockRejectedValue(new Error("connect refused"));
		const result = await listLiveSignals({ environment: "production" });
		expect(result).toEqual({ available: false, signals: [] });
	});

	it("requires a current project", async () => {
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue(null);
		await expect(listLiveSignals({ environment: "production" })).rejects.toMatchObject({ status: 400 });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
