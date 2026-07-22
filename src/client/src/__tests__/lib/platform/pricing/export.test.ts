jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByIdInternal: jest.fn(),
}));

import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByIdInternal } from "@/lib/db-config";
import { getPricingExport } from "@/lib/platform/pricing/export";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;
const mockedGetDBConfigByIdInternal =
	getDBConfigByIdInternal as jest.MockedFunction<typeof getDBConfigByIdInternal>;

describe("getPricingExport", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns a 400 when dbConfigId is missing", async () => {
		await expect(getPricingExport("")).resolves.toEqual({
			error: "Database config ID is required",
			status: 400,
		});
	});

	it("returns a 404 when the database config does not exist", async () => {
		mockedGetDBConfigByIdInternal.mockResolvedValue(null as any);

		await expect(getPricingExport("db-1")).resolves.toEqual({
			error: "Database config not found",
			status: 404,
		});
	});

	it("returns a 500 when the pricing query fails", async () => {
		mockedGetDBConfigByIdInternal.mockResolvedValue({ id: "db-1" } as any);
		mockedDataCollector.mockResolvedValue({ err: "boom" } as any);

		await expect(getPricingExport("db-1")).resolves.toEqual({
			error: "Failed to fetch model pricing",
			status: 500,
		});
	});

	it("builds SDK-compatible pricing.json, including optional cache prices", async () => {
		mockedGetDBConfigByIdInternal.mockResolvedValue({ id: "db-1" } as any);
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					model_id: "gpt-4",
					model_type: "chat",
					inputPrice: 10,
					outputPrice: 20,
					cacheReadPrice: 1,
					cacheCreationPrice: 2,
				},
				{
					model_id: "gpt-3.5",
					model_type: "chat",
					inputPrice: 5,
					outputPrice: 10,
					cacheReadPrice: 0,
					cacheCreationPrice: 0,
				},
				{
					model_id: "text-embedding-3",
					model_type: "embeddings",
					inputPrice: 1,
					outputPrice: 0,
				},
				{
					model_id: "whisper-1",
					model_type: "audio",
					inputPrice: 6,
					outputPrice: 0,
				},
				{
					model_id: "dall-e-3",
					model_type: "images",
					inputPrice: 40,
					outputPrice: 0,
				},
			],
		} as any);

		const result = await getPricingExport("db-1");

		expect(result).toEqual({
			data: {
				chat: {
					"gpt-4": {
						promptPrice: 0.01,
						completionPrice: 0.02,
						cacheReadPrice: 0.001,
						cacheCreationPrice: 0.002,
					},
					"gpt-3.5": {
						promptPrice: 0.005,
						completionPrice: 0.01,
					},
				},
				embeddings: {
					"text-embedding-3": 0.001,
				},
				audio: {
					"whisper-1": 0.006,
				},
				images: {
					"dall-e-3": {
						standard: {
							"1024x1024": 0.04,
						},
					},
				},
			},
		});
		expect(dataCollector).toHaveBeenCalledWith(
			expect.objectContaining({ query: expect.stringContaining("cache_read_price_per_m_token") }),
			"query",
			"db-1"
		);
	});
});
